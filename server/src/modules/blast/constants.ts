/** Machine reasons carried on a non-`ok` response (design spec §2.3). */
export const BLAST_REASON = {
  /** `pr_files` is empty — the PR was never imported. */
  noFiles: 'no_files',
  /** The facade could not use the index and gave no reason of its own. */
  noData: 'no_data',
  /** The index exists but is incomplete. */
  indexPartial: 'index_partial',
  /** The index is complete but was built against a different commit. */
  indexStale: 'index_stale',
} as const;

/**
 * The map JSON handed to the summary model, truncated at this many characters.
 * A map wide enough to exceed it is already unreadable as one paragraph, and
 * the truncation is marked in the prompt rather than hidden.
 */
export const MAX_SUMMARY_INPUT_CHARS = 8_000;

/** One paragraph. Applied before storage, so the cache can't hold an over-long value. */
export const MAX_SUMMARY_CHARS = 600;

/**
 * "Prior" means history — what already landed in these files. An open PR
 * touching them is a COLLISION, a different and arguably more urgent signal,
 * but calling it "prior" would misdescribe it. An allowlist, not a
 * `!== 'open'`: `pull_requests.status` carries the schema default
 * `needs_review` until a GitHub sync overwrites it, and a never-synced row is
 * not history either.
 */
export const PRIOR_PR_STATUSES = ['merged', 'closed'] as const;

/** Ten rows is already more history than a reviewer reads. */
export const MAX_PRIOR_PRS = 10;

/**
 * Shared paths shipped per prior PR. `overlap_count` carries the true total,
 * so truncating here loses nothing the UI needs — a PR overlapping forty files
 * says "40" and ships five paths.
 */
export const MAX_OVERLAP_FILES_PER_PR = 5;
