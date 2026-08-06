import { describe, it, expect } from 'vitest';
import type { LLMProvider, StructuredResult } from '@devdigest/shared';
import { MockLLMProvider, MockGitClient } from '../../server/src/adapters/mocks.js';
import { reviewPullRequest } from '../src/index.js';

/**
 * Engine-level test for reviewPullRequest (the core lifted out of the server's
 * runOneAgent). Uses the server's mock LLM + git so we exercise the real
 * assemble → completeStructured → reduce → grounding pipeline with no DB/SSE.
 */
describe('reviewPullRequest (engine)', () => {
  // One grounded finding (line 11 is in the MockGitClient diff) + one
  // hallucinated finding (line 999) the grounding gate must drop.
  const fixture = {
    verdict: 'request_changes',
    summary: 'secret key committed',
    score: 38,
    findings: [
      {
        id: 'f1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'sk_live in diff',
        confidence: 0.98,
        kind: 'finding',
      },
      {
        id: 'f-hallucinated',
        severity: 'WARNING',
        category: 'bug',
        title: 'phantom finding on a line not in the diff',
        file: 'src/config.ts',
        start_line: 999,
        end_line: 999,
        rationale: 'not real',
        confidence: 0.3,
        kind: 'finding',
      },
    ],
  };

  it('single-pass: assembles, grounds, drops the hallucinated finding', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();

    const events: string[] = [];
    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'gpt-4.1',
      diff,
      llm,
      task: 'Review PR #482',
      onEvent: (e) => events.push(e.msg),
    });

    expect(outcome.mode).toBe('single-pass');
    expect(outcome.grounding).toBe('1/2 passed');
    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.findings[0]!.start_line).toBe(11);
    expect(outcome.dropped).toHaveLength(1);
    // Score is derived from the SURVIVING findings, not the model's self-reported
    // 38: one CRITICAL remains after grounding ⇒ 100 − 35 = 65.
    expect(outcome.review.score).toBe(65);
    // progress is surfaced (server bridges this onto SSE; runner logs it)
    expect(events.some((m) => m.includes('Citation grounding'))).toBe(true);
  });

  it('score is deterministic from findings: a clean approve scores 100', async () => {
    // Model "approves" but reports a nonsense low score (the cheap-model bug).
    // The engine must ignore that and score the zero findings as a perfect 100.
    const clean = { verdict: 'approve', summary: 'looks good', score: 10, findings: [] };
    const llm = new MockLLMProvider('openai', { structured: clean });
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'deepseek/deepseek-v4-flash',
      diff,
      llm,
      task: 'Review PR #5',
    });

    expect(outcome.review.findings).toHaveLength(0);
    expect(outcome.review.score).toBe(100);
  });

  it('checkCancelled throwing aborts before the LLM call', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();
    await expect(
      reviewPullRequest({
        systemPrompt: 's',
        model: 'gpt-4.1',
        diff,
        llm,
        checkCancelled: () => {
          throw new Error('cancelled');
        },
      }),
    ).rejects.toThrow('cancelled');
  });

  /**
   * Cost null-poisoning. The studio persists `outcome.costUsd` verbatim and the
   * UI renders null as "—", so a run where ANY chunk had an unknown price must
   * report null overall rather than a partial sum that reads as the total.
   */
  it('sums costUsd across chunks, but nulls the total if any chunk is unpriced', async () => {
    let calls = 0;
    /** `perCall` decides what each chunk reports; `calls` counts the chunks. */
    const provider = (perCall: (n: number) => number | null): LLMProvider => ({
      id: 'openrouter',
      async completeStructured<T>(req): Promise<StructuredResult<T>> {
        return {
          data: fixture as unknown as T,
          model: req.model,
          tokensIn: 10,
          tokensOut: 5,
          costUsd: perCall(calls++),
          raw: '',
          attempts: 1,
        };
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    });
    const diff = await new MockGitClient().diff();

    // Every chunk priced → the costs add up.
    calls = 0;
    const priced = await reviewPullRequest({
      systemPrompt: 's',
      model: 'm',
      diff,
      llm: provider(() => 0.001),
    });
    expect(calls).toBeGreaterThan(0);
    expect(priced.costUsd).toBeCloseTo(0.001 * calls, 10);

    // First chunk unpriced → the WHOLE run reports null, not a partial sum.
    calls = 0;
    const poisoned = await reviewPullRequest({
      systemPrompt: 's',
      model: 'm',
      diff,
      llm: provider((n) => (n === 0 ? null : 0.001)),
    });
    expect(poisoned.costUsd).toBeNull();
    // Tokens still accumulate — only cost is poisoned by an unknown price.
    expect(poisoned.tokensIn).toBeGreaterThan(0);
  });

  it('scores from the findings that survive the scope gate', async () => {
    // Two findings: one droppable out-of-scope style nit, one real CRITICAL.
    const llm = new MockLLMProvider('openai', {
      structured: {
        verdict: 'request_changes',
        summary: 's',
        score: 50,
        findings: [
          {
            id: 'nit',
            severity: 'SUGGESTION',
            category: 'style',
            title: 'Rename this',
            file: 'src/config.ts',
            start_line: 11,
            end_line: 11,
            rationale: 'r',
            confidence: 0.4,
            out_of_scope: true,
          },
          {
            id: 'crit',
            severity: 'CRITICAL',
            category: 'security',
            title: 'Secret committed',
            file: 'src/config.ts',
            start_line: 11,
            end_line: 11,
            rationale: 'r',
            confidence: 0.9,
            out_of_scope: true,
          },
        ],
      },
    });
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({
      systemPrompt: 'p',
      model: 'm',
      diff,
      llm,
      intent: 'Add rate limiting\n\nIn scope:\n- middleware',
    });

    expect(outcome.review.findings.map((f) => f.id)).toEqual(['crit']);
    expect(outcome.scopeDropped).toHaveLength(1);
    // CRITICAL only: 100 − 35.
    expect(outcome.review.score).toBe(65);
  });

  it('forwards sessionId to every LLM call (OpenRouter session grouping)', async () => {
    const seen: (string | undefined)[] = [];
    const recorder: LLMProvider = {
      id: 'openrouter',
      async completeStructured<T>(req): Promise<StructuredResult<T>> {
        seen.push(req.sessionId);
        return {
          data: fixture as unknown as T,
          model: req.model,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          raw: '',
          attempts: 1,
        };
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
    const diff = await new MockGitClient().diff();
    await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: recorder, sessionId: 'sess-abc' });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s === 'sess-abc')).toBe(true);
  });
});
