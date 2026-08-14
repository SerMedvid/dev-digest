/**
 * brief — the service, hermetic. Every port is hand-built; no container, no DB.
 *
 * What is under test is what this layer alone decides: when a cached row may be
 * served, when a model call is worth making, and what a missing input costs.
 * The last of those is the one that gets shipped broken — five of the seven
 * sources are optional, and every one of them has to degrade to an omitted
 * section rather than a failed call.
 */
import { describe, it, expect, vi } from 'vitest';
import { BriefService } from '../src/modules/brief/service.js';
import { AppError, ConflictError, NotFoundError } from '../src/platform/errors.js';
import type {
  BriefBlastMap,
  BriefOutputShape,
  BriefRow,
  BriefServiceDeps,
} from '../src/modules/brief/ports.js';

const HEAD = 'a1b2c3d4e5f6';

const PULL = {
  id: 'pr1',
  number: 482,
  title: 'Add rate limiting',
  body: 'Prevent abuse. See docs/rate-limits.md',
  headSha: HEAD,
  repoId: 'repo1',
  author: 'marisa.koch',
  headRef: 'feat/rate-limit',
  baseRef: 'main',
};

const BLAST: BriefBlastMap = {
  status: 'ok',
  reason: null,
  head_sha: HEAD,
  changed_symbols: [
    {
      name: 'rateLimit',
      kind: 'function',
      file: 'src/middleware/ratelimit.ts',
      line: 12,
      callers: [{ file: 'src/api/public/index.ts', line: 23, symbol: 'publicRouter', rank: 0.9 }],
      endpoints: ['GET /api/public/items'],
      crons: [],
    },
  ],
  endpoints: ['GET /api/public/items'],
  crons: [],
  summary: null,
};

const MODEL_OUTPUT: BriefOutputShape = {
  what: 'Adds rate limiting.',
  why: 'Unauthenticated clients can hammer the public endpoints.',
  risk_level: 'high',
  risks: [
    {
      title: 'Committed secret',
      explanation: 'A live key is in the diff.',
      severity: 'high',
      refs: ['src/config.ts'],
    },
    // Every ref invented: rule 2 drops this one whole, and the persisted brief
    // must be the grounded one.
    {
      title: 'Invented',
      explanation: 'About a file that is not here.',
      severity: 'low',
      refs: ['src/imaginary.ts'],
    },
  ],
  review_focus: [{ file: 'src/config.ts', line: 12, reason: 'The secret.' }],
};

interface Harness {
  deps: BriefServiceDeps;
  put: ReturnType<typeof vi.fn>;
  generate: ReturnType<typeof vi.fn>;
  resolveModel: ReturnType<typeof vi.fn>;
  row: { current: BriefRow | undefined };
}

