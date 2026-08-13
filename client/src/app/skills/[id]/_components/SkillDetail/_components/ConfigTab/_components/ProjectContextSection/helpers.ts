import type { ContextAttachmentsView, ContextDoc } from "@devdigest/shared";

/**
 * One row of the skill editor's `Project context to use` list. A skill inherits
 * nothing, so a row is attached, merely discovered, or attached against another
 * repository — the agent editor's `inherited` kind has no counterpart here.
 */
export interface SkillContextRow {
  path: string;
  root: string;
  attached: boolean;
  /** Attached, but absent from the latest discovery result (AC-51). */
  missing: boolean;
  /**
   * The owning repository of an attachment made against a *different*
   * repository; null for every row of the active one. Non-null makes the row
   * inert: outside every count, replaced by no write scoped here (AC-50).
   */
  repoId: string | null;
  /**
   * Attached and stored, but past the per-run document cap — the run drops it
   * with the `read_cap` reason and the footer does not bill it (AC-25). The row
   * has to say so; otherwise it reads exactly like a row that is injected.
   */
  beyondReadCap: boolean;
}

/** First segment of a repo-relative POSIX path — the fallback root label. */
function rootOf(path: string): string {
  return path.split("/")[0] ?? path;
}

/**
 * This skill's attached paths for the active repository, in the order the server
 * stored them. That order is the payload of every replace, so it is read off the
 * view rather than re-derived from the discovery list. Rows belonging to another
 * repository are excluded: they are neither read nor replaced by a write scoped
 * to this repository.
 */
export function attachedPathsOf(
  view: ContextAttachmentsView | undefined | null,
  activeRepoId: string,
): string[] {
  return (view?.rows ?? [])
    .filter((row) => row.source === "direct" && row.repo_id === activeRepoId)
    .map((row) => row.path);
}

/**
 * Attached rows on top in their stored order, the rows attached against another
 * repository next, everything else below by root segment then path — the same
 * deliberate deviation from the comp that `SkillsTab` and the agent editor's
 * Context tab document: only attached rows have a stored order, so interleaving
 * would have to invent one for the rest and lose it on reload.
 *
 * `attachedPaths` is the *optimistic* list, so a toggle moves its row between the
 * two groups before the replace round-trips. A path that is attached but no
 * longer discovered keeps its row and its checkbox (AC-51).
 */
export function orderRows(
  docs: ContextDoc[],
  view: ContextAttachmentsView | undefined | null,
  attachedPaths: string[],
  activeRepoId: string,
): SkillContextRow[] {
  const byPath = new Map(docs.map((doc) => [doc.path, doc]));
  // This repository's rows only. A cross-repository row carries the same path
  // but zeroed figures and its own `missing`, so letting one into this map would
  // let it describe a document that is genuinely attached here.
  const stored = new Map(
    (view?.rows ?? [])
      .filter((row) => row.repo_id === activeRepoId)
      .map((row) => [row.path, row]),
  );

  const attached: SkillContextRow[] = attachedPaths.map((path) => {
    const doc = byPath.get(path);
    const row = stored.get(path);
    return {
      path,
      root: doc?.root ?? row?.root ?? rootOf(path),
      attached: true,
      missing: row ? row.missing : doc === undefined,
      repoId: null,
      beyondReadCap: row?.beyond_read_cap === true,
    };
  });

  /* AC-50: an attachment made against another repository. It is neither read
     nor replaced by a write scoped to this one, so hiding it made a document
     that is still injected on that repository's runs invisible here. Not
     deduped on the path: the server keys these rows by repository *and* path, so
     one document attached in two repositories is two rows, and both are shown. */
  const elsewhere: SkillContextRow[] = (view?.rows ?? [])
    .filter((row) => row.repo_id !== activeRepoId)
    .map((row) => ({
      path: row.path,
      root: row.root,
      attached: true,
      missing: row.missing,
      repoId: row.repo_id,
      // Not this repository's run at all, so the per-run cap does not describe
      // it — it is already outside every count.
      beyondReadCap: false,
    }));

  const taken = new Set(attachedPaths);
  const rest: SkillContextRow[] = docs
    .filter((doc) => !taken.has(doc.path))
    .sort((a, b) => a.root.localeCompare(b.root) || a.path.localeCompare(b.path))
    .map((doc) => ({
      path: doc.path,
      root: doc.root,
      attached: false,
      missing: false,
      repoId: null,
      // Nothing unattached is read at all, so the cap has nothing to say here.
      beyondReadCap: false,
    }));

  return [...attached, ...elsewhere, ...rest];
}
