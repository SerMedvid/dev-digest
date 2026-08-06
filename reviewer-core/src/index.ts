/**
 * @devdigest/reviewer-core — the review engine.
 *
 * Pure review logic shared by the server (local reviews in the studio) and the
 * agent-runner (CI). NO database, GitHub, or filesystem access; the only side
 * effect is an LLM call through an INJECTED LLMProvider (so it is mock-testable).
 *
 * Consumers wire it via a tsconfig path alias (`@devdigest/reviewer-core` →
 * `../reviewer-core/src`) and consume the TypeScript source directly (tsx in
 * dev, vitest in tests, @vercel/ncc bundle in the runner). The package itself
 * never emits JS — its `build` is a type-check.
 */

// Prompt assembly + prompt-injection hardening.
export {
  assemblePrompt,
  wrapUntrusted,
  INJECTION_GUARD,
  type PromptParts,
  type AssembledPrompt,
} from './prompt.js';

// Citation grounding — the mandatory mechanical gate for diff findings.
export { groundFindings, groundingSummary, type GroundingResult } from './grounding.js';

// Intent scope gate — the deterministic half of the Intent Layer.
export { scopeFindings, scopeSummary, type ScopeResult } from './scope.js';

// Structured-output helpers (Zod → JSON Schema + parse-with-repair).
export {
  toJsonSchema,
  extractJson,
  parseWithRepair,
  type JsonSchema,
  type ParseResult,
} from './llm/structured.js';

// Map-reduce helpers (reduce partials, slice a file's diff).
export { reduceReviews, sliceDiff } from './review/reduce.js';

// The engine entry point: given (diff + resolved agent inputs + LLM) → grounded Review.
export {
  reviewPullRequest,
  DEFAULT_MAP_THRESHOLD_LINES,
  DEFAULT_REVIEW_MAX_RETRIES,
  type ReviewInput,
  type ReviewOutcome,
  type ReviewEvent,
  type ReviewStrategy,
  type ReviewMode,
} from './review/run.js';

// Output: grounded Review → GitHubReviewPayload (body + inline comments + event).
export {
  toReviewPayload,
  gateTriggered,
  countBlockers,
  type ToReviewOptions,
} from './output/to-review.js';

// The single OpenAI-compatible structured provider (OpenRouter), shared by the
// CI runner and the server's openrouter path. Owns session grouping + guards.
export { OpenRouterProvider, type OpenRouterProviderOptions } from './llm/openrouter.js';

// Intent layer — cheap classifier input (file-level diff topology, never content).
export { hunkHeaderDigest } from './intent/hunk-digest.js';

// Intent layer — the classifier call + the reviewer-facing renderer.
export { classifyIntent, renderIntent } from './intent/classify.js';
export type {
  IntentSource,
  ClassifyIntentInput,
  ClassifyIntentResult,
} from './intent/classify.js';
export { INTENT_SYSTEM_PROMPT, INTENT_USE_RULE } from './intent/prompt.js';
