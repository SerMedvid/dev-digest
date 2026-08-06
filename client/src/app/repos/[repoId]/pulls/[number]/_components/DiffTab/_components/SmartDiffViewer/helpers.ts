/** Pure helpers for SmartDiffViewer: joining SmartDiff's grouped files with
 *  the PR's own patch text, and the §6.2 collapse precedence. */
import type { PrFile } from "@/lib/types";
import type { SmartDiffGroup, SmartDiffRole, SmartDiffFile } from "@devdigest/shared";
import { AUTO_EXPAND_MAX_LINES } from "./constants";

export interface JoinedFile {
  /** The grouped/marked/summarized record — no patch text. */
  smart: SmartDiffFile;
  /** The patch source. Falls back to a patch-less stand-in when the path is
   *  in the group but not among `files` (see `joinFilesWithGroups`). */
  file: PrFile;
}

export interface JoinedGroup {
  role: SmartDiffRole;
  files: JoinedFile[];
}

/** A finding-badge click's scroll target. `token` changes on every click —
 *  see `SmartDiffViewer.tsx` for why a value-only latch isn't enough. */
export interface ScrollTarget {
  path: string;
  line: number;
  token: number;
}

/**
 * `SmartDiff` carries no patch text — `PrFile.patch` does (`PrDetail.files`,
 * already passed to `DiffTab`). Join by path.
 *
 * A path present in a group but missing from `files` still renders (header,
 * stats, badge): it gets a patch-less `PrFile` stand-in instead of vanishing,
 * so a stale or partial `pr_files` row can't make Smart Diff throw or drop a
 * file the user can see it counted.
 */
export function joinFilesWithGroups(groups: SmartDiffGroup[], files: PrFile[]): JoinedGroup[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  return groups.map((g) => ({
    role: g.role,
    files: g.files.map((sf) => ({
      smart: sf,
      file: byPath.get(sf.path) ?? {
        path: sf.path,
        additions: sf.additions,
        deletions: sf.deletions,
        patch: null,
      },
    })),
  }));
}

/**
 * Collapse precedence, design §6.2, evaluated in this order:
 * 1. `boilerplate` starts collapsed — even carrying a finding. Its badge
 *    still shows, and clicking it expands the file.
 * 2. Otherwise a file with at least one finding starts expanded, whatever
 *    its size.
 * 3. Otherwise today's `AUTO_EXPAND_MAX_LINES` rule applies unchanged.
 *
 * `finding_lines` (always present) stands in for "has a finding" rather than
 * the nullish `finding_marks` — same underlying fact, one fewer null check.
 */
export function initialOpenState(groups: SmartDiffGroup[]): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  for (const g of groups) {
    for (const f of g.files) {
      if (g.role === "boilerplate") {
        state[f.path] = false;
      } else if (f.finding_lines.length > 0) {
        state[f.path] = true;
      } else {
        state[f.path] = f.additions + f.deletions <= AUTO_EXPAND_MAX_LINES;
      }
    }
  }
  return state;
}

/** The new-side line a file's finding badge scrolls to on click — the lowest
 *  of its (sorted) finding lines. `undefined` when the file carries none, so
 *  the caller knows not to render a badge at all. */
export function firstFindingLine(smart: SmartDiffFile): number | undefined {
  return smart.finding_lines.length > 0 ? smart.finding_lines[0] : undefined;
}

/** Total finding count across a group's files, for the badge and the
 *  `findingLines` meta line — the raw (non-deduplicated) mark count where
 *  it's known, else the deduplicated line count. */
export function findingCountFor(smart: SmartDiffFile): number {
  return smart.finding_marks?.length ?? smart.finding_lines.length;
}

/** Sum of each file's finding count, for a group's `{count} finding-lines`
 *  caption. */
export function groupFindingLineCount(files: SmartDiffFile[]): number {
  return files.reduce((sum, f) => sum + f.finding_lines.length, 0);
}
