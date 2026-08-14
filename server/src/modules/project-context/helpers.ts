import { sep } from 'node:path';
import { z } from 'zod';
import { ContextRootSegment } from '@devdigest/shared';
import { BYTES_PER_ESTIMATED_TOKEN, DEFAULT_CONTEXT_ROOTS, MAX_DOC_BYTES } from './constants.js';
import type {
  AttachmentRecord,
  AttachmentsToken,
  OrderInput,
  OrderedDoc,
  UnreadReason,
} from './domain.js';

/**
 * Pure transforms. No fs, no clock, no DB, no HTTP — this file is in the core
 * ring, so it may import `@devdigest/shared` (a port), `domain.ts`,
 * `constants.ts` and `node:path`'s separator constant, and nothing else.
 *
 * Two things live here because they must live in exactly one place:
 *
 *  - **the normalisation boundary.** Every path this module stores, returns or
 *    compares is repo-relative POSIX. A native-separator path leaking into a
 *    POSIX-normalised set once silently zeroed the depgraph — it matched nothing
 *    and reported success (`server/INSIGHTS.md`, 2026-08-10).
 *  - **the fixed strings.** The trace entries and the truncation marker are
 *    asserted byte for byte, so nothing else formats them. The run's three Live
 *    Log lines are *not* here: their only consumer is `run-executor.ts`, which
 *    may not import this module, so they live in
 *    `platform/project-context-log.ts` instead of being bridged out of here.
 */

// ---------------------------------------------------------------- paths

/**
 * Native → POSIX, at the walker's boundary and nowhere else. Only the platform
 * separator is replaced: on POSIX a backslash is a legal character in a filename,
 * so rewriting it would corrupt a real path.
 */
export function toPosix(nativeRelPath: string): string {
  return nativeRelPath.split(sep).join('/');
}

/**
 * Does this repo-relative path sit under one of the configured roots (AC-1)?
 * Returns the matched root segment — the caller stores it — or `null`.
 *
 * A root matches as a **path segment at any depth**, so
 * `server/src/modules/x/docs/y.md` is under `docs`, and is compared
 * **case-sensitively**: `Specs/a.md` is not under `specs`. That is deliberately
 * asymmetric with the walker's case-*insensitive* `.md` check — the extension is
 * a file-type convention, a root is a name someone configured and must be able
 * to distinguish `docs` from `Docs`.
 *
 * The final segment is the file name and is never considered: a root is a
 * directory, so `a/docs.md` is not under `docs`, and `mydocs/a.md` is not either
 * — a segment, not a substring.
 */
export function isUnderRoots(posixRelPath: string, roots: readonly string[]): string | null {
  const segments = posixRelPath.split('/');
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (segment !== undefined && roots.includes(segment)) return segment;
  }
  return null;
}

/** The stored `context_roots` shape (AC-74), cached rather than rebuilt per call. */
const StoredRoots = z.array(ContextRootSegment);

/**
 * The read boundary for `context_roots` (AC-76). The value arrives **typed but
 * unverified**: `rowsToSettings` returns `out as Settings` with no parse, so the
 * schema's `.default()` never ran and `SettingsKnown`'s element type is a promise
 * nobody kept.
 *
 * Any failure — no row, wrong JSON type, a separator, a `..`, an empty list —
 * yields exactly the default roots. Never a throw, and never a widened walk
 * (AC-77). An empty array is treated as "not configured" rather than "search
 * nothing", because a settings row someone emptied should not silently disable
 * the feature.
 *
 * The result is always a fresh array, so a caller cannot mutate the defaults.
 */
export function parseRoots(stored: unknown): string[] {
  const parsed = StoredRoots.safeParse(stored);
  if (!parsed.success || parsed.data.length === 0) return [...DEFAULT_CONTEXT_ROOTS];
  return parsed.data;
}

// ---------------------------------------------------------------- estimates

