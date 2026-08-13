import { MAX_DOC_BYTES } from '../modules/project-context/constants.js';
import type { UnreadReason } from '../modules/project-context/domain.js';

/**
 * The three project-context Live Log lines, and nothing else.
 *
 * They live in `platform/` because that is where their only consumer can reach
 * them: `modules/reviews/run-executor.ts` emits all three and may not import
 * `modules/project-context/*` (`no-cross-module-internals` counts a type-only
 * edge). Nothing inside `project-context` calls them — they are Live Log
 * formats, not document logic — so keeping them in that module's `helpers.ts`
 * and bridging them out through a container getter put the strings in a file
 * that never used them, and added a hop that hid their single consumer. This is
 * the escape `server/INSIGHTS.md` (2026-08-03) already names for this shape:
 * move the helper to `platform/`.
 *
 * The strings are asserted byte for byte (`test/project-context-log.test.ts`),
 * so this file is their one author. The em dash in `logUnreadLine` is U+2014
 * with a space either side — not a hyphen-minus, not an en dash — and the test
 * asserts it by codepoint, because a substitution here passes a careless
 * eyeball and fails a byte comparison against a stored trace.
 *
 * `MAX_DOC_BYTES` and `UnreadReason` are still owned by the module: the cap is
 * interpolated rather than restated so the line cannot outlive a change to it,
 * and the reason union keeps the executor's `note.reason` from widening to
 * `string` at the one call site that formats it.
 */

/**
 * The Live Log summary line, emitted on every run — including a run with nothing
 * attached, which states zero (AC-70, AC-72).
 */
export function logSummaryLine(attached: number, read: number): string {
  return `Project context: ${attached} attached, ${read} read`;
}

/**
 * The Live Log line for a document the run did not read (AC-26).
 *
 * Deliberately a different format from `helpers.formatSpecUnread`: a trace entry
 * is read next to a list of paths, a log line next to other log lines.
 */
export function logUnreadLine(path: string, reason: UnreadReason): string {
  return `Project context: ${path} not read — ${reason}`;
}

/**
 * The Live Log line for a document that was injected truncated (AC-24). The cap
 * is interpolated rather than spelled out, so the line cannot outlive a change to
 * `MAX_DOC_BYTES` — the same reason `UNREAD_REASON.read_cap` quotes
 * `MAX_DOCS_PER_RUN`.
 */
export function logTruncatedLine(path: string): string {
  return `Project context: ${path} truncated to ${MAX_DOC_BYTES} bytes`;
}
