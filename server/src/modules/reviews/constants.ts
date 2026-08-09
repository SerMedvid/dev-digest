/**
 * Review module constants.
 */

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

/**
 * Body cap for `POST /reviews/adhoc` (1 MB). Fastify rejects a larger body with
 * 413 before the handler runs, so an oversized working tree can never reach the
 * parser or a model. A real working-tree diff that exceeds this is not a review
 * unit anyway.
 */
export const MAX_ADHOC_DIFF_BYTES = 1_048_576;
