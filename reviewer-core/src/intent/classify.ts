import type { Intent, LLMProvider } from '@devdigest/shared';
import { Intent as IntentSchema } from '@devdigest/shared';
import { wrapUntrusted, INJECTION_GUARD } from '../prompt.js';
import { INTENT_SYSTEM_PROMPT } from './prompt.js';

export { renderIntent } from './render.js';

/** One labelled piece of evidence. `label` becomes the untrusted block's source. */
export interface IntentSource {
  label: string;
  content: string;
}

export interface ClassifyIntentInput {
  llm: LLMProvider;
  model: string;
  /** Title, description, issue body, plan/spec bodies — already resolved strings. */
  sources: IntentSource[];
  /** Output of `hunkHeaderDigest`. */
  hunkDigest: string;
  /** Referenced material the caller tried and failed to fetch. */
  missingContext?: string[];
  sessionId?: string;
}

export interface ClassifyIntentResult {
  intent: Intent;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  raw: string;
}

/**
 * Caps on the "could NOT be retrieved" block.
 *
 * Every string in it is attacker-shaped: the paths come out of the PR body and
 * the failure reasons embed a provider's error text. Unbounded, a crafted body
 * yields hundreds of kilobytes of author-chosen text on a paid model call, so
 * both the count and each entry's length are capped — and, like
 * `hunkHeaderDigest`, the caps report what they dropped so a truncated list can
 * never read as a complete one.
 */
const MAX_MISSING_ENTRIES = 20;
const MAX_MISSING_ENTRY_CHARS = 200;

/**
 * The bulleted body of the missing-context block. Newlines inside an entry are
 * collapsed first: an entry is one bullet, and a multi-line entry would
 * otherwise let author-controlled text forge extra ones.
 */
function missingContextBullets(entries: string[]): string {
  const lines = entries.slice(0, MAX_MISSING_ENTRIES).map((entry) => {
    const flat = entry.replace(/\s+/g, ' ').trim();
    return `- ${flat.length > MAX_MISSING_ENTRY_CHARS ? `${flat.slice(0, MAX_MISSING_ENTRY_CHARS)}…` : flat}`;
  });
  const hidden = entries.length - MAX_MISSING_ENTRIES;
  if (hidden > 0) lines.push(`… ${hidden} more unretrieved item(s)`);
  return lines.join('\n');
}

/** One structured call. Schema name 'Intent' — tests and mocks key off it. */
export async function classifyIntent(input: ClassifyIntentInput): Promise<ClassifyIntentResult> {
  const blocks = input.sources
    .filter((s) => s.content.trim().length > 0)
    .map((s) => wrapUntrusted(s.label, s.content));
  blocks.push(wrapUntrusted('hunk-headers', input.hunkDigest));

  // The entries themselves are author-controlled (paths parsed out of the PR
  // body, provider error text), so they go inside an <untrusted> block like
  // every other source. Only the instruction stays trusted and outside the
  // wrap — the same shape assemblePrompt uses for `## Derived intent` +
  // INTENT_USE_RULE (prompt.ts).
  const missing =
    input.missingContext && input.missingContext.length > 0
      ? [
          '',
          '## Context that could NOT be retrieved',
          wrapUntrusted('missing-context', missingContextBullets(input.missingContext)),
          '',
          'Do not guess what these would have said, and do not treat their absence as evidence. Base the intent only on the sources above.',
        ].join('\n')
      : '';

  // Compose the canonical, shared guard onto this call's own SECURITY line —
  // the same pattern assemblePrompt uses (prompt.ts) — so a future
  // strengthening of INJECTION_GUARD reaches this call path too, without
  // diverging from or weakening the classifier's own wording.
  const system = `${INTENT_SYSTEM_PROMPT}\n\n${INJECTION_GUARD}`;

  const res = await input.llm.completeStructured({
    model: input.model,
    schema: IntentSchema,
    schemaName: 'Intent',
    temperature: 0,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `${blocks.join('\n\n')}${missing}` },
    ],
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });

  return {
    intent: res.data,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
    raw: res.raw,
  };
}
