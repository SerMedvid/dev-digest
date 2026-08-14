import { CloneReader, type CloneReadFailure } from '../../adapters/clone-reader/index.js';
import { MAX_DOC_BYTES, MAX_DOCS } from './constants.js';
import type { IntentDoc } from './domain.js';
import type { DocsPort } from './ports.js';

/**
 * Driven adapter: the module's only file-system access.
 *
 * Unlike the conventions sampler, the paths here come from the PR body — that is,
 * from an untrusted author — so every one is confined to the clone root before it
 * is opened. That confinement (lexical first, then `realpath`, in that order and
 * against two different roots) lives in `adapters/clone-reader/`, which is
 * shared with the project-context module; the reasoning for each check is in its
 * header comment. This file owns only the wording of a rejection and the caps.
 *
 * Nothing here throws. A path we will not read becomes a `missing` entry, which
 * is what stops the classifier from being told a document exists when it does not.
 * Truncation is deliberately silent: the classifier is told what the document
 * says, not how long it was.
 */
const REASON: Record<CloneReadFailure, string> = {
  outside: 'path resolves outside the repository',
  not_markdown: 'not a markdown file',
  not_found: 'not found in the repository clone',
};

export class CloneDocReader implements DocsPort {
  async read(
    clonePath: string,
    relPaths: string[],
  ): Promise<{ found: IntentDoc[]; missing: string[] }> {
    const found: IntentDoc[] = [];
    const missing: string[] = [];
    const reader = await CloneReader.open(clonePath);

    for (const rel of relPaths.slice(0, MAX_DOCS)) {
      const res = await reader.read(rel, MAX_DOC_BYTES);
      if (!res.ok) {
        missing.push(`${rel} was not read: ${REASON[res.reason]}`);
        continue;
      }
      found.push({ label: `doc:${rel}`, content: res.text });
    }

    for (const rel of relPaths.slice(MAX_DOCS)) {
      missing.push(`${rel} was not read: only ${MAX_DOCS} referenced documents are read per PR`);
    }

    return { found, missing };
  }
}
