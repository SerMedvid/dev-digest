import { describe, it, expect } from 'vitest';
import { assembleSections, isRenderableMermaid } from '../src/modules/onboarding/helpers.js';
import type { FactsSkeleton, Narrative } from '../src/modules/onboarding/domain.js';

/**
 * The grounding gate. The skeleton is the authority: the model's prose is
 * attached to it by path or index, and anything that does not match is
 * discarded. These tests are what stop a hallucinated path reaching the page.
 */

const facts: FactsSkeleton = {
  criticalPaths: [
    { path: 'src/server.ts', percentile: 99 },
    { path: 'src/lib/redis.ts', percentile: 88 },
  ],
  readingPath: [{ path: 'src/server.ts', percentile: 99 }],
  chains: [],
  commands: ['pnpm install', 'pnpm dev'],
  repoMap: 'MAP',
  indexedFiles: 10,
  indexSha: 'sha-1',
};

const narrative = (over: Partial<Narrative> = {}): Narrative => ({
  architecture: { body: 'body', diagram: 'flowchart LR\n  A --> B' },
  criticalPathNotes: [{ path: 'src/server.ts', note: 'bootstrap' }],
  readingPathNotes: [{ path: 'src/server.ts', note: 'start here' }],
  commandComments: [{ index: 1, comment: 'localhost:3000' }],
  firstTasks: [{ title: 'T', body: 'B', path: 'src/server.ts' }],
  ...over,
});

describe('isRenderableMermaid', () => {
  it('accepts a simple flowchart', () => {
    expect(isRenderableMermaid('flowchart LR\n  A --> B')).toBe(true);
  });

  it('rejects fences, prose, empty strings and null', () => {
    expect(isRenderableMermaid('```mermaid\nflowchart LR\n A --> B\n```')).toBe(false);
    expect(isRenderableMermaid('Here is a diagram of the system.')).toBe(false);
    expect(isRenderableMermaid('')).toBe(false);
    expect(isRenderableMermaid(null)).toBe(false);
  });

  it('rejects a flowchart with no edge', () => {
    expect(isRenderableMermaid('flowchart LR\n  A')).toBe(false);
  });
});

describe('assembleSections', () => {
  it('emits the five sections in the fixed order', () => {
    expect(assembleSections(facts, narrative()).map((s) => s.id)).toEqual([
      'architecture',
      'critical_paths',
      'run_locally',
      'reading_path',
      'first_tasks',
    ]);
  });

  it('keeps a skeleton file whose note the model omitted, with a null note', () => {
    const files = assembleSections(facts, narrative()).find((s) => s.id === 'critical_paths')!.files;
    expect(files.map((f) => f.path)).toEqual(['src/server.ts', 'src/lib/redis.ts']);
    expect(files[1]!.note).toBeNull();
  });

  it('ignores a note for a path that is not in the skeleton', () => {
    const n = narrative({ criticalPathNotes: [{ path: 'src/ghost.ts', note: 'invented' }] });
    const files = assembleSections(facts, n).find((s) => s.id === 'critical_paths')!.files;
    expect(files.every((f) => f.note === null)).toBe(true);
    expect(files.some((f) => f.path === 'src/ghost.ts')).toBe(false);
  });

  it('drops a first task citing an unknown path', () => {
    const n = narrative({ firstTasks: [{ title: 'T', body: 'B', path: 'src/ghost.ts' }] });
    expect(assembleSections(facts, n).find((s) => s.id === 'first_tasks')!.tasks).toEqual([]);
  });

  it('caps the first tasks', () => {
    const n = narrative({
      firstTasks: Array.from({ length: 10 }, (_, i) => ({
        title: `T${i}`,
        body: 'B',
        path: 'src/server.ts',
      })),
    });
    expect(
      assembleSections(facts, n).find((s) => s.id === 'first_tasks')!.tasks.length,
    ).toBeLessThanOrEqual(4);
  });

  it('nulls a diagram that would not render', () => {
    const n = narrative({ architecture: { body: 'b', diagram: 'not a diagram' } });
    expect(assembleSections(facts, n).find((s) => s.id === 'architecture')!.diagram).toBeNull();
  });

  it('attaches command comments by index and keeps uncommented commands', () => {
    const cmds = assembleSections(facts, narrative()).find((s) => s.id === 'run_locally')!.commands;
    expect(cmds).toEqual([
      { command: 'pnpm install', comment: null },
      { command: 'pnpm dev', comment: 'localhost:3000' },
    ]);
  });

  it('ignores a command comment whose index is out of range', () => {
    const n = narrative({ commandComments: [{ index: 9, comment: 'nope' }] });
    const cmds = assembleSections(facts, n).find((s) => s.id === 'run_locally')!.commands;
    expect(cmds.every((c) => c.comment === null)).toBe(true);
  });

  it('keeps the reading path in the skeleton order, not the model order', () => {
    const twoDeep: FactsSkeleton = {
      ...facts,
      readingPath: [
        { path: 'src/server.ts', percentile: 99 },
        { path: 'src/lib/redis.ts', percentile: 88 },
      ],
    };
    const n = narrative({
      readingPathNotes: [
        { path: 'src/lib/redis.ts', note: 'second' },
        { path: 'src/server.ts', note: 'first' },
      ],
    });
    const files = assembleSections(twoDeep, n).find((s) => s.id === 'reading_path')!.files;
    expect(files.map((f) => f.path)).toEqual(['src/server.ts', 'src/lib/redis.ts']);
    expect(files.map((f) => f.note)).toEqual(['first', 'second']);
  });

  it('survives an entirely empty skeleton without throwing', () => {
    const empty: FactsSkeleton = {
      criticalPaths: [],
      readingPath: [],
      chains: [],
      commands: [],
      repoMap: '',
      indexedFiles: 0,
      indexSha: '',
    };
    const sections = assembleSections(empty, narrative());
    expect(sections).toHaveLength(5);
    expect(sections.find((s) => s.id === 'critical_paths')!.files).toEqual([]);
    expect(sections.find((s) => s.id === 'first_tasks')!.tasks).toEqual([]);
  });
});
