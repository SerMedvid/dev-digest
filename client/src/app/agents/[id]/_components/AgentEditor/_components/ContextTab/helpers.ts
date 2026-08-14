import type { ContextAttachmentsView, ContextDoc } from "@devdigest/shared";

/**
 * What a row is, which decides what it may do:
 *
 * - `direct` — attached to this agent for this repository. Detachable, draggable.
 * - `inherited` — carried by an enabled linked skill. Read on every run, but the
 *   agent does not own it: no detach control, no handle, a link to the skill.
 * - `elsewhere` — the agent's own attachment for a *different* repository. Inert
 *   here, outside every count, shown so it is not invisible (AC-50).
 * - `unattached` — discovered in the clone and not attached.
 */
export type ContextRowKind = "direct" | "inherited" | "elsewhere" | "unattached";

export interface ContextRowModel {
  path: string;
  root: string;
  sizeBytes: number;
  tokenEstimate: number;
  kind: ContextRowKind;
  /** The skill an `inherited` row comes from; null otherwise. */
  skillId: string | null;
  skillName: string | null;
  /** Attached, but absent from the latest discovery result (AC-51). */
  missing: boolean;
  /** The owning repository of an `elsewhere` row; null otherwise. */
  repoId: string | null;
  /**
   * Stored and effective, but past the per-run document cap — the run drops it
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
 * This repository's directly attached paths, in the order the server stored
 * them. That order is the payload of every replace, so it is read from the view
 * rather than re-derived from the discovery list.
 */
export function directPathsOf(
  view: ContextAttachmentsView | undefined | null,
  activeRepoId: string,
): string[] {
  return (view?.rows ?? [])
    .filter((row) => row.source === "direct" && row.repo_id === activeRepoId)
    .map((row) => row.path);
}

/**
 * Attached rows on top, unattached below — the deliberate deviation from the
 * comp that `SkillsTab` already documents (AC-45): only attached rows have a
 * stored order, so interleaving would have to invent one for the rest and lose
 * it on reload. Unattached rows are ordered by root segment, then path.
 *
 * `directPaths` is the *optimistic* list, so a toggle moves its row between the
 * two groups before the replace round-trips; every other row comes from the
 * view. Figures are never recomputed here — the token estimate on an attached
 * row is the server's, counted over the text the run injects (AC-66).
 */
export function orderRows(
  docs: ContextDoc[],
  view: ContextAttachmentsView | undefined | null,
  { activeRepoId, directPaths }: { activeRepoId: string; directPaths: string[] },
): ContextRowModel[] {
  const byPath = new Map(docs.map((doc) => [doc.path, doc]));
  // This repository's rows only, and keyed by path only because of that filter.
  // The server returns `[...rows, ...elsewhere]`, which is keyed by repository
  // *and* path, so the same document attached in two repositories appears twice;
  // keyed by path alone the later (cross-repository) entry won and described the
  // row attached here — with the figures the server deliberately zeroed and a
  // `missing: false` that re-enabled the preview on a document that would 404.
  const attached = new Map(
    (view?.rows ?? [])
      .filter((row) => row.repo_id === activeRepoId)
      .map((row) => [row.path, row]),
  );

  const direct: ContextRowModel[] = directPaths.map((path) => {
    const row = attached.get(path);
    const doc = byPath.get(path);
    return {
      path,
      root: doc?.root ?? row?.root ?? rootOf(path),
      sizeBytes: doc?.size_bytes ?? row?.size_bytes ?? 0,
      tokenEstimate: row?.token_estimate ?? doc?.token_estimate ?? 0,
      kind: "direct",
      skillId: null,
      skillName: null,
      missing: row ? row.missing : doc === undefined,
      repoId: null,
      beyondReadCap: row?.beyond_read_cap === true,
    };
  });

  // A path attached both directly and through a skill is one row, exactly as the
  // run reads it once (AC-67). The server has already deduped; this guards the
  // optimistic window, where a direct path may not be in the view yet.
  const taken = new Set(direct.map((row) => row.path));

  const inherited: ContextRowModel[] = [];
  const elsewhere: ContextRowModel[] = [];
  for (const row of view?.rows ?? []) {
    if (row.repo_id !== activeRepoId) {
      elsewhere.push({
        path: row.path,
        root: row.root,
        sizeBytes: row.size_bytes,
        tokenEstimate: row.token_estimate,
        kind: "elsewhere",
        skillId: null,
        skillName: null,
        missing: row.missing,
        repoId: row.repo_id,
        // Not this repository's run at all, so the per-run cap does not describe
        // it — it is already outside every count.
        beyondReadCap: false,
      });
      continue;
    }
    if (row.source !== "inherited" || taken.has(row.path)) continue;
    taken.add(row.path);
    inherited.push({
      path: row.path,
      root: row.root,
      sizeBytes: row.size_bytes,
      tokenEstimate: row.token_estimate,
      kind: "inherited",
      skillId: row.skill_id,
      skillName: row.skill_name,
      missing: row.missing,
      repoId: null,
      beyondReadCap: row.beyond_read_cap === true,
    });
  }

  const unattached: ContextRowModel[] = docs
    .filter((doc) => !taken.has(doc.path))
    .sort((a, b) => a.root.localeCompare(b.root) || a.path.localeCompare(b.path))
    .map((doc) => ({
      path: doc.path,
      root: doc.root,
      sizeBytes: doc.size_bytes,
      tokenEstimate: doc.token_estimate,
      kind: "unattached",
      skillId: null,
      skillName: null,
      missing: false,
      repoId: null,
      // Nothing unattached is read at all, so the cap has nothing to say here.
      beyondReadCap: false,
    }));

  return [...direct, ...inherited, ...elsewhere, ...unattached];
}

/** Reorder the attached paths by moving one entry. */
export function moveAttached(paths: string[], from: number, to: number): string[] {
  if (from === to) return paths;
  const next = [...paths];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return paths;
  next.splice(to, 0, moved);
  return next;
}
