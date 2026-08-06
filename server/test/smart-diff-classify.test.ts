import { describe, expect, it } from 'vitest';
import type { FindingMark } from '@devdigest/shared';
import {
  FALLBACK_SPLIT_NAME,
  MAX_PROPOSED_SPLITS,
  ROOT_SPLIT_NAME,
  SPLIT_FILES_MAX,
  SPLIT_LINES_MAX,
} from '../src/modules/smart-diff/constants.js';
import {
  classifyPath,
  groupFiles,
  splitSuggestion,
  type FileStat,
} from '../src/modules/smart-diff/helpers.js';

/**
 * Hermetic — no DB, no Fastify app. Pure functions over paths and diff stats.
 * Every threshold is imported from constants.ts, never restated as a literal.
 */

describe('classifyPath', () => {
  it.each([
    // boilerplate: lock files, generated dirs, snapshots, binary assets, docs
    ['pnpm-lock.yaml', 'boilerplate'],
    ['dist/index.js', 'boilerplate'], // evaluation order: boilerplate checked before wiring
    ['src/__snapshots__/a.snap', 'boilerplate'],
    ['assets/logo.png', 'boilerplate'],
    ['README.md', 'boilerplate'],
    ['docs/guide.md', 'boilerplate'],
    ['server/src/db/migrations/0001_x.sql', 'boilerplate'],
    // core: a hand-written .sql outside migrations/, plain code, tests
    ['scripts/query.sql', 'core'],
    ['src/api/users.ts', 'core'],
    ['src/api/users.test.ts', 'core'],
    // wiring: barrels, entrypoints, config, package.json, CI yaml
    ['src/index.ts', 'wiring'],
    ['src/server.ts', 'wiring'],
    ['src/config.ts', 'wiring'],
    ['vitest.config.ts', 'wiring'],
    ['package.json', 'wiring'],
    ['.github/workflows/ci.yml', 'wiring'],
  ] as const)('%s -> %s', (path, role) => {
    expect(classifyPath(path)).toBe(role);
  });

  it('classifies a fixture matching more than one boilerplate pattern the same as any other', () => {
    // package-lock.json is both a lock file and would match no other list —
    // regression guard against a future pattern addition breaking this.
    expect(classifyPath('package-lock.json')).toBe('boilerplate');
  });
});

