/**
 * repo-intel — the persistent blast path (`tryPersistentBlast`), hermetic.
 *
 * No Postgres and no clone: the service's `repo` is patched the way
 * repo-intel-facade-degraded.test.ts does it, so the composition inside the
 * service is the only thing under test.
 */
import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';

interface SymRow {
  path: string;
  name: string;
  kind: string;
  line: number;
  endLine: number | null;
  exported: boolean;
  signature: string | null;
}
interface CallerRow {
  fromPath: string;
  toSymbol: string;
  line: number;
  rank: number;
}
interface FactsRow {
  filePath: string;
  endpoints: string[];
  crons: string[];
}

function sym(path: string, name: string, line: number): SymRow {
  return { path, name, kind: 'function', line, endLine: line + 5, exported: true, signature: null };
}

/**
 * Build a service whose repository serves the given fixtures. `getSymbolRows`
 * is called twice with different path sets (declarations, then caller files),
 * so the stub answers from one table keyed by path.
 */
function buildService(opts: {
  symbolsByPath?: SymRow[];
  callers?: CallerRow[];
  dependents?: string[];
  facts?: FactsRow[];
  indexStatus?: 'full' | 'partial' | 'degraded' | 'failed';
  flag?: boolean;
  clonePath?: string | null;
}): { svc: RepoIntelService; factsAskedFor: string[][] } {
  const container = {
    config: { repoIntelEnabled: opts.flag ?? true },
    db: {} as never,
    codeIndex: { symbols: async () => [], references: async () => [] } as never,
  } as never;
  const svc = new RepoIntelService(container);
  const factsAskedFor: string[][] = [];
  const all = opts.symbolsByPath ?? [];

  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    tryGetIndexState: async () => ({ status: opts.indexStatus ?? 'full' }),
    getSymbolRows: async (_r: string, paths: string[]) =>
      all.filter((s) => paths.includes(s.path)),
    getResolvedCallers: async () => opts.callers ?? [],
    getReverseDependents: async () => opts.dependents ?? [],
    getFileFacts: async (_r: string, files: string[]) => {
      factsAskedFor.push([...files].sort());
      return (opts.facts ?? []).filter((f) => files.includes(f.filePath));
    },
    getRepoBasics: async () =>
      opts.clonePath === undefined
        ? null
        : { id: 'r1', owner: 'a', name: 'b', defaultBranch: 'main', clonePath: opts.clonePath },
  };
  return { svc, factsAskedFor };
}

describe('tryPersistentBlast — per-symbol caller cap', () => {
  it('caps each viaSymbol group at MAX_CALLERS_PER_SYMBOL, not the flat list', async () => {
    // 25 callers of `alpha` and 3 of `beta`. A global slice(0, 20) over a
    // rank-sorted list would drop `beta` entirely — that is the bug.
    const callers: CallerRow[] = [];
    for (let i = 0; i < 25; i++) {
      callers.push({ fromPath: `src/a${i}.ts`, toSymbol: 'alpha', line: 10, rank: 0.9 - i * 0.01 });
    }
    for (let i = 0; i < 3; i++) {
      // Deliberately the LOWEST ranks in the whole set.
      callers.push({ fromPath: `src/b${i}.ts`, toSymbol: 'beta', line: 20, rank: 0.001 * i });
    }

    const { svc } = buildService({
      symbolsByPath: [sym('src/lib.ts', 'alpha', 12), sym('src/lib.ts', 'beta', 41)],
      callers,
    });
    const res = await svc.getBlastRadius('r1', ['src/lib.ts']);

    const forAlpha = res.callers.filter((c) => c.viaSymbol === 'alpha');
    const forBeta = res.callers.filter((c) => c.viaSymbol === 'beta');
    expect(forAlpha).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(forBeta).toHaveLength(3);

    // Kept alpha callers are the highest-ranked ones, in descending order.
    const ranks = forAlpha.map((c) => c.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(ranks[0]).toBeCloseTo(0.9);
    expect(Math.min(...ranks)).toBeCloseTo(0.9 - 19 * 0.01);
  });
});

describe('tryPersistentBlast — BFS-widened facts', () => {
  it('attributes endpoints and crons from a reverse dependent with no reference row', async () => {
    const { svc, factsAskedFor } = buildService({
      symbolsByPath: [sym('src/lib/helper.ts', 'helper', 7)],
      callers: [{ fromPath: 'src/service.ts', toSymbol: 'helper', line: 30, rank: 0.7 }],
      // routes.ts imports service.ts — two hops from the changed file, and it
      // never calls `helper` directly, so only the BFS can reach it.
      dependents: ['src/service.ts', 'src/routes.ts'],
      facts: [
        { filePath: 'src/service.ts', endpoints: [], crons: [] },
        {
          filePath: 'src/routes.ts',
          endpoints: ['GET /api/public/items'],
          crons: ['job:reset-rate-buckets'],
        },
      ],
    });
    const res = await svc.getBlastRadius('r1', ['src/lib/helper.ts']);

    expect(res.impactedEndpoints).toContain('GET /api/public/items');
    expect(res.impactedCrons).toContain('job:reset-rate-buckets');
    // Facts were fetched over caller files ∪ reverse dependents.
    expect(factsAskedFor[0]).toEqual(['src/routes.ts', 'src/service.ts']);
    expect(res.factsByFile?.['src/routes.ts']?.endpoints).toEqual(['GET /api/public/items']);
    expect(res.degraded).toBe(false);
  });

  it('carries the declaration line on every changed symbol', async () => {
    const { svc } = buildService({
      symbolsByPath: [sym('src/lib.ts', 'alpha', 12), sym('src/lib.ts', 'beta', 41)],
    });
    const res = await svc.getBlastRadius('r1', ['src/lib.ts']);
    expect(res.changedSymbols.map((s) => [s.name, s.line])).toEqual([
      ['alpha', 12],
      ['beta', 41],
    ]);
  });

  it('a zero-symbol changed file is a clean non-degraded empty, with crons present', async () => {
    const { svc } = buildService({ symbolsByPath: [] });
    const res = await svc.getBlastRadius('r1', ['README.md']);
    expect(res.degraded).toBe(false);
    expect(res.changedSymbols).toEqual([]);
    expect(res.impactedCrons).toEqual([]);
  });
});

describe('tryPersistentBlast — degraded path stays honest', () => {
  it('returns impactedCrons: [] rather than pretending it extracted none', async () => {
    // Flag off → the persistent path is skipped and there is no clone to grep.
    const { svc } = buildService({ flag: false });
    const res = await svc.getBlastRadius('r1', ['src/lib.ts']);
    expect(res.degraded).toBe(true);
    expect(res.impactedCrons).toEqual([]);
    expect(res.impactedEndpoints).toEqual([]);
  });

  it('an unusable index status falls through to degraded', async () => {
    const { svc } = buildService({
      indexStatus: 'failed',
      symbolsByPath: [sym('src/lib.ts', 'alpha', 12)],
    });
    const res = await svc.getBlastRadius('r1', ['src/lib.ts']);
    expect(res.degraded).toBe(true);
    expect(res.impactedCrons).toEqual([]);
  });
});
