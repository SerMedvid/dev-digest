/**
 * blast — status derivation and wire mapping, hermetic.
 *
 * Every port is stubbed, so what's under test is the one thing this module
 * decides: whether an empty map means "nothing there" or "we could not see",
 * and how the facade's flat caller list becomes a per-symbol tree.
 */
import { describe, it, expect } from 'vitest';
import { BlastService } from '../src/modules/blast/service.js';
import type {
  BlastIntelPort,
  BlastResultShape,
  BlastServiceDeps,
  BlastSummaryRow,
  IndexStateShape,
} from '../src/modules/blast/ports.js';
import { AppError } from '../src/platform/errors.js';

const HEAD = 'a1b2c3d4e5f6';

const FULL_MAP: BlastResultShape = {
  changedSymbols: [
    { file: 'src/middleware/ratelimit.ts', name: 'rateLimit', kind: 'function', line: 12 },
    { file: 'src/middleware/ratelimit.ts', name: 'bucketKey', kind: 'function', line: 41 },
  ],
  callers: [
    {
      file: 'src/api/public/index.ts',
      symbol: 'publicRouter',
      viaSymbol: 'rateLimit',
      line: 23,
      rank: 0.92,
    },
    {
      file: 'src/api/public/webhooks.ts',
      symbol: 'handleWebhook',
      viaSymbol: 'rateLimit',
      line: 45,
      rank: 0.71,
    },
    { file: 'src/server.ts', symbol: 'boot', viaSymbol: 'bucketKey', line: 88, rank: 0.4 },
  ],
  // BFS-widened: health.ts is a dependent, not a caller, so its endpoint shows
  // in the union but under no individual symbol.
  impactedEndpoints: [
    'GET /api/public/items',
    'POST /api/public/webhooks',
    'GET /api/public/health',
  ],
  impactedCrons: ['job:reset-rate-buckets'],
  factsByFile: {
    'src/api/public/index.ts': { endpoints: ['GET /api/public/items'], crons: [] },
    'src/api/public/webhooks.ts': { endpoints: ['POST /api/public/webhooks'], crons: [] },
    'src/server.ts': { endpoints: [], crons: ['job:reset-rate-buckets'] },
    'src/api/public/health.ts': { endpoints: ['GET /api/public/health'], crons: [] },
  },
  degraded: false,
};

interface Harness {
  svc: BlastService;
  intelCalls: string[];
}

function build(opts: {
  pull?: { id: string; repoId: string; headSha: string } | undefined;
  files?: string[];
  map?: BlastResultShape;
  state?: IndexStateShape;
  cached?: BlastSummaryRow;
}): Harness {
  const intelCalls: string[] = [];
  const intel: BlastIntelPort = {
    blastRadius: async () => {
      intelCalls.push('blastRadius');
      return opts.map ?? FULL_MAP;
    },
    indexState: async () => {
      intelCalls.push('indexState');
      return opts.state ?? { status: 'full', lastIndexedSha: HEAD };
    },
  };
  const deps: BlastServiceDeps = {
    store: {
      getPull: async () =>
        'pull' in opts ? opts.pull : { id: 'pr-1', repoId: 'repo-1', headSha: HEAD },
      getPrFilePaths: async () => opts.files ?? ['src/middleware/ratelimit.ts'],
    },
    intel,
    summaries: { get: async () => opts.cached, put: async () => {} },
    model: async () => {
      throw new Error('the read path must never resolve a model');
    },
  };
  return { svc: new BlastService(deps), intelCalls };
}

