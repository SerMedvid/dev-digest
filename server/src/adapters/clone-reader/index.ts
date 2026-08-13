import { open, realpath, stat as statPath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

/** Why a document was not read. No message, no path, no content — see below. */
export type CloneReadFailure = 'outside' | 'not_markdown' | 'not_found';

/**
 * `bytes` is the file's REAL byte length, not the length of `text`: a caller
 * that reports truncation needs the size it truncated *from*. `truncated` is the
 * caller's to describe — the marker text (if any) belongs to whoever renders it,
 * not to the reader.
 */
export type CloneReadResult =
  | { ok: true; text: string; bytes: number; truncated: boolean }
  | { ok: false; reason: CloneReadFailure };

/**
 * What `stat` answers: does this document exist inside the clone, and how big is
 * it — without transferring a byte of it. Same reason codes as a read, because
 * it asks the same question through the same confinement and a caller must be
 * able to treat the two answers as one.
 */
export type CloneStatResult =
  | { ok: true; bytes: number }
  | { ok: false; reason: CloneReadFailure };

/** `path.resolve` + a separator-terminated prefix is the portable prefix check. */
function withSep(dir: string): string {
  return dir.endsWith(sep) ? dir : dir + sep;
}

/**
 * The one confined reader for files inside a repository clone.
 *
 * A **driven adapter**: it touches the filesystem, so it lives in `adapters/`
 * rather than `platform/` — "shared by two modules" and "cross-cutting concern"
 * are different predicates, and every adapter here is already shared across
 * modules. `adapters-no-modules` covers this directory; `platform/` has no such
 * rule, so a module import creeping in here now fails the gate.
 *
 * The paths handed to it are untrusted — a PR body, a settings value, an API
 * request — so every one is resolved and checked against the clone root before
 * it is opened. Never compare with a hardcoded '/'.
 *
 * The lexical check alone defeats `..` traversal and absolute-path injection,
 * but NOT a committed symlink whose own in-root path is clean and whose target
 * is not — opening a path follows symlinks, so that target's bytes would
 * otherwise leak into an LLM prompt. `fs.realpath` resolves the real target
 * (following every symlink on the way, including a symlinked ancestor
 * directory), and the same root-prefix check runs again against it. A path that
 * does not exist yet fails `realpath` with ENOENT — that is not an escape, so it
 * falls through to the ordinary open attempt below and is reported as "not
 * found", same as always.
 *
 * The two checks compare against DIFFERENT roots on purpose. The lexical one
 * uses the unresolved root, so `..` is refused before any filesystem call. The
 * symlink one uses the realpath'd root, because a resolved target may only be
 * compared with a resolved root: when an ancestor of the clone directory is
 * itself a link (macOS `/var` → `/private/var`, a linked checkout, a Windows
 * junction) every real path lies under the resolved root and none under the
 * unresolved one — an asymmetric comparison there rejects every document in
 * the clone as "outside the repository".
 *
 * Nothing here throws, and a failure result carries only a reason code: no
 * message, no absolute path, no file content. Callers own the wording, so the
 * resolved target of an escaping symlink can never leak through this type.
 */
export class CloneReader {
  private constructor(
    private readonly root: string,
    private readonly rootWithSep: string,
    private readonly realRootWithSep: string,
  ) {}

  /**
   * Resolves both roots once per reader, not per path: the root does not move
   * mid-read. A root that cannot be resolved (no clone on disk) falls back to
   * the lexical one, and every path under it then reports "not found".
   */
  static async open(clonePath: string): Promise<CloneReader> {
    const root = resolve(clonePath);
    const realRoot = await realpath(root).catch(() => root);
    return new CloneReader(root, withSep(root), withSep(realRoot));
  }

  /** Confine lexically, then by extension, then by realpath, then read. */
  async read(relPath: string, maxBytes: number): Promise<CloneReadResult> {
    const confined = await this.confine(relPath);
    if (!confined.ok) return confined;
    return this.readCapped(confined.abs, maxBytes);
  }

  /**
   * The same question a read answers about existence, without the read: is this
   * document inside the clone, and how many bytes is it?
   *
   * It exists because the attachment view needs exactly that and nothing more —
   * a `missing` flag and a size — and answering it with a read made every
   * checkbox tick pay a full read plus a tokenizer pass over the whole attached
   * set. `stat` costs one syscall per path and no transfer.
   *
   * The confinement is the **same code** as the read's, not a copy of it: a
   * `stat` that confined differently would report a document the read refuses
   * (or the reverse), and the view exists precisely to describe what the run
   * will do. `bytes` is the file's real length, as it is for a read.
   */
  async stat(relPath: string): Promise<CloneStatResult> {
    const confined = await this.confine(relPath);
    if (!confined.ok) return confined;
    // Follows symlinks, like the open below — the realpath guard has already
    // established that the target is inside the clone. Directories and other
    // non-files are "not found", exactly as they are for a read.
    const stats = await statPath(confined.abs).catch(() => null);
    if (stats === null || !stats.isFile()) return { ok: false, reason: 'not_found' };
    return { ok: true, bytes: stats.size };
  }

  /**
   * Lexical containment, then the extension, then the symlink guard — the one
   * gate both `read` and `stat` pass through.
   *
   * Resolve-and-confine BEFORE inspecting the extension: an escaping path must
   * always be reported as "outside", never as "not a markdown file" just
   * because it also happens to lack `.md`.
   */
  private async confine(
    relPath: string,
  ): Promise<{ ok: true; abs: string } | { ok: false; reason: CloneReadFailure }> {
    const abs = resolve(this.root, relPath);
    if (!abs.startsWith(this.rootWithSep)) return { ok: false, reason: 'outside' };
    if (!relPath.toLowerCase().endsWith('.md')) return { ok: false, reason: 'not_markdown' };
    // Symlink guard: re-check the REAL (symlink-resolved) path against the
    // REAL root — like with like. A nonexistent path fails realpath too —
    // that's not an escape, so it falls through to the caller's own filesystem
    // call and is reported as "not found".
    const real = await realpath(abs).catch(() => null);
    if (real !== null && !real.startsWith(this.realRootWithSep)) {
      return { ok: false, reason: 'outside' };
    }
    return { ok: true, abs };
  }

  /**
   * Reads at most `maxBytes`, and never the whole file.
   *
   * A `readFile` here would materialise every byte before the cap was applied,
   * so a 200 MB generated CHANGELOG cost 200 MB of heap to keep 64 KiB — once
   * per document, per request, and again for the run. Worse, past Node's
   * `readFile` size limit it *threw*, and the throw was swallowed into
   * `not_found` — "not found in the repository clone" for a file that plainly
   * exists. A handle plus a fixed-size buffer bounds the memory at the cap and
   * removes that failure mode entirely.
   *
   * `stat` on the open handle is what keeps `bytes` the file's REAL length
   * (callers render the truncation marker from it) while only `maxBytes` are
   * ever transferred. Directories and other non-files are `not_found`, exactly
   * as the `readFile` EISDIR path reported them.
   */
  private async readCapped(abs: string, maxBytes: number): Promise<CloneReadResult> {
    const handle = await open(abs, 'r').catch(() => null);
    if (handle === null) return { ok: false, reason: 'not_found' };
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) return { ok: false, reason: 'not_found' };
      const bytes = stats.size;
      const want = Math.max(0, Math.min(bytes, maxBytes));
      const buffer = new Uint8Array(want);
      let filled = 0;
      while (filled < want) {
        const { bytesRead } = await handle.read(buffer, filled, want - filled, filled);
        // A file truncated by another process mid-read: keep what we got
        // rather than spinning, and report the size `stat` saw.
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      // Truncation is by BYTES, not characters: a cap expressed in bytes and
      // applied to a string is not a cap at all once the file is not ASCII. A
      // multi-byte sequence cut at the boundary decodes to U+FFFD — accepted.
      const text = new TextDecoder('utf-8').decode(buffer.subarray(0, filled));
      return { ok: true, text, bytes, truncated: bytes > maxBytes };
    } catch {
      return { ok: false, reason: 'not_found' };
    } finally {
      await handle.close().catch(() => {});
    }
  }
}
