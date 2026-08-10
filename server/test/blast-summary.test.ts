/**
 * blast — the on-demand summary: one call, cached at the head, never called
 * for a map that has nothing in it. Hermetic; the model is a counting fake, so
 * "zero model calls" is asserted rather than assumed.
 */
import { describe, it, expect } from 'vitest';
import { BlastService } from '../src/modules/blast/service.js';
import { MAX_SUMMARY_CHARS, MAX_SUMMARY_INPUT_CHARS } from '../src/modules/blast/constants.js';
import { buildBlastSummaryPrompt } from '../src/modules/blast/prompt.js';
import type {
  BlastResultShape,
  BlastServiceDeps,
  BlastSummaryModelPort,
  BlastSummaryRow,
  IndexStateShape,
} from '../src/modules/blast/ports.js';

const HEAD = 'a1b2c3d4e5f6';

const MAP: BlastResultShape = {
  changedSymbols: [
    { file: 'src/middleware/ratelimit.ts', name: 'rateLimit', kind: 'function', line: 12 },
  ],
  callers: [
    {
      file: 'src/api/public/index.ts',
      symbol: 'publicRouter',
      viaSymbol: 'rateLimit',
      line: 23,
      rank: 0.92,
    },
  ],
  impactedEndpoints: ['GET /api/public/items'],
  impactedCrons: [],
  factsByFile: { 'src/api/public/index.ts': { endpoints: ['GET /api/public/items'], crons: [] } },
  degraded: false,
};

class CountingModel implements BlastSummaryModelPort {
  readonly provider = 'openrouter';
  readonly model = 'google/gemini-2.5-flash-lite';
  calls: string[] = [];
  constructor(private reply: string) {}
  async explain(mapJson: string): Promise<{ summary: string }> {
    this.calls.push(mapJson);
    return { summary: this.reply };
  }
}

interface Harness {
  svc: BlastService;
  model: CountingModel;
  puts: Array<{ prId: string; headSha: string; summary: string; provider: string; model: string }>;
  modelResolutions: number;
}

function build(opts: {
  map?: BlastResultShape;
  state?: IndexStateShape;
  files?: string[];
  cached?: BlastSummaryRow;
  reply?: string;
  headSha?: string;
}): Harness {
  const model = new CountingModel(opts.reply ?? 'It reaches the public API router.');
  const puts: Harness['puts'] = [];
  let stored: BlastSummaryRow | undefined = opts.cached;
  const harness = { model, puts, modelResolutions: 0 } as Harness;

  const deps: BlastServiceDeps = {
    store: {
      getPull: async () => ({ id: 'pr-1', repoId: 'repo-1', headSha: opts.headSha ?? HEAD }),
      getPrFilePaths: async () => opts.files ?? ['src/middleware/ratelimit.ts'],
    },
    intel: {
      blastRadius: async () => opts.map ?? MAP,
      indexState: async () => opts.state ?? { status: 'full', lastIndexedSha: opts.headSha ?? HEAD },
    },
    summaries: {
      get: async () => stored,
      put: async (row) => {
        puts.push(row);
        stored = { headSha: row.headSha, summary: row.summary };
      },
    },
    model: async () => {
      harness.modelResolutions++;
      return model;
    },
  };
  harness.svc = new BlastService(deps);
  return harness;
}

describe('BlastService.summarize — deriving', () => {
  it('makes exactly one call and persists the row with its provider and model', async () => {
    const h = build({});
    const res = await h.svc.summarize('ws-1', 'pr-1');

    expect(h.model.calls).toHaveLength(1);
    expect(res).toEqual({ summary: 'It reaches the public API router.', head_sha: HEAD });
    expect(h.puts).toEqual([
      {
        prId: 'pr-1',
        headSha: HEAD,
        summary: 'It reaches the public API router.',
        provider: 'openrouter',
        model: 'google/gemini-2.5-flash-lite',
      },
    ]);
  });

  it('feeds the model the computed map without its own summary slot', async () => {
    const h = build({});
    await h.svc.summarize('ws-1', 'pr-1');
    const sent = JSON.parse(h.model.calls[0]!) as Record<string, unknown>;
    expect(sent).not.toHaveProperty('summary');
    expect(sent['status']).toBe('ok');
    expect(sent['changed_symbols']).toHaveLength(1);
  });

  it('truncates an over-long summary BEFORE storing it', async () => {
    const h = build({ reply: 'x'.repeat(MAX_SUMMARY_CHARS + 250) });
    const res = await h.svc.summarize('ws-1', 'pr-1');
    expect(res.summary).toHaveLength(MAX_SUMMARY_CHARS);
    expect(h.puts[0]!.summary).toHaveLength(MAX_SUMMARY_CHARS);
  });
});

