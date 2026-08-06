import { describe, it, expect, vi } from 'vitest';
import { IntentService } from '../src/modules/intent/service.js';
import type { IntentServiceDeps } from '../src/modules/intent/ports.js';
import { ConflictError, NotFoundError } from '../src/platform/errors.js';

const PULL = {
  id: 'pr1',
  number: 482,
  title: 'Add rate limiting to public API endpoints',
  body: 'Prevent abuse. Closes #471. Implements docs/plans/rate-limit.md',
  headSha: 'sha-1',
  repoId: 'repo1',
};

function deps(over: Partial<IntentServiceDeps> = {}): IntentServiceDeps {
  const stored = new Map<string, unknown>();
  return {
    repo: {
      getPull: async () => PULL,
      getRepo: async () => ({ id: 'repo1', owner: 'acme', name: 'payments-api', clonePath: '/clone' }),
      featureModelChoice: async () => undefined,
    },
    store: {
      // Mirrors what the repository does: the stored shape is a StoredIntent
      // (flat Intent fields + camelCase metadata + a real createdAt), NOT the
      // upsert argument. Storing `rec` verbatim would make `get()` blow up on
      // `createdAt.toISOString()` in the cache-hit path below.
      get: async (prId) => stored.get(prId) as never,
      put: async (prId, rec) =>
        void stored.set(prId, {
          ...rec.intent,
          headSha: rec.headSha,
          confidence: rec.confidence,
          sources: rec.sources,
          missingContext: rec.missingContext,
          provider: rec.provider,
          model: rec.model,
          createdAt: new Date('2026-08-05T00:00:00Z'),
        }),
    },
    docs: {
      read: async () => ({ found: [{ label: 'doc:docs/plans/rate-limit.md', content: '# Plan' }], missing: [] }),
    },
    issues: {
      fetch: async () => ({ found: [{ label: 'issue#471', content: 'Rate limit us' }], missing: [] }),
    },
    diff: { hunkDigest: async () => 'src/a.ts (+2 -0)\n  @@ -1,1 +1,3 @@' },
    model: async () => ({
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash-lite',
      classify: async () => ({
        intent: { intent: 'Add rate limiting', in_scope: ['middleware'], out_of_scope: ['auth'] },
        tokensIn: 800,
        tokensOut: 40,
        costUsd: 0.0001,
      }),
    }),
    tokenCount: (t) => t.length,
    ...over,
  } as IntentServiceDeps;
}

describe('IntentService.derive', () => {
  it('uses every source, computes high confidence, and persists the record', async () => {
    const d = deps();
    const put = vi.spyOn(d.store, 'put');
    const rec = await new IntentService(d).derive('w1', 'pr1');

    expect(rec.intent).toBe('Add rate limiting');
    expect(rec.confidence).toBe('high');
    expect(rec.sources).toEqual(
      expect.arrayContaining(['title', 'description', 'issue#471', 'doc:docs/plans/rate-limit.md', 'hunk_headers']),
    );
    expect(rec.missing_context).toEqual([]);
    expect(rec.model).toBe('google/gemini-2.5-flash-lite');
    expect(rec.head_sha).toBe('sha-1');
    expect(put).toHaveBeenCalledOnce();
  });

  it('falls back to title + hunk headers with low confidence when the PR has no body', async () => {
    const rec = await new IntentService(
      deps({
        repo: {
          getPull: async () => ({ ...PULL, body: null }),
          getRepo: async () => ({ id: 'repo1', owner: 'acme', name: 'payments-api', clonePath: '/clone' }),
          featureModelChoice: async () => undefined,
        },
      }),
    ).derive('w1', 'pr1');

    expect(rec.confidence).toBe('low');
    expect(rec.sources).toEqual(['title', 'hunk_headers']);
  });

  it('records unretrievable material and caps confidence at medium', async () => {
    const rec = await new IntentService(
      deps({
        issues: { fetch: async () => ({ found: [], missing: ['issue #471 could not be fetched: 404'] }) },
        docs: { read: async () => ({ found: [], missing: ['docs/plans/rate-limit.md was not read: not found in the repository clone'] }) },
      }),
    ).derive('w1', 'pr1');

    expect(rec.confidence).toBe('medium');
    expect(rec.missing_context).toHaveLength(2);
  });

  it('passes the missing context to the model so it is told not to guess', async () => {
    const classify = vi.fn(async () => ({
      intent: { intent: 'x', in_scope: [], out_of_scope: [] },
      tokensIn: 1,
      tokensOut: 1,
      costUsd: null,
    }));
    await new IntentService(
      deps({
        docs: { read: async () => ({ found: [], missing: ['docs/plans/x.md was not read: not found in the repository clone'] }) },
        model: async () => ({ provider: 'openrouter', model: 'm', classify }),
      }),
    ).derive('w1', 'pr1');

    expect(classify.mock.calls[0]![0].missingContext).toEqual([
      'docs/plans/x.md was not read: not found in the repository clone',
    ]);
  });

  it('counts the missing context in the logged prompt size', async () => {
    // `missing_context` is part of the prompt and it is the author-shaped part.
    // Excluding it let a prompt bloated by exactly that half log as a small one.
    const onLog = vi.fn();
    const filler = 'x'.repeat(4_000);
    await new IntentService(
      deps({
        docs: { read: async () => ({ found: [], missing: [`docs/${filler}.md was not read`] }) },
      }),
    ).derive('w1', 'pr1', { onLog });

    const call = onLog.mock.calls.find((c) => c[0] === 'Classifying PR intent')!;
    const data = call[1] as { chars_in: number; est_tokens_in: number };
    expect(data.chars_in).toBeGreaterThan(4_000);
    expect(data.est_tokens_in).toBeGreaterThan(4_000);
  });

  it('never sends diff bodies — only the hunk digest', async () => {
    const classify = vi.fn(async () => ({
      intent: { intent: 'x', in_scope: [], out_of_scope: [] },
      tokensIn: 1,
      tokensOut: 1,
      costUsd: null,
    }));
    await new IntentService(
      deps({
        diff: { hunkDigest: async () => 'src/a.ts (+2 -0)\n  @@ -1,1 +1,3 @@' },
        model: async () => ({ provider: 'openrouter', model: 'm', classify }),
      }),
    ).derive('w1', 'pr1');

    const arg = classify.mock.calls[0]![0];
    const everything = JSON.stringify(arg);
    expect(arg.hunkDigest).toContain('@@');
    expect(everything).not.toContain('sk_live');
    expect(everything).not.toMatch(/\n\+[^+]/);
  });

  it('404s an unknown PR and 409s a concurrent derivation', async () => {
    const missing = deps({
      repo: {
        getPull: async () => undefined,
        getRepo: async () => undefined,
        featureModelChoice: async () => undefined,
      },
    });
    await expect(new IntentService(missing).derive('w1', 'nope')).rejects.toBeInstanceOf(NotFoundError);

    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slow = deps({
      model: async () => ({
        provider: 'p',
        model: 'm',
        classify: async () => {
          await gate;
          return { intent: { intent: 'x', in_scope: [], out_of_scope: [] }, tokensIn: 1, tokensOut: 1, costUsd: null };
        },
      }),
    });
    const svc = new IntentService(slow);
    const first = svc.derive('w1', 'pr1');
    await expect(svc.derive('w1', 'pr1')).rejects.toBeInstanceOf(ConflictError);
    release();
    await first;
    // The guard clears, so a later call is allowed.
    await expect(svc.derive('w1', 'pr1')).resolves.toBeTruthy();
  });
});

