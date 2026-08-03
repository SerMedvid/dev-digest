import type { ConventionCandidate, ConventionDropCounts } from "@devdigest/shared";

/** Accepted / rejected tallies for the selection bar and the re-scan warning. */
export function tally(candidates: ConventionCandidate[]) {
  return {
    accepted: candidates.filter((c) => c.status === "accepted").length,
    rejected: candidates.filter((c) => c.status === "rejected").length,
    total: candidates.length,
  };
}

/** Drop reasons worth showing, most common first. */
export function dropEntries(dropped: ConventionDropCounts): [string, number][] {
  return Object.entries(dropped)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .sort((a, b) => b[1] - a[1]);
}