describe('BlastService.summarize — caching', () => {
  it('serves a row at the same head with zero model calls', async () => {
    const h = build({ cached: { headSha: HEAD, summary: 'cached prose' } });
    const res = await h.svc.summarize('ws-1', 'pr-1');
    expect(res).toEqual({ summary: 'cached prose', head_sha: HEAD });
    expect(h.model.calls).toHaveLength(0);
    expect(h.modelResolutions).toBe(0);
    expect(h.puts).toEqual([]);
  });

  it('a second call after deriving is free', async () => {
    const h = build({});
    await h.svc.summarize('ws-1', 'pr-1');
    await h.svc.summarize('ws-1', 'pr-1');
    expect(h.model.calls).toHaveLength(1);
    expect(h.puts).toHaveLength(1);
  });

  it('re-derives and replaces when the head has moved', async () => {
    const h = build({
      cached: { headSha: 'older-sha', summary: 'describes code that is gone' },
      reply: 'fresh prose',
    });
    const res = await h.svc.summarize('ws-1', 'pr-1');
    expect(h.model.calls).toHaveLength(1);
    expect(res.summary).toBe('fresh prose');
    expect(h.puts[0]!.headSha).toBe(HEAD);
  });
});

describe('BlastService.summarize — refusals', () => {
  it('refuses a degraded map with 422 blast_degraded, before any model call', async () => {
    const h = build({
      map: {
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        impactedCrons: [],
        degraded: true,
        reason: 'no_data',
      },
    });
    await expect(h.svc.summarize('ws-1', 'pr-1')).rejects.toMatchObject({
      statusCode: 422,
      code: 'blast_degraded',
    });
    expect(h.model.calls).toHaveLength(0);
    expect(h.modelResolutions).toBe(0);
    expect(h.puts).toEqual([]);
  });

  it('refuses an unimported PR (no_files is degraded too)', async () => {
    const h = build({ files: [] });
    await expect(h.svc.summarize('ws-1', 'pr-1')).rejects.toMatchObject({
      statusCode: 422,
      code: 'blast_degraded',
    });
    expect(h.model.calls).toHaveLength(0);
  });

  it('explains a partial map — served with a warning is still a real map', async () => {
    const h = build({ state: { status: 'partial', lastIndexedSha: HEAD } });
    await expect(h.svc.summarize('ws-1', 'pr-1')).resolves.toBeDefined();
    expect(h.model.calls).toHaveLength(1);
  });

  it('rejects a concurrent derivation for the same PR with 409', async () => {
    const h = build({});
    const [first, second] = await Promise.allSettled([
      h.svc.summarize('ws-1', 'pr-1'),
      h.svc.summarize('ws-1', 'pr-1'),
    ]);
    // One wins; the other is refused rather than paying for a duplicate call.
    const outcomes = [first!.status, second!.status].sort();
    expect(outcomes).toEqual(['fulfilled', 'rejected']);
    const rejected = [first, second].find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ statusCode: 409, code: 'conflict' });
    expect(h.model.calls).toHaveLength(1);
  });

  it('releases the in-flight guard after a failure', async () => {
    const h = build({});
    // Fail the first derivation, then prove a retry is not stuck at 409.
    h.model.explain = async () => {
      throw new Error('provider exploded');
    };
    await expect(h.svc.summarize('ws-1', 'pr-1')).rejects.toThrow('provider exploded');
    h.model.explain = async () => ({ summary: 'recovered' });
    await expect(h.svc.summarize('ws-1', 'pr-1')).resolves.toMatchObject({
      summary: 'recovered',
    });
  });
});

describe('blast summary prompt', () => {
  it('marks a truncated map so it cannot read as a complete one', () => {
    const huge = JSON.stringify({ pad: 'x'.repeat(MAX_SUMMARY_INPUT_CHARS + 500) });
    const [, user] = buildBlastSummaryPrompt(huge);
    expect(user!.content).toContain('…[truncated');
    expect(user!.content.length).toBeLessThan(huge.length);
  });

  it('wraps the map as untrusted and keeps the instruction outside the wrap', () => {
    const [system, user] = buildBlastSummaryPrompt('{"status":"ok"}');
    expect(user!.content).toContain('blast-map');
    expect(system!.content).toContain('Do not name a file, symbol, endpoint or job');
    expect(system!.content).not.toContain('{"status":"ok"}');
  });
});