/**
 * The document **list**'s token figure, from the byte size `stat()` already
 * returned — no read, no tokenizer (AC-6's figure, shown with `≈`).
 *
 * The list is the one place where the exact count is not worth what it costs:
 * `js-tiktoken`'s BPE is quadratic in the length of one unbroken letter run, it
 * is synchronous, and the client refetches the whole list on every checkbox
 * tick, so an exact count over 500 documents blocked the event loop for
 * minutes. Where the number is actually spent — the attachment view's footer
 * and the run trace — the real `Tokenizer` port still runs, over the text that
 * is actually injected.
 *
 * Bytes, not characters, so a UTF-8 document is not silently under-counted; the
 * figure is rounded up so a non-empty document never reads as zero tokens.
 *
 * **Clamped to `MAX_DOC_BYTES`**, because that is all a run ever injects: the
 * reader stops at the cap and `truncateForPrompt` appends the marker, so a 3 MB
 * attachment contributes ~16,384 tokens and not the ~786,432 its size implies.
 * The clamp lives here rather than at either call site so the document list and
 * the attachment view cannot disagree about one row — that split is the whole
 * defect class (a figure stating tokens nothing bills).
 */
export function estimateTokensFromBytes(sizeBytes: number): number {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return 0;
  return Math.ceil(Math.min(sizeBytes, MAX_DOC_BYTES) / BYTES_PER_ESTIMATED_TOKEN);
}

// ---------------------------------------------------------------- concurrency

/**
 * FNV-1a, 32-bit, seeded. `Math.imul` is what keeps the multiply 32-bit — a
 * plain `*` loses the low bits to the float mantissa past 2^53 and the hash
 * degenerates. `charCodeAt` walks UTF-16 units, which is deterministic and all
 * this needs: the output is compared with another output of this same function,
 * never with anything else's.
 */
function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The **skill owner's** concurrency token: a fingerprint of the stored
 * attachment set itself, in stored order.
 *
 * A skill has no counter this write may bump. `skills.version` tracks the
 * skill's *body* and `skill_versions` is its history, so an attachment replace
 * deliberately leaves it alone — which makes it useless as a token here: two
 * overlapping attachment replaces would both carry the same `skills.version`,
 * both compare equal, and the lost update this token exists to catch would go
 * through unnoticed. Adding a counter column is a migration, and this is not
 * one. The set is the state being replaced, so the set is what the token
 * describes: it changes exactly when the thing the client believed it was
 * replacing changes, and a re-PUT of an identical set is (correctly) not a
 * conflict.
 *
 * Order-sensitive, because reordering is a real edit here (the editor's drag
 * writes a new `order`). Two 32-bit passes with different seeds rather than one:
 * a collision is a **missed** rejection, so 64 bits of it, plus the row count in
 * front, is worth the second loop. The count also keeps the token human-legible
 * in a log line.
 */
export function fingerprintAttachments(paths: readonly string[]): AttachmentsToken {
  const joined = paths.join('\n');
  const low = fnv1a(joined, 0x811c9dc5).toString(16).padStart(8, '0');
  const high = fnv1a(joined, 0x01000193).toString(16).padStart(8, '0');
  return `${paths.length}-${low}${high}`;
}

/**
 * The **agent owner's** concurrency token. `agents.version` is already bumped in
 * SQL inside the replace's own transaction, so it moves on exactly the writes a
 * client needs to notice — including an agent edit made in another tab, which is
 * a state change the attachment editor genuinely was computed against.
 *
 * Rendered as decimal digits and compared as a string, because the token is
 * opaque to everything above the two functions that produce it: nothing may
 * order it, increment it, or infer "newer" from it. It lives here rather than in
 * `repository.ts` so that the write (which compares it) and the view (which
 * hands it out) call the *same* function — that is the one place the two could
 * have drifted.
 */
export function agentToken(version: number): AttachmentsToken {
  return String(version);
}

// ---------------------------------------------------------------- caps

/**
 * Keep the first `max` documents and count the rest (AC-8). The caller sorts
 * before capping — this function does not reorder, so "the first 500 by
 * ascending path" is the walker's promise, not this one's.
 */
export function capList<T extends { path: string }>(
  docs: T[],
  max: number,
): { docs: T[]; omitted: number } {
  if (docs.length <= max) return { docs: docs.slice(), omitted: 0 };
  return { docs: docs.slice(0, max), omitted: docs.length - max };
}

