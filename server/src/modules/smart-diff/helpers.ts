import type { FindingMark, SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import {
  BINARY_ASSET_EXTENSIONS,
  FALLBACK_SPLIT_NAME,
  GENERATED_DIR_SEGMENTS,
  GENERATED_FILE_PATTERNS,
  LOCK_FILES,
  MAX_PROPOSED_SPLITS,
  ROOT_SPLIT_NAME,
  SNAPSHOT_PATTERNS,
  SPLIT_FILES_MAX,
  SPLIT_LINES_MAX,
  WIRING_BARRELS,
  WIRING_CONFIG_PATTERNS,
  WIRING_ENTRYPOINTS,
} from './constants.js';

/**
 * Pure transforms for the smart-diff module (no I/O, no `this`, no imports
 * outside `constants.ts` and `@devdigest/shared` types).
 *
 * `classifyPath` is path-and-diff-stat-only: no file contents, no index, no
 * model, no network. The same PR classifies the same way on any machine,
 * before any review, forever.
 */

export interface FileStat {
  path: string;
  additions: number;
  deletions: number;
}

/** Two markdown/docs rules with no dedicated constant (design §2.1): a doc is
 * boilerplate by extension or by living under a `docs/` directory. */
const MARKDOWN_EXT = /\.md$/i;
const DOCS_DIR = /(^|\/)docs\//i;
/** Generated SQL: anything under a `migrations/` segment. A hand-written
 * `.sql` elsewhere is core (design §2.1). */
const MIGRATIONS_SQL = /(^|\/)migrations\/.*\.sql$/i;

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

function extname(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

function hasDirSegment(path: string, segment: string): boolean {
  return path.split('/').includes(segment);
}

function isBoilerplate(path: string): boolean {
  const base = basename(path);
  if ((LOCK_FILES as readonly string[]).includes(base)) return true;
  if (GENERATED_DIR_SEGMENTS.some((seg) => hasDirSegment(path, seg))) return true;
  if (SNAPSHOT_PATTERNS.some((re) => re.test(path))) return true;
  if (GENERATED_FILE_PATTERNS.some((re) => re.test(path))) return true;
  if ((BINARY_ASSET_EXTENSIONS as readonly string[]).includes(extname(path))) return true;
  if (MARKDOWN_EXT.test(path) || DOCS_DIR.test(path)) return true;
  if (MIGRATIONS_SQL.test(path)) return true;
  return false;
}

function isWiring(path: string): boolean {
  const base = basename(path);
  if ((WIRING_BARRELS as readonly string[]).includes(base)) return true;
  if ((WIRING_ENTRYPOINTS as readonly string[]).includes(base)) return true;
  if (WIRING_CONFIG_PATTERNS.some((re) => re.test(path))) return true;
  return false;
}

/**
 * Boilerplate is tested **before** wiring: `dist/index.js` is generated
 * output, not a barrel, and evaluating in the other order would file it under
 * wiring. `core` is the default — everything not caught above, including
 * tests (substance, not skim) and a hand-written `.sql` outside
 * `migrations/`.
 */
export function classifyPath(path: string): SmartDiffRole {
  if (isBoilerplate(path)) return 'boilerplate';
  if (isWiring(path)) return 'wiring';
  return 'core';
}

const GROUP_ORDER: readonly SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

function compareFiles(a: SmartDiffFile, b: SmartDiffFile): number {
  const countDiff = (b.finding_marks?.length ?? 0) - (a.finding_marks?.length ?? 0);
  if (countDiff !== 0) return countDiff;
  const linesDiff = b.additions + b.deletions - (a.additions + a.deletions);
  if (linesDiff !== 0) return linesDiff;
  // Total tiebreak: two files that tie on both counts must still sort
  // identically on every run, or a rendered order depends on whatever
  // ordering the caller's Postgres query happened to return.
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

/**
 * Groups a PR's files into `core` / `wiring` / `boilerplate`, present-only,
 * in `core -> wiring -> boilerplate` order. Within a group, files sort by
 * finding count desc, then changed lines desc, then path asc (total order).
 *
 * `finding_lines` is derived here, and nowhere else, as the sorted
 * de-duplicated projection of `finding_marks` — the two fields ship
 * separately on the wire but can never disagree because only this function
 * produces either of them.
 */
export function groupFiles(
  files: FileStat[],
  marksByPath: Map<string, FindingMark[]>,
  summaryByPath: Map<string, string>,
): SmartDiffGroup[] {
  const byRole = new Map<SmartDiffRole, SmartDiffFile[]>();
  for (const f of files) {
    const role = classifyPath(f.path);
    const marks = marksByPath.get(f.path) ?? [];
    const findingLines = [...new Set(marks.map((m) => m.line))].sort((a, b) => a - b);
    const file: SmartDiffFile = {
      path: f.path,
      pseudocode_summary: summaryByPath.get(f.path) ?? null,
      additions: f.additions,
      deletions: f.deletions,
      finding_lines: findingLines,
      finding_marks: marks,
    };
    const list = byRole.get(role);
    if (list) list.push(file);
    else byRole.set(role, [file]);
  }

  const groups: SmartDiffGroup[] = [];
  for (const role of GROUP_ORDER) {
    const list = byRole.get(role);
    if (!list || list.length === 0) continue;
    list.sort(compareFiles);
    groups.push({ role, files: list });
  }
  return groups;
}

/**
 * A file's split-grouping key: the full directory path (every segment before
 * the basename). A file with only one directory segment groups under that
 * segment; a file at the repository root (no `/` at all) groups under
 * `ROOT_SPLIT_NAME`.
 */
function prefixFor(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? ROOT_SPLIT_NAME : path.slice(0, idx);
}

/**
 * `total_lines` sums additions+deletions over **all** files, boilerplate
 * included — a 1200-line lock-file bump is a large PR to pull and rebase,
 * however little of it gets read. `too_big` fires on either threshold.
 *
 * When too_big, splits are formed from `core`/`wiring` files only (a lock
 * file never forms a split), grouped by directory prefix, ordered by changed
 * lines descending, and capped at `MAX_PROPOSED_SPLITS` with the remainder
 * folded into one final `FALLBACK_SPLIT_NAME` split. Fewer than two prefix
 * groups (the PR is large but concentrated in one area) yields `[]` — an
 * honest "there is no plan here" rather than a one-item list pretending to be
 * one.
 */
export function splitSuggestion(files: FileStat[]): SmartDiff['split_suggestion'] {
  const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const tooBig = totalLines > SPLIT_LINES_MAX || files.length > SPLIT_FILES_MAX;
  if (!tooBig) {
    return { too_big: false, total_lines: totalLines, proposed_splits: [] };
  }

  const eligible = files.filter((f) => classifyPath(f.path) !== 'boilerplate');
  const byPrefix = new Map<string, { files: string[]; lines: number }>();
  for (const f of eligible) {
    const prefix = prefixFor(f.path);
    const entry = byPrefix.get(prefix);
    const lines = f.additions + f.deletions;
    if (entry) {
      entry.files.push(f.path);
      entry.lines += lines;
    } else {
      byPrefix.set(prefix, { files: [f.path], lines });
    }
  }

  const prefixGroups = [...byPrefix.entries()].map(([name, v]) => ({
    name,
    files: v.files,
    lines: v.lines,
  }));

  if (prefixGroups.length < 2) {
    return { too_big: true, total_lines: totalLines, proposed_splits: [] };
  }

  prefixGroups.sort((a, b) => b.lines - a.lines);

  if (prefixGroups.length <= MAX_PROPOSED_SPLITS) {
    return {
      too_big: true,
      total_lines: totalLines,
      proposed_splits: prefixGroups.map(({ name, files: fs }) => ({ name, files: fs })),
    };
  }

  const kept = prefixGroups.slice(0, MAX_PROPOSED_SPLITS - 1);
  const remainder = prefixGroups.slice(MAX_PROPOSED_SPLITS - 1);
  return {
    too_big: true,
    total_lines: totalLines,
    proposed_splits: [
      ...kept.map(({ name, files: fs }) => ({ name, files: fs })),
      { name: FALLBACK_SPLIT_NAME, files: remainder.flatMap((g) => g.files) },
    ],
  };
}
