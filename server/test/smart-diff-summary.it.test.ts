/**
 * POST /pulls/:id/smart-diff/summary — the on-demand per-file summary write
 * path: prompt assembly, the one structured model call, cache-on-head-sha,
 * the in-flight 409 guard, and failure propagation. This is deliberately the
 * opposite of the GET path's behaviour (`smart-diff-routes.it.test.ts`): the
 * user clicked a button, so a failed derivation must surface as an error, not
 * degrade to an empty summary.
 *
 * The LLM is a MockLLMProvider keyed by schema name ('FileSummary' — the
 * schemaName `FileSummaryModel.summarize` sends), wired into the
 * `openrouter` slot for the default-model cases: that's what the
 * `file_summary` registry default resolves to. Gated on Docker (needs
 * Postgres), matching the other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const PATCH = '@@ -1,2 +1,4 @@\n line one\n+line two\n+line three\n line four';

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `smart-diff-summary-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 1,
      title: 'Smart diff summary fixture',
      author: 'marisa.koch',
      branch: 'feat/smart-diff-summary-fixture',
      base: 'main',
      headSha: 'sha-1',
      additions: 2,
      deletions: 0,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/service.ts',
    additions: 2,
    deletions: 0,
    patch: PATCH,
  });
  return { repo: repo!, pr: pr! };
}

d('POST /pulls/:id/smart-diff/summary (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  describe('derive, cache, and re-derive on a new head', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;
    let llm: MockLLMProvider;
    let prId: string;

    beforeAll(async () => {
      llm = new MockLLMProvider('openai', {
        structuredBySchema: { FileSummary: { summary: 'Adds a token-bucket limiter.' } },
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
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      prId = pr.id;
    });
    afterAll(async () => {
      await app?.close();
    });

    function structuredCalls() {
      return llm.calls.filter((c) => c.method === 'completeStructured');
    }

    it('derives and persists a summary on first POST', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${prId}/smart-diff/summary`,
        payload: { path: 'src/service.ts' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.pr_id).toBe(prId);
      expect(body.path).toBe('src/service.ts');
      expect(body.head_sha).toBe('sha-1');
      expect(body.summary).toBe('Adds a token-bucket limiter.');
      expect(body.provider).toBe('openrouter');
      expect(body.model).toBe('google/gemini-2.5-flash-lite');

      const rows = await pg.handle.db
        .select()
        .from(t.prFileSummary)
        .where(eq(t.prFileSummary.prId, prId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.summary).toBe('Adds a token-bucket limiter.');

      expect(structuredCalls()).toHaveLength(1);
    });

    it('serves the cached row on a second POST for the same head, no second model call', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${prId}/smart-diff/summary`,
        payload: { path: 'src/service.ts' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().summary).toBe('Adds a token-bucket limiter.');
      expect(structuredCalls()).toHaveLength(1);
    });

    it('carries the summary on the GET smart-diff response for that file', async () => {
      const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const file = body.groups
        .flatMap((g: { files: { path: string }[] }) => g.files)
        .find((f: { path: string }) => f.path === 'src/service.ts');
      expect(file.pseudocode_summary).toBe('Adds a token-bucket limiter.');
    });

    it('re-derives and replaces the row once the head moves', async () => {
      await pg.handle.db
        .update(t.pullRequests)
        .set({ headSha: 'sha-2' })
        .where(eq(t.pullRequests.id, prId));

      const staleGet = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
      const staleFile = staleGet
        .json()
        .groups.flatMap((g: { files: { path: string }[] }) => g.files)
        .find((f: { path: string }) => f.path === 'src/service.ts');
      expect(staleFile.pseudocode_summary).toBeNull();

      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${prId}/smart-diff/summary`,
        payload: { path: 'src/service.ts' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().head_sha).toBe('sha-2');

      const rows = await pg.handle.db
        .select()
        .from(t.prFileSummary)
        .where(eq(t.prFileSummary.prId, prId));
      expect(rows).toHaveLength(1); // replaced in place, not duplicated
      expect(rows[0]!.headSha).toBe('sha-2');

      expect(structuredCalls()).toHaveLength(2);
    });

    it('404s a path not part of the PR, without calling the model', async () => {
      const before = structuredCalls().length;
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${prId}/smart-diff/summary`,
        payload: { path: 'not/in/pr.ts' },
      });
      expect(res.statusCode).toBe(404);
      expect(structuredCalls()).toHaveLength(before);
    });

    it('404s an unknown PR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${crypto.randomUUID()}/smart-diff/summary`,
        payload: { path: 'src/service.ts' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('provider failure propagates, nothing persisted', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;
    let prId: string;

    beforeAll(async () => {
      // MockLLMOptions has no dedicated "throw" switch; a fixture that fails
      // FileSummaryOutput's schema makes completeStructured throw, standing
      // in for a real provider failure (network error, bad JSON, etc).
      const failingLlm = new MockLLMProvider('openai', {
        structuredBySchema: { FileSummary: { not_a_summary_field: true } },
      });
      app = await buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: {
          llm: { openrouter: failingLlm },
          git: new MockGitClient(),
          github: new MockGitHubClient(),
        },
      });
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      prId = pr.id;
    });
    afterAll(async () => {
      await app?.close();
    });

    it('surfaces a 5xx and persists nothing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${prId}/smart-diff/summary`,
        payload: { path: 'src/service.ts' },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(500);

      const rows = await pg.handle.db
        .select()
        .from(t.prFileSummary)
        .where(eq(t.prFileSummary.prId, prId));
      expect(rows).toHaveLength(0);
    });

    it('releases the in-flight guard after the failure — a retry is not stuck at 409', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${prId}/smart-diff/summary`,
        payload: { path: 'src/service.ts' },
      });
      expect(res.statusCode).not.toBe(409);
    });
  });

  describe('a workspace model choice is honoured over the registry default', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;
    let prId: string;
    let choiceLlm: MockLLMProvider;

    beforeAll(async () => {
      choiceLlm = new MockLLMProvider('openai', {
        structuredBySchema: { FileSummary: { summary: 'Chosen-model summary.' } },
      });
      app = await buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: {
          llm: { openai: choiceLlm },
          git: new MockGitClient(),
          github: new MockGitHubClient(),
        },
      });
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      prId = pr.id;

      const put = await app.inject({
        method: 'PUT',
        url: '/settings',
        payload: { feature_models: { file_summary: { provider: 'openai', model: 'gpt-5-nano' } } },
      });
      expect(put.statusCode).toBe(200);
    });
    afterAll(async () => {
      await app?.close();
    });

    it('uses the workspace choice, not the registry default', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${prId}/smart-diff/summary`,
        payload: { path: 'src/service.ts' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().provider).toBe('openai');
      expect(res.json().model).toBe('gpt-5-nano');
      expect(choiceLlm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    });
  });
});