describe('groupFiles', () => {
  const mark = (line: number, id: string): FindingMark => ({
    line,
    severity: 'WARNING',
    finding_id: id,
  });

  it('emits groups in core -> wiring -> boilerplate order, present-only', () => {
    const files: FileStat[] = [
      { path: 'README.md', additions: 1, deletions: 0 },
      { path: 'src/index.ts', additions: 2, deletions: 0 },
      { path: 'src/api/users.ts', additions: 3, deletions: 0 },
    ];
    const groups = groupFiles(files, new Map(), new Map());
    expect(groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
  });

  it('omits a role with no files rather than emitting an empty group', () => {
    const files: FileStat[] = [{ path: 'src/api/users.ts', additions: 3, deletions: 0 }];
    const groups = groupFiles(files, new Map(), new Map());
    expect(groups).toHaveLength(1);
    expect(groups[0]!.role).toBe('core');
  });

  it('sorts within a group by finding count desc, then changed lines desc, then path asc', () => {
    const files: FileStat[] = [
      { path: 'src/api/c.ts', additions: 10, deletions: 0 }, // 0 findings, 10 lines
      { path: 'src/api/a.ts', additions: 5, deletions: 0 }, // 1 finding, 5 lines
      { path: 'src/api/b.ts', additions: 50, deletions: 0 }, // 0 findings, 50 lines
      { path: 'src/api/z.ts', additions: 1, deletions: 1 }, // tie with y.ts: 0 findings, 2 lines
      { path: 'src/api/y.ts', additions: 1, deletions: 1 }, // tie with z.ts: 0 findings, 2 lines
    ];
    const marksByPath = new Map<string, FindingMark[]>([['src/api/a.ts', [mark(1, 'f1')]]]);
    const groups = groupFiles(files, marksByPath, new Map());
    const order = groups[0]!.files.map((f) => f.path);
    // a.ts leads (has a finding); then b.ts (50 lines) > c.ts (10 lines);
    // y.ts and z.ts tie on count and lines, so the path tiebreak decides.
    expect(order).toEqual(['src/api/a.ts', 'src/api/b.ts', 'src/api/c.ts', 'src/api/y.ts', 'src/api/z.ts']);
  });

  it('derives finding_lines as the sorted, de-duplicated projection of finding_marks', () => {
    const files: FileStat[] = [{ path: 'src/api/a.ts', additions: 5, deletions: 0 }];
    const marksByPath = new Map<string, FindingMark[]>([
      ['src/api/a.ts', [mark(52, 'f2'), mark(28, 'f1'), mark(28, 'f3')]],
    ]);
    const groups = groupFiles(files, marksByPath, new Map());
    const file = groups[0]!.files[0]!;
    expect(file.finding_lines).toEqual([28, 52]);
    expect(file.finding_marks).toEqual([mark(52, 'f2'), mark(28, 'f1'), mark(28, 'f3')]);
  });

  it('sets finding_marks to an empty array (never undefined) when a file has no findings', () => {
    const files: FileStat[] = [{ path: 'src/api/a.ts', additions: 5, deletions: 0 }];
    const groups = groupFiles(files, new Map(), new Map());
    const file = groups[0]!.files[0]!;
    expect(file.finding_marks).toEqual([]);
    expect(file.finding_lines).toEqual([]);
  });

  it('fills pseudocode_summary from summaryByPath, else null', () => {
    const files: FileStat[] = [
      { path: 'src/api/a.ts', additions: 5, deletions: 0 },
      { path: 'src/api/b.ts', additions: 5, deletions: 0 },
    ];
    const summaryByPath = new Map([['src/api/a.ts', 'Adds a rate limiter.']]);
    const groups = groupFiles(files, new Map(), summaryByPath);
    const byPath = Object.fromEntries(groups[0]!.files.map((f) => [f.path, f]));
    expect(byPath['src/api/a.ts']!.pseudocode_summary).toBe('Adds a rate limiter.');
    expect(byPath['src/api/b.ts']!.pseudocode_summary).toBeNull();
  });
});

describe('splitSuggestion', () => {
  it('total_lines sums additions+deletions across ALL files, boilerplate included', () => {
    const files: FileStat[] = [
      { path: 'src/api/a.ts', additions: 10, deletions: 5 },
      { path: 'package-lock.json', additions: 92, deletions: 24 },
    ];
    const result = splitSuggestion(files);
    expect(result.total_lines).toBe(131);
  });

  it('too_big is false and proposed_splits is [] for a small PR', () => {
    const files: FileStat[] = [{ path: 'src/api/a.ts', additions: 10, deletions: 5 }];
    const result = splitSuggestion(files);
    expect(result.too_big).toBe(false);
    expect(result.proposed_splits).toEqual([]);
  });

  it('too_big fires on the line threshold alone', () => {
    const files: FileStat[] = [{ path: 'src/a.ts', additions: SPLIT_LINES_MAX + 1, deletions: 0 }];
    expect(splitSuggestion(files).too_big).toBe(true);
  });

  it('too_big fires on the file-count threshold alone', () => {
    const files: FileStat[] = Array.from({ length: SPLIT_FILES_MAX + 1 }, (_, i) => ({
      path: `src/f${i}.ts`,
      additions: 1,
      deletions: 0,
    }));
    expect(splitSuggestion(files).too_big).toBe(true);
  });

  it('a single-prefix large PR yields no splits, even though too_big', () => {
    const files: FileStat[] = Array.from({ length: 3 }, (_, i) => ({
      path: `src/api/f${i}.ts`,
      additions: SPLIT_LINES_MAX,
      deletions: 0,
    }));
    const result = splitSuggestion(files);
    expect(result.too_big).toBe(true);
    expect(result.proposed_splits).toEqual([]);
  });

  it('groups by two-segment directory prefix, ordered by lines desc, excluding boilerplate', () => {
    const files: FileStat[] = [
      { path: 'src/api/a.ts', additions: 50, deletions: 0 },
      { path: 'src/middleware/b.ts', additions: 200, deletions: 0 },
      { path: 'src/jobs/c.ts', additions: 100, deletions: 0 },
      { path: 'package-lock.json', additions: 9999, deletions: 0 }, // boilerplate, must be excluded
    ];
    const result = splitSuggestion(files);
    expect(result.too_big).toBe(true);
    expect(result.proposed_splits.map((s) => s.name)).toEqual([
      'src/middleware',
      'src/jobs',
      'src/api',
    ]);
    expect(result.proposed_splits.every((s) => !s.files.includes('package-lock.json'))).toBe(true);
    const totalSplitFiles = result.proposed_splits.flatMap((s) => s.files);
    expect(totalSplitFiles.sort()).toEqual(
      ['src/api/a.ts', 'src/middleware/b.ts', 'src/jobs/c.ts'].sort(),
    );
  });

  it('caps at MAX_PROPOSED_SPLITS, folding the remainder into FALLBACK_SPLIT_NAME', () => {
    // 6 distinct prefixes, decreasing size, all core/wiring so all eligible.
    const files: FileStat[] = Array.from({ length: 6 }, (_, i) => ({
      path: `src/area${i}/f.ts`,
      additions: (6 - i) * 100, // area0 largest ... area5 smallest
      deletions: 0,
    }));
    const result = splitSuggestion(files);
    expect(result.too_big).toBe(true);
    expect(result.proposed_splits).toHaveLength(MAX_PROPOSED_SPLITS);
    const names = result.proposed_splits.map((s) => s.name);
    expect(names[names.length - 1]).toBe(FALLBACK_SPLIT_NAME);
    // the first MAX_PROPOSED_SPLITS - 1 kept splits are the largest, in order
    expect(names.slice(0, MAX_PROPOSED_SPLITS - 1)).toEqual([
      'src/area0',
      'src/area1',
      'src/area2',
    ]);
    const fallback = result.proposed_splits[result.proposed_splits.length - 1]!;
    expect(fallback.files.sort()).toEqual(['src/area3/f.ts', 'src/area4/f.ts', 'src/area5/f.ts']);
  });

  it('groups a repo-root file under ROOT_SPLIT_NAME', () => {
    const files: FileStat[] = [
      { path: 'package.json', additions: SPLIT_LINES_MAX, deletions: 0 }, // wiring, eligible
      { path: 'src/api/a.ts', additions: SPLIT_LINES_MAX, deletions: 0 },
    ];
    const result = splitSuggestion(files);
    expect(result.too_big).toBe(true);
    expect(result.proposed_splits.map((s) => s.name)).toContain(ROOT_SPLIT_NAME);
  });
});
