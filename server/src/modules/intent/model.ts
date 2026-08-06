import { classifyIntent } from '@devdigest/reviewer-core';
import type { LLMProvider } from '@devdigest/shared';
import type { IntentModelPort } from './ports.js';

/**
 * Driven adapter for the one structured call. The prompt, the schema and the
 * wrapping live in `reviewer-core` (shared with the CI runner); this class only
 * binds a provider and a model id to it.
 */
export class IntentModel implements IntentModelPort {
  constructor(
    private llm: LLMProvider,
    readonly provider: string,
    readonly model: string,
  ) {}

  async classify(input: {
    sources: { label: string; content: string }[];
    hunkDigest: string;
    missingContext: string[];
    sessionId?: string;
  }) {
    const res = await classifyIntent({
      llm: this.llm,
      model: this.model,
      sources: input.sources,
      hunkDigest: input.hunkDigest,
      missingContext: input.missingContext,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    });
    return {
      intent: res.intent,
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
      costUsd: res.costUsd,
    };
  }
}
