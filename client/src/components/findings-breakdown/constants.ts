/** Constants for FindingsBreakdown. */

import type { PrFindingsBySeverity } from "@devdigest/shared";

/** Severity display order — most severe first, everywhere counters appear. */
export const SEVERITY_ORDER = ["CRITICAL", "WARNING", "SUGGESTION"] as const;

export type CounterSeverity = (typeof SEVERITY_ORDER)[number];

/** Rank used to sort a client-derived list the same way the server orders the
 *  list preview. An unrecognised severity sorts last. */
export const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};
export const SEVERITY_RANK_FALLBACK = 3;

/** All-zero counts — the shape `fromRecords` starts from. */
export const EMPTY_COUNTS: PrFindingsBySeverity = {
  CRITICAL: 0,
  WARNING: 0,
  SUGGESTION: 0,
};

/** Breakdown card geometry. */
export const CARD_WIDTH = 380;
export const CARD_MAX_HEIGHT = 340;
