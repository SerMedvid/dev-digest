/**
 * The prior-PRs use case, hermetic. The store is stubbed, so what is under test
 * is the only thing this module decides: the empty-paths short-circuit, the
 * caps, and that `overlap_count` stays truthful when `overlap_files` is cut.
 */
import { describe, it, expect, vi } from 'vitest';
import { BlastService } from '../src/modules/blast/service.js';
import type { BlastServiceDeps, PriorPrShape } from '../src/modules/blast/ports.js';
import { NotFoundError } from '../src/platform/errors.js';

const HEAD = 'a1b2c3d4e5f6';
const PULL = { id: 'pr-1', repoId: 'repo-1', headSha: HEAD };

function row(over: Partial<PriorPrShape> = {}): PriorPrShape {
  return {
    number: 478,
    title: 'Rate-limit public routes',
    author: 'sergii',
    status: 'merged',
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    overlapCount: 3,
    overlapFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    ...over,
  };
}

function build(opts: {
  pull?: typeof PULL | undefined;
  files?: string[];
  rows?: PriorPrShape[];
  uncomparable?: number;
}) {
  const priorPrs = vi.fn(async () => opts.rows ?? [row()]);
  const countPrsWithoutFiles = vi.fn(async () => opts.uncomparable ?? 0);
  const deps = {
    store: {
      getPull: async () => ('pull' in opts ? opts.pull : PULL),
      getPrFilePaths: async () => opts.files ?? ['src/a.ts'],
      priorPrs,
      countPrsWithoutFiles,
    },
    intel: {
      blastRadius: async () => ({
        changedSymbols: [], callers: [], impactedEndpoints: [], impactedCrons: [],
      }),
      indexState: async () => ({ status: 'full', lastIndexedSha: HEAD }),
    },
    summaries: { get: async () => undefined, put: async () => {} },
    model: async () => ({ provider: 'x', model: 'y', explain: async () => ({ summary: '' }) }),
  } as unknown as BlastServiceDeps;
  return { svc: new BlastService(deps), priorPrs, countPrsWithoutFiles };
}

describe('BlastService.priorPrs', () => {
  it('maps a row onto the wire shape', async () => {
    const { svc } = build({});
    const out = await svc.priorPrs('ws-1', 'pr-1');
    expect(out.prs).toEqual([
      {
        number: 478,
        title: 'Rate-limit public routes',
        author: 'sergii',
        status: 'merged',
        overlap_count: 3,
        overlap_files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ]);
  });

  it('caps the paths it ships WITHOUT capping the count', async () => {
    // The whole point of carrying both: a PR overlapping 40 files must say 40
    // and ship 5 paths, never claim 5.
    const many = Array.from({ length: 40 }, (_, i) => `src/f${i}.ts`);
    const { svc } = build({ rows: [row({ overlapCount: 40, overlapFiles: many })] });
    const out = await svc.priorPrs('ws-1', 'pr-1');
    expect(out.prs[0]!.overlap_count).toBe(40);
    expect(out.prs[0]!.overlap_files).toHaveLength(5);
    expect(out.prs[0]!.overlap_files[0]).toBe('src/f0.ts');
  });

  it('asks the store for at most MAX_PRIOR_PRS, scoped and excluding itself', async () => {
    const { svc, priorPrs } = build({ files: ['src/a.ts', 'src/b.ts'] });
    await svc.priorPrs('ws-1', 'pr-1');
    expect(priorPrs).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      repoId: 'repo-1',
      excludePrId: 'pr-1',
      paths: ['src/a.ts', 'src/b.ts'],
      statuses: ['merged', 'closed'],
      limit: 10,
    });
  });

  it('short-circuits with no stored paths, and never runs the join', async () => {
    const { svc, priorPrs } = build({ files: [], uncomparable: 4 });
    const out = await svc.priorPrs('ws-1', 'pr-1');
    expect(out.prs).toEqual([]);
    expect(priorPrs).not.toHaveBeenCalled();
    // The disclosure still has to be reported — that is the whole point of it.
    expect(out.uncomparable_prs).toBe(4);
  });

  it('reports how many PRs could not be compared', async () => {
    const { svc } = build({ uncomparable: 12 });
    expect((await svc.priorPrs('ws-1', 'pr-1')).uncomparable_prs).toBe(12);
  });

  it('404s on a PR in another workspace, like every other PR-scoped read', async () => {
    const { svc } = build({ pull: undefined });
    await expect(svc.priorPrs('ws-1', 'pr-1')).rejects.toBeInstanceOf(NotFoundError);
  });
});
