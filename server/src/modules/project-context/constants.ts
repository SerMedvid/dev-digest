import type { UnreadReason } from './domain.js';

/**
 * Every cap, default and fixed string this module uses. One source, because the
 * trace entries, the Live Log lines and the tests all have to agree byte for
 * byte — the *rendering* of these strings lives in `helpers.ts` and nowhere else.
 */

/**
 * The roots searched when no `context_roots` settings row exists — and the value
 * `parseRoots` degrades to when a stored one fails validation (AC-3, AC-77).
 * Typed `readonly` so nothing can widen the walk by pushing onto it; `parseRoots`
 * hands callers a copy.
 */
export const DEFAULT_CONTEXT_ROOTS: readonly string[] = ['specs', 'docs', 'insights'];

/** Directory names the walk never descends into, at any depth (AC-4). */
export const EXCLUDED_DIRS: readonly string[] = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  'out',
  'vendor',
];

/** Documents returned by one discovery listing; the rest are counted, not returned (AC-8). */
export const MAX_LIST_DOCS = 500;

/** Documents read for one review run; the rest become unread entries (AC-25). */
export const MAX_DOCS_PER_RUN = 20;

/** Bytes read from one document before the truncation marker is appended (AC-24). */
export const MAX_DOC_BYTES = 65_536;

/**
 * Bytes per token in the **document list**'s estimate (`ceil(bytes / 4)`), the
 * same ratio as the tokenizer adapter's own `approxTokens` fallback. Used by
 * `estimateTokensFromBytes` so the list endpoint needs no read; the exact count
 * still comes from the `Tokenizer` port everywhere the number is spent.
 */
export const BYTES_PER_ESTIMATED_TOKEN = 4;

/** Upper bound on a client-supplied path, enforced at the route. */
export const MAX_PATH_CHARS = 1024;

/** The `settings.key` the search roots are stored under. */
export const SETTINGS_ROOTS_KEY = 'context_roots';

/**
 * The four reasons a document goes unread. `read_cap` quotes `MAX_DOCS_PER_RUN`;
 * the test asserts the two stay in step, because a stale number here would make
 * the trace entry lie about why the document was skipped.
 */
export const UNREAD_REASON = {
  outside: 'path resolves outside the repository',
  not_found: 'not found in the repository clone',
  no_clone: 'no repository clone on disk',
  read_cap: 'only 20 documents are read per run',
} as const satisfies Record<string, UnreadReason>;
