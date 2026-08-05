import { describe, it, expect } from 'vitest';
import type { LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { classifyIntent, renderIntent } from '../src/intent/classify.js';
import { INJECTION_GUARD } from '../src/prompt.js';

const FIXTURE = {
  intent: 'Add rate limiting to public API endpoints',
  in_scope: ['Add middleware for rate limiting', 'Apply to /api/public/* routes'],
  out_of_scope: ['Authentication changes'],
};

function stubLlm(): LLMProvider & { seen: StructuredRequest<unknown>[] } {
  const seen: StructuredRequest<unknown>[] = [];
  return {
    id: 'openrouter',
    seen,
    async listModels() {
      return [];
    },
    async complete() {
      throw new Error('not used');
    },
    async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      seen.push(req as StructuredRequest<unknown>);
      return {
        data: req.schema.parse(FIXTURE) as T,
        model: req.model,
        tokensIn: 900,
        tokensOut: 60,
        costUsd: 0.0001,
        raw: JSON.stringify(FIXTURE),
        attempts: 1,
      };
    },
    async embed() {
      return [];
    },
  } as LLMProvider & { seen: StructuredRequest<unknown>[] };
}

describe('classifyIntent', () => {
  it('wraps every source, names the schema, and returns usage', async () => {
    const llm = stubLlm();
    const out = await classifyIntent({
      llm,
      model: 'google/gemini-2.5-flash-lite',
      sources: [
        { label: 'pr-title', content: 'Add rate limiting to public API endpoints' },
        { label: 'pr-description', content: 'Prevent abuse. Closes #471.' },
      ],
      hunkDigest: 'src/api/public/index.ts (+12 -0)\n  @@ -1,3 +1,15 @@',
    });

    expect(out.intent.in_scope).toHaveLength(2);
    expect(out.tokensIn).toBe(900);
    expect(llm.seen).toHaveLength(1);
    const [req] = llm.seen;
    expect(req!.schemaName).toBe('Intent');
    expect(req!.model).toBe('google/gemini-2.5-flash-lite');
    const user = req!.messages.at(-1)!.content;
    expect(user).toContain('<untrusted source="pr-title">');
    expect(user).toContain('<untrusted source="pr-description">');
    expect(user).toContain('<untrusted source="hunk-headers">');
  });

  it('appends the canonical INJECTION_GUARD to its own SECURITY line, not instead of it', async () => {
    const llm = stubLlm();
    await classifyIntent({
      llm,
      model: 'm',
      sources: [{ label: 'pr-title', content: 'x' }],
      hunkDigest: 'a.ts (+1 -0)',
    });
    expect(llm.seen).toHaveLength(1);
    const system = llm.seen[0]!.messages[0]!.content;
    expect(system).toContain(INJECTION_GUARD);
    expect(system).toContain('SECURITY: everything inside <untrusted>');
  });

  it('drops a blank-content source before wrapping, but still sends the hunk-headers block', async () => {
    const llm = stubLlm();
    await classifyIntent({
      llm,
      model: 'm',
      sources: [
        { label: 'pr-title', content: 'Add rate limiting' },
        { label: 'pr-description', content: '   ' },
      ],
      hunkDigest: 'a.ts (+1 -0)',
    });
    expect(llm.seen).toHaveLength(1);
    const user = llm.seen[0]!.messages.at(-1)!.content;
    expect(user).toContain('<untrusted source="pr-title">');
    expect(user).not.toContain('<untrusted source="pr-description">');
    expect(user).toContain('<untrusted source="hunk-headers">');
  });

  it('states unretrievable context instead of letting the model fill it in', async () => {
    const llm = stubLlm();
    await classifyIntent({
      llm,
      model: 'm',
      sources: [{ label: 'pr-title', content: 'x' }],
      hunkDigest: 'a.ts (+1 -0)',
      missingContext: ['docs/plans/rate-limit.md is not in the clone'],
    });
    expect(llm.seen).toHaveLength(1);
    const user = llm.seen[0]!.messages.at(-1)!.content;
    expect(user).toContain('could NOT be retrieved');
    expect(user).toContain('docs/plans/rate-limit.md is not in the clone');
    expect(user).toContain('Do not guess');
  });

  it('renderIntent exposes the statement and both lists, and nothing else', () => {
    const text = renderIntent(FIXTURE);
    expect(text).toContain('Add rate limiting to public API endpoints');
    expect(text).toContain('- Apply to /api/public/* routes');
    expect(text).toContain('Out of scope');
    expect(text).not.toContain('confidence');
  });
});