function harness(over: Partial<BriefServiceDeps> = {}): Harness {
  const row: { current: BriefRow | undefined } = { current: undefined };
  // Stores, like the real repository: `generate` reads the row back rather than
  // reconstructing it, so a `put` that swallowed its argument would make every
  // generation look like a failed write.
  const put = vi.fn(async (r: Parameters<BriefServiceDeps['briefs']['put']>[0]) => {
    row.current = {
      headSha: r.headSha,
      brief: r.brief,
      reviewId: r.reviewId,
      sources: r.sources,
      estTokensIn: r.estTokensIn,
      provider: r.provider,
      model: r.model,
      createdAt: new Date('2026-08-14T12:00:00Z'),
    };
  });
  const generate = vi.fn(async () => MODEL_OUTPUT);
  const resolveModel = vi.fn(async () => ({
    provider: 'openai',
    model: 'gpt-4.1',
    generate,
  }));

  const deps: BriefServiceDeps = {
    store: {
      getPull: async () => PULL,
      getRepo: async () => ({ owner: 'acme', name: 'payments-api', clonePath: '/clone' }),
      getPrFiles: async () => [
        { path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
        { path: 'src/config.ts', additions: 4, deletions: 0 },
      ],
      getIntent: async () => ({
        intent: 'Add rate limiting',
        in_scope: ['middleware'],
        out_of_scope: ['auth'],
        confidence: 'medium',
        linkedIssue: { number: 471, title: 'Rate limit us', body: 'Please.' },
      }),
      latestReview: async () => ({
        reviewId: 'review-2',
        findings: [
          {
            file: 'src/config.ts',
            startLine: 10,
            endLine: 14,
            severity: 'CRITICAL',
            category: 'security',
            kind: 'finding',
            title: 'Hardcoded key',
          },
        ],
      }),
    },
    briefs: { get: async () => row.current, put },
    blast: { map: async () => BLAST },
    docs: { read: async () => ({ found: [], missing: [] }) },
    model: resolveModel,
    ...over,
  };
  return { deps, put, generate, resolveModel, row };
}

function storedRow(over: Partial<BriefRow> = {}): BriefRow {
  return {
    headSha: HEAD,
    brief: {
      what: 'Adds rate limiting.',
      why: 'Because abuse.',
      risk_level: 'high',
      risks: [],
      review_focus: [],
    },
    reviewId: 'review-2',
    sources: ['pr', 'files'],
    estTokensIn: 1200,
    provider: 'seed',
    model: 'seed',
    createdAt: new Date('2026-08-14T00:00:00Z'),
    ...over,
  };
}

describe('read', () => {
  it('404s for an unknown or foreign PR', async () => {
    const h = harness({ store: { ...harness().deps.store, getPull: async () => undefined } });
    await expect(new BriefService(h.deps).read('w1', 'pr1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns undefined when nothing has been generated', async () => {
    const h = harness();
    await expect(new BriefService(h.deps).read('w1', 'pr1')).resolves.toBeUndefined();
  });

  it('never serves a row written at an older head, and never calls a model', async () => {
    const h = harness();
    h.row.current = storedRow({ headSha: 'older-sha' });
    // The file list, the blast map and the findings that row described belong
    // to code that no longer exists.
    await expect(new BriefService(h.deps).read('w1', 'pr1')).resolves.toBeUndefined();
    expect(h.resolveModel).not.toHaveBeenCalled();
  });

  it('serves a row at the current head with stale false when the review still matches', async () => {
    const h = harness();
    h.row.current = storedRow();
    const rec = await new BriefService(h.deps).read('w1', 'pr1');
    expect(rec?.stale).toBe(false);
    expect(rec?.head_sha).toBe(HEAD);
    expect(rec?.review_id).toBe('review-2');
    expect(h.resolveModel).not.toHaveBeenCalled();
  });

  it('serves the row with stale true when a newer review has run (AC-8)', async () => {
    const h = harness();
    h.row.current = storedRow({ reviewId: 'review-1' });
    const rec = await new BriefService(h.deps).read('w1', 'pr1');
    // Still served: a brief one review out of date is more useful than an
    // empty card, and regenerating on the user's behalf would spend a call
    // nobody asked for.
    expect(rec).toBeDefined();
    expect(rec?.stale).toBe(true);
  });

  it('is stale when the row predates any review and one now exists', async () => {
    const h = harness();
    h.row.current = storedRow({ reviewId: null });
    await expect(new BriefService(h.deps).read('w1', 'pr1')).resolves.toMatchObject({ stale: true });
  });

  it('reports the empty state, not a 500, when the stored row no longer parses', async () => {
    const warn = vi.fn();
    const h = harness({ log: { warn } });
    h.row.current = storedRow({ brief: { what: 'only this' } });
    await expect(new BriefService(h.deps).read('w1', 'pr1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe('generate — refusals before any spend', () => {
  it('422s brief_no_inputs on a PR with no changed files, with no model resolved (AC-10)', async () => {
    const base = harness().deps;
    const h = harness({ store: { ...base.store, getPrFiles: async () => [] } });
    const err = await new BriefService(h.deps).generate('w1', 'pr1').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('brief_no_inputs');
    expect(err.statusCode).toBe(422);
    // The refusal precedes the model resolution, so no key is even looked up.
    expect(h.resolveModel).not.toHaveBeenCalled();
  });

  it('409s a second generation while the first is in flight (AC-11)', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const h = harness();
    h.generate.mockImplementation(async () => {
      await gate;
      return MODEL_OUTPUT;
    });

    const svc = new BriefService(h.deps);
    const first = svc.generate('w1', 'pr1');
    // Asserted on the guard, not on timing: the first call is parked inside the
    // model port, so the second arrives while the set holds the id.
    const second = await svc.generate('w1', 'pr1').catch((e) => e);
    expect(second).toBeInstanceOf(ConflictError);
    release();
    await expect(first).resolves.toBeDefined();

    // Released in `finally`, so a third call after it settles succeeds.
    await expect(svc.generate('w1', 'pr1')).resolves.toBeDefined();
  });

  it('404s when the PR row exists but its repo is gone', async () => {
    const base = harness().deps;
    const h = harness({ store: { ...base.store, getRepo: async () => undefined } });
    await expect(new BriefService(h.deps).generate('w1', 'pr1')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('generate — composition and degradation (AC-9)', () => {
  it('persists the GROUNDED brief, not the model output', async () => {
    const h = harness();
    const rec = await new BriefService(h.deps).generate('w1', 'pr1');

    // The "Invented" risk named nothing in the PR, so it never reaches storage
    // and never reaches the user.
    expect(rec.risks.map((r) => r.title)).toEqual(['Committed secret']);
    expect(h.put).toHaveBeenCalledOnce();
    const persisted = h.put.mock.calls[0]![0] as { brief: { risks: { title: string }[] } };
    expect(persisted.brief.risks.map((r) => r.title)).toEqual(['Committed secret']);
  });

  it('records the review whose findings fed it', async () => {
    const h = harness();
    const rec = await new BriefService(h.deps).generate('w1', 'pr1');
    expect(rec.review_id).toBe('review-2');
    expect(rec.stale).toBe(false);
  });

  it('records null when the PR has no review at all', async () => {
    const base = harness().deps;
    const h = harness({ store: { ...base.store, latestReview: async () => undefined } });
    const rec = await new BriefService(h.deps).generate('w1', 'pr1');
    expect(rec.review_id).toBeNull();
    expect(rec.sources).toContain('findings (no review yet)');
    // Nothing else carries a line number, so with no findings every focus line
    // is null — the honest result, not a degradation to apologise for.
    expect(rec.review_focus.every((f) => f.line === null)).toBe(true);
  });

  it('omits a degraded blast map and says so, rather than refusing', async () => {
    const base = harness().deps;
    const h = harness({
      blast: { map: async () => ({ ...BLAST, status: 'degraded', reason: 'no_index' }) },
    });
    void base;
    const rec = await new BriefService(h.deps).generate('w1', 'pr1');
    // Unlike the blast summary — where the map is the only input — the map is
    // one of seven here, so this is not a 422.
    expect(rec.sources).toContain('blast (degraded: no_index)');
    expect(rec.what).toBe('Adds rate limiting.');
  });

  it('omits a blast map whose port threw', async () => {
    const h = harness({
      blast: {
        map: async () => {
          throw new Error('repo-intel exploded');
        },
      },
    });
    const rec = await new BriefService(h.deps).generate('w1', 'pr1');
    expect(rec.sources).toContain('blast (unavailable)');
  });

  it('omits an absent intent and says so', async () => {
    const base = harness().deps;
    const h = harness({ store: { ...base.store, getIntent: async () => undefined } });
    const rec = await new BriefService(h.deps).generate('w1', 'pr1');
    expect(rec.sources).toContain('intent (none derived)');
  });

  it('carries the document reader refusals through to sources', async () => {
    const h = harness({
      docs: {
        read: async () => ({
          found: [],
          missing: ['docs/rate-limits.md was not read: this repository has no clone on disk'],
        }),
      },
    });
    const rec = await new BriefService(h.deps).generate('w1', 'pr1');
    expect(rec.sources).toContain(
      'docs/rate-limits.md was not read: this repository has no clone on disk',
    );
  });

  it('degrades a throwing document reader rather than failing the call', async () => {
    const h = harness({
      docs: {
        read: async () => {
          throw new Error('clone vanished');
        },
      },
    });
    await expect(new BriefService(h.deps).generate('w1', 'pr1')).resolves.toBeDefined();
  });
});

describe('generate — the model call is the one failure that propagates', () => {
  it('persists nothing and rethrows when the model fails', async () => {
    const h = harness();
    h.generate.mockRejectedValue(new Error('provider 503'));
    // A user action: a silent success would tell the user the button worked
    // when it didn't.
    await expect(new BriefService(h.deps).generate('w1', 'pr1')).rejects.toThrow('provider 503');
    expect(h.put).not.toHaveBeenCalled();
  });

  it('reports the composition facts and every grounding drop on one log line', async () => {
    const info = vi.fn();
    const warn = vi.fn();
    const h = harness({ log: { info, warn }, tokenCount: (t) => t.length });
    await new BriefService(h.deps).generate('w1', 'pr1');

    const [payload] = info.mock.calls[0] as [Record<string, unknown>];
    expect(payload.provider).toBe('openai');
    expect(payload.model).toBe('gpt-4.1');
    expect(payload.est_tokens_in).toBeGreaterThan(0);
    expect(payload.dropped).toMatchObject({ risk: 1 });
    // Nothing goes silent: each drop also gets its own line with its reason.
    expect(warn).toHaveBeenCalled();
  });
});
