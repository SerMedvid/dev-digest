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
  /**
   * Most-reached first: caller count descending, then name ascending. The
   * ordering is part of the contract because the index query has no ORDER BY
   * of its own — without it the list is whatever Postgres returned, which is
   * unstable between identical requests. On a large PR "changed symbols" is
   * every symbol declared in every touched file, so the few with callers would
   * otherwise be buried among the many without.
   */
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

/**
 * One earlier pull request that touched at least one of the same files.
 *
 * Derived from `pr_files` alone — no code index, no model, no GitHub call. The
 * overlap is on file PATHS, not symbols: this answers "who else has been in
 * here lately", which is a weaker and much cheaper question than the map's.
 */
export const PriorPrC = z.object({
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  /** GitHub's merge state. This list carries only 'merged' | 'closed'. */
  status: z.string(),
  /** How many of THIS PR's paths that PR also touched. Drives the ordering. */
  overlap_count: z.number().int(),
  /** The shared paths, capped — `overlap_count` is the untruncated total. */
  overlap_files: z.array(z.string()),
  updated_at: z.string().nullable(),
});
export type PriorPrC = z.infer<typeof PriorPrC>;

/** Response of `GET /pulls/:id/prior-prs`. */
export const PriorPrsResponse = z.object({
  /** Most overlap first, then most recently updated. Capped. */
  prs: z.array(PriorPrC),
  /**
   * How many other PRs in this repo have NO stored file rows, and so could not
   * be compared at all. `GET /pulls/:id` is what populates `pr_files`, so a PR
   * whose detail was never opened is invisible here. Non-zero means this list
   * is a lower bound, not the repo's whole history — the same "nothing there"
   * vs "we could not look" distinction `BlastStatus` carries.
   */
  uncomparable_prs: z.number().int(),
});
export type PriorPrsResponse = z.infer<typeof PriorPrsResponse>;