describe('IntentService.ensureFresh', () => {
  it('reuses a record derived against the same head sha — no model call', async () => {
    const classify = vi.fn();
    const d = deps({ model: async () => ({ provider: 'p', model: 'm', classify: classify as never }) });
    await d.store.put('pr1', {
      intent: { intent: 'cached', in_scope: [], out_of_scope: [] },
      headSha: 'sha-1',
      confidence: 'medium',
      sources: ['title'],
      missingContext: [],
      provider: 'p',
      model: 'm',
    });
    const rec = await new IntentService(d).ensureFresh('w1', 'pr1', 'sha-1');
    expect(rec?.intent).toBe('cached');
    expect(classify).not.toHaveBeenCalled();
  });

  it('still returns the cached record when the run-log writer throws', async () => {
    // The cache HIT path logs too, and `onLog` is run-executor's run-log
    // writer. A throwing sink there used to discard a valid, already-derived
    // record and report "no intent" to the review.
    const classify = vi.fn();
    const d = deps({ model: async () => ({ provider: 'p', model: 'm', classify: classify as never }) });
    await d.store.put('pr1', {
      intent: { intent: 'cached', in_scope: [], out_of_scope: [] },
      headSha: 'sha-1',
      confidence: 'medium',
      sources: ['title'],
      missingContext: [],
      provider: 'p',
      model: 'm',
    });
    const rec = await new IntentService(d).ensureFresh('w1', 'pr1', 'sha-1', {
      onLog: () => {
        throw new Error('log sink is down');
      },
    });
    expect(rec?.intent).toBe('cached');
    expect(classify).not.toHaveBeenCalled();
  });

  it('re-derives when the head sha moved', async () => {
    const d = deps();
    await d.store.put('pr1', {
      intent: { intent: 'cached', in_scope: [], out_of_scope: [] },
      headSha: 'OLD',
      confidence: 'medium',
      sources: ['title'],
      missingContext: [],
      provider: 'p',
      model: 'm',
    });
    const rec = await new IntentService(d).ensureFresh('w1', 'pr1', 'sha-1');
    expect(rec?.intent).toBe('Add rate limiting');
  });

  it('degrades to undefined when derivation fails — the review must still run', async () => {
    const onLog = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn() };
    const rec = await new IntentService(
      deps({
        logger,
        model: async () => {
          throw new Error('OPENROUTER_API_KEY is not configured');
        },
      }),
    ).ensureFresh('w1', 'pr1', 'sha-1', { onLog });
    expect(rec).toBeUndefined();
    // The failure is recorded somewhere even when nobody passes an onLog.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ prId: 'pr1', err: 'OPENROUTER_API_KEY is not configured' }),
      expect.stringContaining('derivation failed'),
    );
    expect(onLog).toHaveBeenCalled();
  });

  it('still returns undefined when the recovery sinks themselves throw', async () => {
    // `onLog` becomes run-executor's run-log writer, which is not throw-free.
    // A logging failure must not turn a degraded intent into a failed review.
    const boom = () => {
      throw new Error('log sink is down');
    };
    const rec = await new IntentService(
      deps({
        logger: { info: boom, warn: boom },
        model: async () => {
          throw new Error('OPENROUTER_API_KEY is not configured');
        },
      }),
    ).ensureFresh('w1', 'pr1', 'sha-1', { onLog: boom });
    expect(rec).toBeUndefined();
  });
});
