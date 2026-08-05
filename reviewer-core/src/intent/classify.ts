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

/** One structured call. Schema name 'Intent' — tests and mocks key off it. */
export async function classifyIntent(input: ClassifyIntentInput): Promise<ClassifyIntentResult> {
  const blocks = input.sources
    .filter((s) => s.content.trim().length > 0)
    .map((s) => wrapUntrusted(s.label, s.content));
  blocks.push(wrapUntrusted('hunk-headers', input.hunkDigest));

  const missing =
    input.missingContext && input.missingContext.length > 0
      ? [
          '',
          '## Context that could NOT be retrieved',
          ...input.missingContext.map((m) => `- ${m}`),
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
