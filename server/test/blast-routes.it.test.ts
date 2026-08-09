/**
 * GET /pulls/:id/blast and POST /pulls/:id/blast/summary, end to end over a
 * hand-seeded index slice — no clone on disk anywhere in this file, which is
 * the point: the map is read entirely from persisted tables (acceptance #3).
 *
 * The LLM is a MockLLMProvider in the `openrouter` slot (what the
 * `blast_summary` registry default resolves to), and the GET cases assert it
 * recorded ZERO calls — the read path must never spend a model call.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const HEAD = 'blastsha000001';
const DECL = 'src/middleware/ratelimit.ts';

let repoSeq = 0;

/**
 * A repo whose PR changes `ratelimit.ts`, with the six index tables populated:
 * two changed symbols, four cross-file callers of `rateLimit`, two of
 * `bucketKey`, import edges giving the BFS a depth-2 hop, and per-file facts.
 *
 * `src/api/public/health.ts` is deliberately NOT in `pr_files` — callers live
 * outside the diff, which is the entire point of a blast map.
 */
async function seedIndexedRepo(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `blast-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const repoId = repo!.id;

  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number: 1,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/ratelimit',
      base: 'main',
      headSha: HEAD,
      additions: 84,
      deletions: 2,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  await db
    .insert(t.prFiles)
    .values({ prId: pr!.id, path: DECL, additions: 84, deletions: 2, patch: null });

  await db.insert(t.repoIndexState).values({
    repoId,
    lastIndexedSha: HEAD,
    indexerVersion: INDEXER_VERSION,
    status: 'full',
    filesIndexed: 6,
    filesSkipped: 0,
  });

  await db.insert(t.symbols).values([
    { repoId, path: DECL, name: 'rateLimit', kind: 'function', line: 12, endLine: 38, exported: true },
    { repoId, path: DECL, name: 'bucketKey', kind: 'function', line: 41, endLine: 52, exported: true },
    // Caller-side symbols, so the map reports enclosing function names rather
    // than falling back to file basenames.
    { repoId, path: 'src/api/public/index.ts', name: 'publicRouter', kind: 'function', line: 10, endLine: 40, exported: true },
    { repoId, path: 'src/api/public/webhooks.ts', name: 'handleWebhook', kind: 'function', line: 30, endLine: 60, exported: true },
    { repoId, path: 'src/api/public/health.ts', name: 'healthRoute', kind: 'function', line: 5, endLine: 20, exported: true },
    { repoId, path: 'src/server.ts', name: 'boot', kind: 'function', line: 70, endLine: 120, exported: true },
  ]);

  await db.insert(t.references).values([
    { repoId, fromPath: 'src/api/public/index.ts', toSymbol: 'rateLimit', line: 23, declFile: DECL },
    { repoId, fromPath: 'src/api/public/webhooks.ts', toSymbol: 'rateLimit', line: 45, declFile: DECL },
    { repoId, fromPath: 'src/api/public/health.ts', toSymbol: 'rateLimit', line: 11, declFile: DECL },
    { repoId, fromPath: 'src/server.ts', toSymbol: 'rateLimit', line: 88, declFile: DECL },
    { repoId, fromPath: 'src/api/public/index.ts', toSymbol: 'bucketKey', line: 27, declFile: DECL },
    { repoId, fromPath: 'src/server.ts', toSymbol: 'bucketKey', line: 91, declFile: DECL },
    // A self-reference inside the declaration file — must NOT appear as a caller.
    { repoId, fromPath: DECL, toSymbol: 'bucketKey', line: 33, declFile: DECL },
  ]);

  await db.insert(t.fileRank).values(
    (
      [
        ['src/api/public/index.ts', 0.92, 92],
        ['src/api/public/webhooks.ts', 0.71, 71],
        ['src/server.ts', 0.55, 55],
        ['src/api/public/health.ts', 0.31, 31],
        [DECL, 0.5, 50],
      ] as const
    ).map(([filePath, rank, percentile]) => ({
      repoId,
      filePath,
      pagerank: rank,
      hotness: 0,
      rank,
      percentile,
    })),
  );

  await db.insert(t.fileEdges).values([
    { repoId, fromFile: 'src/api/public/index.ts', toFile: DECL },
    { repoId, fromFile: 'src/api/public/webhooks.ts', toFile: DECL },
    { repoId, fromFile: 'src/api/public/health.ts', toFile: DECL },
    // Depth-2 hop: server.ts reaches the middleware only through index.ts.
    { repoId, fromFile: 'src/server.ts', toFile: 'src/api/public/index.ts' },
  ]);

  await db.insert(t.fileFacts).values([
    { repoId, filePath: 'src/api/public/index.ts', endpoints: ['GET /api/public/items'], crons: [] },
    {
      repoId,
      filePath: 'src/api/public/webhooks.ts',
      endpoints: ['POST /api/public/webhooks'],
      crons: [],
    },
    {
      repoId,
      filePath: 'src/api/public/health.ts',
      endpoints: ['GET /api/public/health'],
      crons: [],
    },
    { repoId, filePath: 'src/server.ts', endpoints: [], crons: ['job:reset-rate-buckets'] },
  ]);

  return { repo: repo!, pr: pr! };
}

/** A repo with a PR but no index rows at all — the fresh-install shape. */
async function seedUnindexedRepo(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `blast-bare-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 2,
      title: 'Unindexed',
      author: 'marisa.koch',
      branch: 'feat/unindexed',
      base: 'main',
      headSha: HEAD,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  await db
    .insert(t.prFiles)
    .values({ prId: pr!.id, path: 'src/thing.ts', additions: 1, deletions: 0, patch: null });
  return { repo: repo!, pr: pr! };
}

