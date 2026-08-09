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