describe('BlastService.get — ok', () => {
  it('a full index at the PR head is ok with no reason', async () => {
    const { svc } = build({});
    const res = await svc.get('ws-1', 'pr-1');
    expect(res.status).toBe('ok');
    expect(res.reason).toBeNull();
    expect(res.head_sha).toBe(HEAD);
  });

  it('groups the flat caller list under the symbol each caller reaches', async () => {
    const { svc } = build({});
    const res = await svc.get('ws-1', 'pr-1');

    const [rateLimit, bucketKey] = res.changed_symbols;
    expect(rateLimit!.name).toBe('rateLimit');
    expect(rateLimit!.line).toBe(12);
    expect(rateLimit!.callers.map((c) => c.file)).toEqual([
      'src/api/public/index.ts',
      'src/api/public/webhooks.ts',
    ]);
    // The caller's `symbol` is the ENCLOSING function, not the one called.
    expect(rateLimit!.callers[0]!.symbol).toBe('publicRouter');
    expect(bucketKey!.callers.map((c) => c.file)).toEqual(['src/server.ts']);
  });

  it('keeps callers in rank-descending order within a group', async () => {
    const { svc } = build({});
    const res = await svc.get('ws-1', 'pr-1');
    const ranks = res.changed_symbols[0]!.callers.map((c) => c.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });

  it('per-symbol endpoints are a subset of the BFS-widened union', async () => {
    const { svc } = build({});
    const res = await svc.get('ws-1', 'pr-1');

    expect(res.changed_symbols[0]!.endpoints).toEqual([
      'GET /api/public/items',
      'POST /api/public/webhooks',
    ]);
    expect(res.changed_symbols[1]!.crons).toEqual(['job:reset-rate-buckets']);
    for (const s of res.changed_symbols) {
      for (const e of s.endpoints) expect(res.endpoints).toContain(e);
      for (const c of s.crons) expect(res.crons).toContain(c);
    }
    // The union is strictly wider: health.ts is a reverse dependent, not a caller.
    expect(res.endpoints).toContain('GET /api/public/health');
    expect(res.changed_symbols.flatMap((s) => s.endpoints)).not.toContain(
      'GET /api/public/health',
    );
  });

  it('attributes a declaring file’s own facts to its symbols even with zero callers', async () => {
    // The degenerate case the union alone cannot explain: no resolved callers
    // (stale index), yet the changed file itself declares an endpoint. The
    // symbol must carry its own file's facts or the header counter points at
    // chips that never render.
    const { svc } = build({
      map: {
        changedSymbols: [
          { file: 'src/api/public/items.ts', name: 'listItems', kind: 'function', line: 9 },
        ],
        callers: [],
        impactedEndpoints: ['GET /api/public/items'],
        impactedCrons: ['job:refresh-items'],
        factsByFile: {
          'src/api/public/items.ts': {
            endpoints: ['GET /api/public/items'],
            crons: ['job:refresh-items'],
          },
        },
        degraded: false,
      },
    });
    const res = await svc.get('ws-1', 'pr-1');

    const [listItems] = res.changed_symbols;
    expect(listItems!.callers).toEqual([]);
    expect(listItems!.endpoints).toEqual(['GET /api/public/items']);
    expect(listItems!.crons).toEqual(['job:refresh-items']);
  });

  it('zero symbols over a full index is ok-and-empty, not degraded', async () => {
    const { svc } = build({
      map: {
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        impactedCrons: [],
        degraded: false,
      },
    });
    const res = await svc.get('ws-1', 'pr-1');
    expect(res.status).toBe('ok');
    expect(res.reason).toBeNull();
    expect(res.changed_symbols).toEqual([]);
    expect(res.endpoints).toEqual([]);
  });
});

describe('BlastService.get — partial and degraded', () => {
  it('a partial index serves the map with reason index_partial', async () => {
    const { svc } = build({ state: { status: 'partial', lastIndexedSha: HEAD } });
    const res = await svc.get('ws-1', 'pr-1');
    expect(res.status).toBe('partial');
    expect(res.reason).toBe('index_partial');
    // Still a real map — `partial` warns, it does not blank the card.
    expect(res.changed_symbols).toHaveLength(2);
  });

  it('an index built at another commit is STILL ok — that is not staleness', async () => {
    // Regression guard. This case used to be `partial`/`index_stale`, which
    // meant every pull request was warned about: the index is built from the
    // clone's default-branch HEAD and `headSha` is the PR branch's tip, so the
    // two differ by construction and re-indexing could never make them agree.
    const { svc } = build({ state: { status: 'full', lastIndexedSha: 'older-sha' } });
    const res = await svc.get('ws-1', 'pr-1');
    expect(res.status).toBe('ok');
    expect(res.reason).toBeNull();
    expect(res.changed_symbols).toHaveLength(2);
  });

  it('a degraded facade passes its own reason through and wins over index state', async () => {
    const { svc } = build({
      map: {
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        impactedCrons: [],
        degraded: true,
        reason: 'no_data',
      },
      state: { status: 'partial', lastIndexedSha: 'older-sha' },
    });
    const res = await svc.get('ws-1', 'pr-1');
    expect(res.status).toBe('degraded');
    expect(res.reason).toBe('no_data');
  });

  it('an unimported PR is degraded/no_files and repo-intel is never asked', async () => {
    const { svc, intelCalls } = build({ files: [] });
    const res = await svc.get('ws-1', 'pr-1');
    expect(res.status).toBe('degraded');
    expect(res.reason).toBe('no_files');
    expect(intelCalls).toEqual([]);
  });

  it('an unknown or foreign PR is a 404, never a 403', async () => {
    const { svc } = build({ pull: undefined });
    await expect(svc.get('ws-1', 'pr-1')).rejects.toMatchObject({
      statusCode: 404,
      code: 'not_found',
    });
    await expect(svc.get('ws-1', 'pr-1')).rejects.toBeInstanceOf(AppError);
  });
});

describe('BlastService.get — cached summary', () => {
  it('attaches a summary stored at the current head', async () => {
    const { svc } = build({ cached: { headSha: HEAD, summary: 'Touches the public API.' } });
    const res = await svc.get('ws-1', 'pr-1');
    expect(res.summary).toBe('Touches the public API.');
  });

  it('withholds a summary written against an older head', async () => {
    const { svc } = build({ cached: { headSha: 'older-sha', summary: 'stale prose' } });
    const res = await svc.get('ws-1', 'pr-1');
    expect(res.summary).toBeNull();
  });

  it('never calls a model on the read path', async () => {
    // `model` throws if resolved; reaching a result at all proves it wasn't.
    const { svc } = build({});
    await expect(svc.get('ws-1', 'pr-1')).resolves.toBeDefined();
  });
});
