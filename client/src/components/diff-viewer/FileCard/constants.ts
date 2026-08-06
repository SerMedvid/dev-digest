/** Constants for FileCard. */
import type { Severity } from "@devdigest/shared";

/**
 * Selection order when more than one finding marks the same line — lower
 * number wins. `finding_marks` (the server's per-line marker list) carries
 * one entry per non-dismissed finding and is deliberately **not**
 * deduplicated by line (only `finding_lines` is that projection — see
 * `server/src/modules/smart-diff/service.ts`), so two agents independently
 * flagging the same line is the expected case, not an edge case. Without a
 * deterministic tie-break, whichever mark happens to come first out of the
 * DB — incidental iteration order — silently hides the other.
 */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};