/** Split the ordered set at the per-run cap: the first `max` are read, the rest are not (AC-25). */
export function applyReadCap(
  docs: OrderedDoc[],
  max: number,
): { read: OrderedDoc[]; dropped: OrderedDoc[] } {
  return { read: docs.slice(0, max), dropped: docs.slice(max) };
}

// ---------------------------------------------------------------- ordering

/**
 * First occurrence wins, keyed by the normalised POSIX path. Every deduped view
 * in this module goes through this one function, so the editor's footer, the
 * effective row list and the run's `specs` array cannot disagree about what "the
 * effective set" is (AC-18, AC-64, AC-66, AC-67).
 */
function dedupeByPath<T extends { path: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    out.push(row);
  }
  return out;
}

/**
 * The AC-17 order: the agent's own attachments in their stored order, then each
 * linked skill in link order and, within a skill, in that skill's stored order.
 * Duplicates collapse to their first occurrence (AC-18), so a path attached both
 * directly and by a skill stays in the agent's position and reads as `direct`,
 * and a path carried by two skills stays in the earlier-linked skill's position.
 *
 * A skill with `enabled: false` contributes nothing — not even a position for a
 * document another, enabled skill also carries (AC-20).
 *
 * Array order is authoritative; `AttachmentRecord.order` is not re-sorted here,
 * because `repository.ts` owns the `ORDER BY` and a second sort would quietly
 * disagree with it.
 */
export function orderAndDedupe(input: OrderInput): OrderedDoc[] {
  const flattened: OrderedDoc[] = [];
  const push = (record: AttachmentRecord, skill: { id: string; name: string } | null): void => {
    flattened.push({
      path: toPosix(record.path),
      repoId: record.repoId,
      source: skill === null ? 'direct' : 'inherited',
      skillId: skill?.id ?? null,
      skillName: skill?.name ?? null,
    });
  };

  for (const record of input.direct) push(record, null);
  for (const skill of input.skills) {
    if (!skill.enabled) continue;
    for (const record of skill.attachments) push(record, { id: skill.id, name: skill.name });
  }

  return dedupeByPath(flattened);
}

/**
 * The token footer over the effective set: a path counted once, taking the first
 * occurrence's estimate (AC-64, AC-67). Snake_case input because the rows come
 * straight off the wire contracts.
 */
export function sumTokens(rows: { path: string; token_estimate: number }[]): number {
  return dedupeByPath(rows.map((row) => ({ ...row, path: toPosix(row.path) }))).reduce(
    (total, row) => total + row.token_estimate,
    0,
  );
}

// ---------------------------------------------------------------- fixed strings

/**
 * Append the truncation marker when the document was larger than the cap
 * (AC-24). `text` is what the reader returned (already capped) and `totalBytes`
 * is the file's real byte length — the size it was truncated *from*.
 *
 * The cut is by **bytes**: a cap expressed in bytes and applied to a string is
 * not a cap once the file stops being ASCII. A multi-byte sequence severed at
 * the boundary decodes to U+FFFD, which is accepted.
 */
export function truncateForPrompt(text: string, totalBytes: number, max: number): string {
  if (totalBytes <= max) return text;
  const bytes = new TextEncoder().encode(text);
  const head =
    bytes.byteLength <= max ? text : new TextDecoder('utf-8').decode(bytes.subarray(0, max));
  return `${head}\n[truncated: ${max} of ${totalBytes} bytes]`;
}

/** `specs_read` entry for a document that was read (AC-31). */
export function formatSpecRead(path: string, tokens: number): string {
  return `${path} (~${tokens} tokens)`;
}

/**
 * `specs_read` entry for a document that was not read (AC-32).
 *
 * The dash is U+2014 EM DASH with a space either side — not a hyphen-minus, and
 * not an en dash. `test/project-context-helpers.test.ts` asserts it **by
 * codepoint** (`0x2014`), because a hyphen substituted here by an editor, a
 * codemod or a copy-paste passes a careless eyeball and fails a byte comparison
 * against a stored trace.
 */
export function formatSpecUnread(path: string, reason: UnreadReason): string {
  return `${path} — not read: ${reason}`;
}

