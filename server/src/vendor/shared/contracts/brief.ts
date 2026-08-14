import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * PR Brief building blocks: Intent, Blast radius, Smart Diff — plus the
 * composed `Brief` / `PrBriefRecord` the brief module persists (L05).
 *
 * The earlier `Risk` / `Risks` / `PrHistory` / `PrBrief` scaffolding was
 * replaced rather than extended: it had no consumer, and its `file_refs` had no
 * grounding guarantee behind it. `BriefRisk.refs` does.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

/** One finding's placement on the diff, for rendering an inline marker. */
export const FindingMark = z.object({
  line: z.number().int(),
  severity: Severity,
  finding_id: z.string(),
});
export type FindingMark = z.infer<typeof FindingMark>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
  // The producer always sends an array (empty when there are no findings);
  // `nullish` exists only so the already-committed `SmartDiff` fixture that
  // omits this field keeps parsing. `finding_lines` is the sorted,
  // de-duplicated projection of this array — derived in one place, so the two
  // can't drift.
  finding_marks: z.array(FindingMark).nullish(),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- PR Why + Risk Brief (pr_brief) ----

/**
 * How much care this pull request needs. A closed enum rather than a score:
 * the model produces it, and a number would invite the reader to believe a
 * precision the inputs cannot support.
 */
export const RiskLevel = z.enum(['high', 'medium', 'low']);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const BriefRisk = z.object({
  title: z.string(),
  explanation: z.string(),
  severity: RiskLevel,
  /**
   * File paths, or endpoint/cron identifiers drawn from the blast map.
   *
   * The SERVER — not the model — guarantees every entry here exists in the
   * pull request's own inputs: `groundBrief` (server/src/modules/brief/
   * helpers.ts) drops an entry naming anything else, and drops the whole risk
   * when nothing survives. Treat these as verified references, and never widen
   * that guarantee to a field the gate does not check.
   */
  refs: z.array(z.string()),
});
export type BriefRisk = z.infer<typeof BriefRisk>;

/** One "read this first" pointer. `line` is null unless a finding vouches for it. */
export const ReviewFocusItem = z.object({
  file: z.string(),
  line: z.number().int().nullable(),
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

/** The five fields one structured call produces. Nothing the server computes. */
export const Brief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskLevel,
  risks: z.array(BriefRisk),
  review_focus: z.array(ReviewFocusItem),
});
export type Brief = z.infer<typeof Brief>;

/**
 * The persisted brief plus its evidence trail.
 *
 * `stale` is computed by the server and is deliberately NOT in `Brief`: the
 * model never sees it and cannot assert its own freshness. `head_sha` is the
 * cache key; `review_id` is only a freshness marker — see server/specs/brief.md.
 */
export const PrBriefRecord = Brief.extend({
  pr_id: z.string(),
  head_sha: z.string(),
  review_id: z.string().nullable(),
  stale: z.boolean(),
  /** Labels of the sources that composed the prompt, e.g. 'files (60 of 214)'. */
  sources: z.array(z.string()),
  est_tokens_in: z.number().int(),
  provider: z.string(),
  model: z.string(),
  created_at: z.string(),
});
export type PrBriefRecord = z.infer<typeof PrBriefRecord>;
