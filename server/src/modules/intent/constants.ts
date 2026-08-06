/** Caps on what the classifier is fed. Bounded input, bounded cost. */
export const MAX_DOCS = 3;
export const MAX_DOC_BYTES = 8_000;
export const MAX_ISSUES = 2;
export const MAX_ISSUE_BYTES = 4_000;
export const MAX_BODY_BYTES = 6_000;

/**
 * How many references of one kind (issues, cross-repo issues, documents) a
 * single PR body may even *acknowledge*.
 *
 * Not a fetch budget — MAX_ISSUES / MAX_DOCS are that. This bounds the
 * `missing_context` list, every surplus reference becoming one entry there:
 * unbounded, a body crafted to carry a thousand `.md` paths turns into hundreds
 * of kilobytes of author-chosen text in the classifier prompt, in the stored
 * row and on the card. Ten of anything is far past what a real PR links.
 */
export const MAX_REFERENCES = 10;
/**
 * A reference longer than this is not a path anyone committed; it is padding.
 * Dropped rather than truncated — a truncated path is a wrong path, and
 * reporting a wrong path as unread is worse than saying nothing about it.
 */
export const MAX_REF_CHARS = 120;
/** Provider error text echoed into a `missing_context` note. */
export const MAX_ERROR_CHARS = 200;
