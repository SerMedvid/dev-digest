import { z } from 'zod';

/**
 * Blast radius wire contract — `GET /pulls/:id/blast`.
 *
 * Deliberately separate from `contracts/brief.ts`'s `BlastRadius`, which is
 * PR-Brief (LLM-facing) scaffolding: that shape has no `file:line`, no rank and
 * no status, so it cannot carry this endpoint's payload. Nothing here is fed to
 * a model except the optional summary input, which is this very response.
 */

/**
 * How much of the map we could actually see:
 *  - `ok`       — the index answered; empty arrays mean "nothing there".
 *  - `partial`  — the index is incomplete or behind the PR's head; callers may
 *                 be missing, so the map is served WITH a warning.
 *  - `degraded` — no usable index; the arrays carry no information at all.
 * The empty-because-nothing vs empty-because-blind distinction is exactly
 * `ok`-with-empty-arrays vs `partial` / `degraded`.
 */
export const BlastStatus = z.enum(['ok', 'partial', 'degraded']);
export type BlastStatus = z.infer<typeof BlastStatus>;

/** One resolved cross-file caller of a changed symbol. */
export const BlastCallerC = z.object({
  file: z.string(),
  line: z.number().int(),
  /** The ENCLOSING symbol at the call site, not the symbol being called. */
  symbol: z.string(),
  /** `file_rank` percentile of the caller's file, 0..1. Drives ordering. */
  rank: z.number(),
});
export type BlastCallerC = z.infer<typeof BlastCallerC>;

/** A symbol declared in one of the PR's changed files, plus who reaches it. */
export const BlastSymbolC = z.object({
  name: z.string(),
  kind: z.string(),
  file: z.string(),
  /** Declaration line; null when the index has no line for the symbol. */
  line: z.number().int().nullable(),
  /** Capped at MAX_CALLERS_PER_SYMBOL, rank-descending. */
  callers: z.array(BlastCallerC),
  /** "METHOD /path", attributed via this symbol's own caller files. */
  endpoints: z.array(z.string()),
  crons: z.array(z.string()),
});
export type BlastSymbolC = z.infer<typeof BlastSymbolC>;

export const BlastRadiusResponse = z.object({
  status: BlastStatus,
  /** Machine reason; null iff `status === 'ok'`. Nullable, never optional. */
  reason: z.string().nullable(),
  head_sha: z.string(),
  changed_symbols: z.array(BlastSymbolC),
  /** BFS-widened union — a SUPERSET of the per-symbol attributions. */
  endpoints: z.array(z.string()),
  crons: z.array(z.string()),
  /** Present only when a cached summary matches the current head. */
  summary: z.string().nullable(),
});
export type BlastRadiusResponse = z.infer<typeof BlastRadiusResponse>;

/** Response of `POST /pulls/:id/blast/summary`. */
export const BlastSummaryResponse = z.object({
  summary: z.string(),
  head_sha: z.string(),
});
export type BlastSummaryResponse = z.infer<typeof BlastSummaryResponse>;
