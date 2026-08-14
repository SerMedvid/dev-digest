import type { Verdict } from "@devdigest/shared";

/**
 * The verdict the banner falls back to when the PR has no review yet.
 *
 * `comment` and not `approve`: a PR nobody has reviewed has not been approved,
 * and the banner is the most prominent thing on the overview.
 */
export const FALLBACK_VERDICT: Verdict = "comment";

/** Severities that count as blockers in the banner's counter. */
export const BLOCKER_SEVERITIES = ["CRITICAL"] as const;
