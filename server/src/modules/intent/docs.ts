import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { MAX_DOC_BYTES, MAX_DOCS } from './constants.js';
import type { IntentDoc } from './domain.js';
import type { DocsPort } from './ports.js';

/**
 * Driven adapter: the module's only file-system access.
 *
 * Unlike the conventions sampler, the paths here come from the PR body — that is,
 * from an untrusted author — so every one is resolved and checked against the
 * clone root before it is opened. `path.resolve` + a separator-terminated prefix
 * check is the portable form; never compare with a hardcoded '/'.
 *
 * The lexical check alone defeats `..` traversal and absolute-path injection,
 * but NOT a committed symlink whose own in-root path is clean and whose target
 * is not — `readFile` follows symlinks, so that target's bytes would otherwise
 * leak into the classifier prompt. `fs.realpath` resolves the real target
 * (following every symlink on the way, including a symlinked ancestor
 * directory), and the same root-prefix check runs again against it. A path
 * that does not exist yet fails `realpath` with ENOENT — that is not an escape,
 * so it falls through to the ordinary `readFile` attempt below and is reported
 * as "not found", same as always.
 *
 * Nothing here throws. A path we will not read becomes a `missing` entry, which
 * is what stops the classifier from being told a document exists when it does not.
 */
export class CloneDocReader implements DocsPort {
  async read(
    clonePath: string,
    relPaths: string[],
  ): Promise<{ found: IntentDoc[]; missing: string[] }> {
    const found: IntentDoc[] = [];
    const missing: string[] = [];
    const root = resolve(clonePath);
    const rootWithSep = root.endsWith(sep) ? root : root + sep;

    for (const rel of relPaths.slice(0, MAX_DOCS)) {
      // Resolve-and-confine BEFORE inspecting the extension: an escaping path
      // must always be reported as "outside the repository", never as
      // "not a markdown file" just because it also happens to lack `.md`.
      const abs = resolve(root, rel);
      if (!abs.startsWith(rootWithSep)) {
        missing.push(`${rel} was not read: path resolves outside the repository`);
        continue;
      }
      if (!rel.toLowerCase().endsWith('.md')) {
        missing.push(`${rel} was not read: not a markdown file`);
        continue;
      }
      // Symlink guard: re-check the REAL (symlink-resolved) path against the
      // same root. A nonexistent path fails realpath too — that's not an
      // escape, so it falls through to readFile and reports "not found".
      const real = await realpath(abs).catch(() => null);
      if (real !== null && !real.startsWith(rootWithSep)) {
        missing.push(`${rel} was not read: path resolves outside the repository`);
        continue;
      }
      const content = await readFile(abs, 'utf8').catch(() => null);
      if (content === null) {
        missing.push(`${rel} was not read: not found in the repository clone`);
        continue;
      }
      found.push({ label: `doc:${rel}`, content: content.slice(0, MAX_DOC_BYTES) });
    }

    for (const rel of relPaths.slice(MAX_DOCS)) {
      missing.push(`${rel} was not read: only ${MAX_DOCS} referenced documents are read per PR`);
    }

    return { found, missing };
  }
}
