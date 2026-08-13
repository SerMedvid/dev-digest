import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { EXCLUDED_DIRS, MAX_LIST_DOCS } from './constants.js';
import { capList, isUnderRoots, toPosix } from './helpers.js';

/**
 * Discovery over a repository clone — a driven adapter, so it is the one file in
 * this module that touches the filesystem. The core (`service.ts`, `helpers.ts`,
 * `domain.ts`) never does.
 *
 * Three properties are load-bearing and each has cost someone a session:
 *
 *  - **A symlink is skipped outright**, file or directory, before anything else
 *    happens to that entry (AC-5). That is this walker's only containment duty:
 *    it never `realpath`s its way *to* a decision to include something, so no
 *    link can put a path outside the clone into a list the reader will later
 *    open. It also makes traversal loops impossible.
 *  - **Paths leave here repo-relative and POSIX** (AC-2), normalised once
 *    through `toPosix` and never as `relative()`'s raw native output. This bug
 *    class is silent: native separators fed into a POSIX-normalised set match
 *    nothing, so the walk *reports success with zero results*
 *    (`server/INSIGHTS.md`, 2026-08-10).
 *  - **Nothing throws.** A clone path that is absent or unreadable yields
 *    `{ docs: [], omitted: 0, cloneMissing: true }`, and an unreadable
 *    subdirectory is skipped while the walk continues over what it can read (the
 *    NFR degradation row). No log line either — the clone's absolute path is not
 *    ours to emit.
 *
 * `cloneMissing` is the *only* thing that distinguishes "the clone directory is
 * not there" from "the clone is there and holds no documents". The walker is the
 * one place that can tell them apart, so AC-7's "or the directory is absent" arm
 * has to be answered here or not at all — a caller looking at `docs: []` cannot
 * tell which happened.
 */

/** One `.md` file found under a configured root. `sizeBytes` is bytes (AC-6). */
export interface WalkedDoc {
  /** Repo-relative POSIX path. */
  path: string;
  /** The configured root segment that matched, exactly as configured. */
  root: string;
  sizeBytes: number;
}

/**
 * One walk. `cloneMissing` is true when the clone directory itself could not be
 * listed — absent, or unreadable — which is the half of AC-7 an empty `docs`
 * cannot express.
 */
export interface WalkResult {
  docs: WalkedDoc[];
  omitted: number;
  cloneMissing: boolean;
}

const EXCLUDED: ReadonlySet<string> = new Set(EXCLUDED_DIRS);

export class CloneWalker {
  /**
   * Enumerate every `.md` file under one of `roots` (AC-1). Never throws: a
   * clone path that is absent or unreadable yields `[]` and `cloneMissing: true`
   * (AC-7).
   *
   * The result is sorted by ascending path **before** the cap is applied, so
   * "the first 500" is the first 500 of the whole clone rather than of whatever
   * order the filesystem happened to hand back (AC-8).
   */
  async walk(clonePath: string, roots: string[]): Promise<WalkResult> {
    const found: WalkedDoc[] = [];
    const readable = await this.walkDir(clonePath, clonePath, roots, found);
    // Code-unit comparison, not `localeCompare`: the order has to be the same on
    // every machine and match the plain string ordering the tests and the cap
    // assume. `Array#sort`'s default stringifies objects, so the comparator is
    // not optional here.
    found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { ...capList(found, MAX_LIST_DOCS), cloneMissing: !readable };
  }

  /**
   * Returns whether **this** directory could be listed. Only the top-level call
   * uses the answer: a subdirectory that cannot be read is skipped and the walk
   * continues, but a clone root that cannot be read is AC-7's absent directory.
   */
  private async walkDir(
    cloneRoot: string,
    dir: string,
    roots: string[],
    out: WalkedDoc[],
  ): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Missing clone, permissions, a directory that vanished mid-walk. Skip it
      // and keep going over the rest of the clone.
      return false;
    }

    for (const entry of entries) {
      // First, and for files as well as directories: a link is never followed
      // and never reported (AC-5).
      if (entry.isSymbolicLink()) continue;

      const abs = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Excluded by NAME, so it applies at any depth (AC-4).
        if (EXCLUDED.has(entry.name)) continue;
        await this.walkDir(cloneRoot, abs, roots, out);
        continue;
      }
      if (!entry.isFile()) continue;

      // Case-INSENSITIVE, matching `CloneReader.read`'s check so anything this
      // walker offers is something that reader will accept. Deliberately
      // asymmetric with `isUnderRoots`, which compares root segments
      // case-SENSITIVELY: an extension is a file-type convention, a root is a
      // name someone configured.
      if (!entry.name.toLowerCase().endsWith('.md')) continue;

      // The single normalisation point. Native path for the filesystem, POSIX
      // path for everything downstream.
      const path = toPosix(relative(cloneRoot, abs));
      const matchedRoot = isUnderRoots(path, roots);
      if (matchedRoot === null) continue;

      const sizeBytes = await stat(abs).then(
        (info) => info.size,
        () => null,
      );
      if (sizeBytes === null) continue;

      out.push({ path, root: matchedRoot, sizeBytes });
    }
    return true;
  }
}