d('blast routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let llm: MockLLMProvider;
  let indexedPrId: string;
  let barePrId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        BlastSummary: { summary: 'Changes the rate limiter every public route depends on.' },
      },
    });
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        llm: { openrouter: llm },
        git: new MockGitClient(),
        github: new MockGitHubClient(),
      },
    });

    indexedPrId = (await seedIndexedRepo(pg.handle.db, workspaceId)).pr.id;
    barePrId = (await seedUnindexedRepo(pg.handle.db, workspaceId)).pr.id;
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  function structuredCalls() {
    return llm.calls.filter((c) => c.method === 'completeStructured');
  }

  describe('GET /pulls/:id/blast', () => {
    it('serves an ok map from the index alone, with no model call', async () => {
      const before = structuredCalls().length;
      const res = await app.inject({ method: 'GET', url: `/pulls/${indexedPrId}/blast` });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.status).toBe('ok');
      expect(body.reason).toBeNull();
      expect(body.head_sha).toBe(HEAD);
      expect(body.summary).toBeNull();
      expect(structuredCalls()).toHaveLength(before);
    });

    it('reports both changed symbols with their declaration lines', async () => {
      const res = await app.inject({ method: 'GET', url: `/pulls/${indexedPrId}/blast` });
      const byName = Object.fromEntries(
        res.json().changed_symbols.map((s: { name: string }) => [s.name, s]),
      );
      expect(byName['rateLimit'].line).toBe(12);
      expect(byName['rateLimit'].file).toBe(DECL);
      expect(byName['bucketKey'].line).toBe(41);
    });

    it('resolves real callers, rank-ordered, naming the enclosing symbol', async () => {
      const res = await app.inject({ method: 'GET', url: `/pulls/${indexedPrId}/blast` });
      const rateLimit = res
        .json()
        .changed_symbols.find((s: { name: string }) => s.name === 'rateLimit');

      expect(rateLimit.callers.length).toBeGreaterThanOrEqual(2);
      expect(rateLimit.callers.map((c: { file: string }) => c.file)).toEqual([
        'src/api/public/index.ts',
        'src/api/public/webhooks.ts',
        'src/server.ts',
        'src/api/public/health.ts',
      ]);
      const first = rateLimit.callers[0];
      expect(first.symbol).toBe('publicRouter');
      expect(first.line).toBe(23);
      const ranks = rateLimit.callers.map((c: { rank: number }) => c.rank);
      expect(ranks).toEqual([...ranks].sort((a: number, b: number) => b - a));
    });

    it('never reports a reference from the declaration file itself as a caller', async () => {
      const res = await app.inject({ method: 'GET', url: `/pulls/${indexedPrId}/blast` });
      const bucketKey = res
        .json()
        .changed_symbols.find((s: { name: string }) => s.name === 'bucketKey');
      expect(bucketKey.callers.map((c: { file: string }) => c.file)).not.toContain(DECL);
      expect(bucketKey.callers).toHaveLength(2);
    });

    it('unions endpoints and crons over caller files and their reverse dependents', async () => {
      const res = await app.inject({ method: 'GET', url: `/pulls/${indexedPrId}/blast` });
      const body = res.json();
      expect(body.endpoints).toEqual(
        expect.arrayContaining([
          'GET /api/public/items',
          'POST /api/public/webhooks',
          'GET /api/public/health',
        ]),
      );
      expect(body.crons).toEqual(['job:reset-rate-buckets']);
    });

    it('degrades to no_data for a repo that was never indexed', async () => {
      const res = await app.inject({ method: 'GET', url: `/pulls/${barePrId}/blast` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        status: 'degraded',
        reason: 'no_data',
        changed_symbols: [],
      });
    });

    it('404s a PR belonging to another workspace', async () => {
      const [other] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: 'Other workspace', slug: `other-${repoSeq++}` })
        .returning();
      const { pr } = await seedUnindexedRepo(pg.handle.db, other!.id);
      const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
      expect(res.statusCode).toBe(404);
    });

    it('404s an unknown PR and 422s a non-uuid id', async () => {
      const unknown = await app.inject({
        method: 'GET',
        url: `/pulls/${crypto.randomUUID()}/blast`,
      });
      expect(unknown.statusCode).toBe(404);
      const bad = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' });
      expect(bad.statusCode).toBe(422);
    });
  });

  describe('POST /pulls/:id/blast/summary', () => {
    it('derives once, caches, and serves the cached value on the second call', async () => {
      const before = structuredCalls().length;

      const first = await app.inject({
        method: 'POST',
        url: `/pulls/${indexedPrId}/blast/summary`,
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({
        summary: 'Changes the rate limiter every public route depends on.',
        head_sha: HEAD,
      });
      expect(structuredCalls()).toHaveLength(before + 1);

      const second = await app.inject({
        method: 'POST',
        url: `/pulls/${indexedPrId}/blast/summary`,
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().summary).toBe(first.json().summary);
      // The whole point of the cache: no second call at the same head.
      expect(structuredCalls()).toHaveLength(before + 1);

      const rows = await pg.handle.db
        .select()
        .from(t.blastSummary)
        .where(eq(t.blastSummary.prId, indexedPrId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.provider).toBe('openrouter');
      expect(rows[0]!.model).toBe('google/gemini-2.5-flash-lite');
    });

    it('attaches the cached summary to the subsequent GET', async () => {
      const res = await app.inject({ method: 'GET', url: `/pulls/${indexedPrId}/blast` });
      expect(res.json().summary).toBe(
        'Changes the rate limiter every public route depends on.',
      );
    });

    it('refuses a degraded map with 422 and persists nothing', async () => {
      const before = structuredCalls().length;
      const res = await app.inject({ method: 'POST', url: `/pulls/${barePrId}/blast/summary` });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('blast_degraded');
      expect(structuredCalls()).toHaveLength(before);

      const rows = await pg.handle.db
        .select()
        .from(t.blastSummary)
        .where(eq(t.blastSummary.prId, barePrId));
      expect(rows).toHaveLength(0);
    });

    it('404s an unknown PR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${crypto.randomUUID()}/blast/summary`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  /**
   * Acceptance #1 over the SEEDED demo repo, not a hand-built fixture: a fresh
   * install with `clone_path: null` and no model key must still demonstrate the
   * feature. `seed()` already ran in `beforeAll`.
   */
  describe('the seeded demo PR #482', () => {
    let demoPrId: string;

    beforeAll(async () => {
      const [demoRepo] = await pg.handle.db
        .select()
        .from(t.repos)
        .where(eq(t.repos.fullName, 'acme/payments-api'));
      const [demoPr] = await pg.handle.db
        .select()
        .from(t.pullRequests)
        .where(eq(t.pullRequests.repoId, demoRepo!.id));
      demoPrId = demoPr!.id;
    });

    it('shows ≥2 real callers of the changed helper and ≥1 endpoint and cron', async () => {
      const before = structuredCalls().length;
      const res = await app.inject({ method: 'GET', url: `/pulls/${demoPrId}/blast` });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.status).toBe('ok');
      expect(body.reason).toBeNull();

      const rateLimit = body.changed_symbols.find((s: { name: string }) => s.name === 'rateLimit');
      expect(rateLimit).toBeDefined();
      expect(rateLimit.callers.length).toBeGreaterThanOrEqual(2);
      expect(body.endpoints.length).toBeGreaterThanOrEqual(1);
      expect(body.crons.length).toBeGreaterThanOrEqual(1);

      // No clone, no model key, no index job — the whole map came from rows.
      expect(structuredCalls()).toHaveLength(before);
    });

    it('attributes the cron through the depth-2 import hop', async () => {
      const res = await app.inject({ method: 'GET', url: `/pulls/${demoPrId}/blast` });
      // server.ts declares the cron and reaches ratelimit.ts only via
      // api/public/index.ts — only the reverse BFS can find it.
      expect(res.json().crons).toContain('job:reset-rate-buckets');
    });

    it('is idempotent — a second seed() does not duplicate the slice', async () => {
      const countSymbols = async () => {
        const [demoRepo] = await pg.handle.db
          .select()
          .from(t.repos)
          .where(eq(t.repos.fullName, 'acme/payments-api'));
        return pg.handle.db.select().from(t.symbols).where(eq(t.symbols.repoId, demoRepo!.id));
      };
      const before = await countSymbols();
      await seed(pg.handle.db);
      expect(await countSymbols()).toHaveLength(before.length);

      const res = await app.inject({ method: 'GET', url: `/pulls/${demoPrId}/blast` });
      expect(res.json().status).toBe('ok');
    });
  });
});
