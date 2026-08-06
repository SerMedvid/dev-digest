/**
 * GET /pulls/:id/smart-diff — the whole composition, end to end: the
 * container wires the store over `reviewRepo` + `smartDiffRepo`, grouping is
 * Task 3's pure `classifyPath`/`groupFiles`/`splitSuggestion`, marks are
 * derived from live findings, and no LLM is ever called on this path.
 *
 * Gated on Docker (needs Postgres), matching the other integration tests.
 * The hermetic degradation case at the bottom needs no DB and runs even
 * without Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { SmartDiffService } from '../src/modules/smart-diff/service.js';
import type { SmartDiffStorePort } from '../src/modules/smart-diff/domain.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  opts: { headSha?: string } = {},
) {
  const name = `smart-diff-routes-${repoSeq++}`;
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
      title: 'Smart diff fixture',
      author: 'marisa.koch',
      branch: 'feat/smart-diff-fixture',
      base: 'main',
      headSha: opts.headSha ?? 'sha-1',
      additions: 0,
      deletions: 0,
      filesCount: 0,
      status: 'open',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

d('smart-diff endpoints (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let llm: MockLLMProvider;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    llm = new MockLLMProvider('openai');
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: llm }, git: new MockGitClient(), github: new MockGitHubClient() },
    });
  });

  afterAll(async () => {
    // Smart Diff is pure classification + persisted data — it never calls a model.
    expect(llm.calls.length).toBe(0);
    await app?.close();
    await pg?.stop();
  });

  it('groups files core -> wiring -> boilerplate, present-only, fixed order', async () => {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await pg.handle.db.insert(t.prFiles).values([
      { prId: pr.id, path: 'src/service.ts', additions: 10, deletions: 2 },
      { prId: pr.id, path: 'src/index.ts', additions: 3, deletions: 0 },
      { prId: pr.id, path: 'README.md', additions: 1, deletions: 0 },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.groups.map((g: { role: string }) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(body.groups[0].files.map((f: { path: string }) => f.path)).toEqual(['src/service.ts']);
    expect(body.groups[1].files.map((f: { path: string }) => f.path)).toEqual(['src/index.ts']);
    expect(body.groups[2].files.map((f: { path: string }) => f.path)).toEqual(['README.md']);
  });

  it('marks only non-dismissed findings, and drops marks for files not in pr_files', async () => {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await pg.handle.db.insert(t.prFiles).values([{ prId: pr.id, path: 'src/service.ts', additions: 10, deletions: 2 }]);
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        agentId: null,
        runId: null,
        kind: 'review',
        verdict: null,
        summary: null,
        score: null,
        model: null,
      })
      .returning();
    await pg.handle.db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/service.ts',
        startLine: 12,
        endLine: 12,
        severity: 'WARNING',
        category: 'style',
        title: 'dismissed one',
        rationale: 'r',
        confidence: 0.9,
        dismissedAt: new Date(),
      },
      {
        reviewId: review!.id,
        file: 'src/service.ts',
        startLine: 20,
        endLine: 20,
        severity: 'CRITICAL',
        category: 'bug',
        title: 'live one',
        rationale: 'r',
        confidence: 0.9,
      },
      {
        reviewId: review!.id,
        file: 'not/in/pr-files.ts',
        startLine: 5,
        endLine: 5,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'orphan finding, file absent from the diff',
        rationale: 'r',
        confidence: 0.9,
      },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const file = body.groups[0].files[0];
    expect(file.finding_marks).toHaveLength(1);
    expect(file.finding_marks[0]).toMatchObject({ line: 20, severity: 'CRITICAL' });
    expect(file.finding_lines).toEqual([20]);
  });

  it('a PR with zero reviews serves grouping intact with empty marks (pre-review)', async () => {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await pg.handle.db.insert(t.prFiles).values([{ prId: pr.id, path: 'src/service.ts', additions: 4, deletions: 1 }]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].files[0].finding_marks).toEqual([]);
  });

  it('split_suggestion numbers match the fixture arithmetic', async () => {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    // total_lines (450) exceeds SPLIT_LINES_MAX (400); 3 distinct directory
    // prefixes, so proposed_splits is a straight lines-desc ordering.
    await pg.handle.db.insert(t.prFiles).values([
      { prId: pr.id, path: 'alpha/a.ts', additions: 150, deletions: 0 },
      { prId: pr.id, path: 'beta/b.ts', additions: 100, deletions: 0 },
      { prId: pr.id, path: 'gamma/c.ts', additions: 200, deletions: 0 },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.split_suggestion).toEqual({
      too_big: true,
      total_lines: 450,
      proposed_splits: [
        { name: 'gamma', files: ['gamma/c.ts'] },
        { name: 'alpha', files: ['alpha/a.ts'] },
        { name: 'beta', files: ['beta/b.ts'] },
      ],
    });
  });

  it('404s a foreign-workspace PR', async () => {
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${Date.now()}` })
      .returning();
    const { pr } = await setupRepoAndPr(pg.handle.db, otherWs!.id);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(404);
  });

  it('422s a non-uuid id', async () => {
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/smart-diff' });
    expect(res.statusCode).toBe(422);
  });

  /**
   * The seeded demo PR (design §8, acceptance #1/#13): a fresh `pnpm db:seed`
   * must yield the full nine-file diff across all three groups, including a
   * lock file to demonstrate criterion 1 and patch text so a finding badge
   * has a line to scroll to.
   */
  describe('seeded PR #482 (acme/payments-api, the design §8 demo diff)', () => {
    async function getSeededPrId(): Promise<string> {
      const [repo] = await pg.handle.db
        .select()
        .from(t.repos)
        .where(
          and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')),
        );
      const [pr] = await pg.handle.db
        .select()
        .from(t.pullRequests)
        .where(and(eq(t.pullRequests.repoId, repo!.id), eq(t.pullRequests.number, 482)));
      return pr!.id;
    }

    it('groups the nine seeded files 3 core / 4 wiring / 2 boilerplate, lock file boilerplate', async () => {
      const prId = await getSeededPrId();

      const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.groups.map((g: { role: string }) => g.role)).toEqual([
        'core',
        'wiring',
        'boilerplate',
      ]);
      const core = body.groups.find((g: { role: string }) => g.role === 'core');
      const wiring = body.groups.find((g: { role: string }) => g.role === 'wiring');
      const boilerplate = body.groups.find((g: { role: string }) => g.role === 'boilerplate');
      expect(core.files).toHaveLength(3);
      expect(wiring.files).toHaveLength(4);
      expect(boilerplate.files).toHaveLength(2);
      expect(boilerplate.files.map((f: { path: string }) => f.path)).toContain(
        'package-lock.json',
      );

      expect(body.split_suggestion).toMatchObject({ too_big: false, total_lines: 285 });

      // src/config.ts is `wiring` (matches the WIRING_CONFIG_PATTERNS `config.*`
      // rule) and carries the seeded CRITICAL — its mark must cite the finding's
      // startLine (12), the exact line the seeded patch text renders it on.
      const configFile = wiring.files.find(
        (f: { path: string }) => f.path === 'src/config.ts',
      );
      expect(configFile).toBeDefined();
      expect(
        configFile.finding_marks.map((m: { line: number; severity: string }) => m.line),
      ).toContain(12);
      expect(
        configFile.finding_marks.some(
          (m: { severity: string }) => m.severity === 'CRITICAL',
        ),
      ).toBe(true);
    });

    it('stays at nine files after a repeat seed() call (no duplication, no loss)', async () => {
      // beforeAll already ran seed() once; this is the second run against the
      // same rows. pr_files has no (pr_id, path) unique index, so this is the
      // one thing that actually proves the delete-and-replace guard works.
      await seed(pg.handle.db);

      const prId = await getSeededPrId();
      const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      const totalFiles = body.groups.reduce(
        (n: number, g: { files: unknown[] }) => n + g.files.length,
        0,
      );
      expect(totalFiles).toBe(9);
    });
  });
});

/**
 * Findings-fetch degradation (SS-7): a failure reading findings must degrade
 * to empty marks with grouping intact, not fail the whole response. Runs
 * hermetically — no DB, no Docker — against the service directly.
 */
describe('SmartDiffService degradation (hermetic)', () => {
  it('degrades to empty marks, grouping intact, when findingsForPull rejects', async () => {
    const store: SmartDiffStorePort = {
      getPull: async () => ({ id: 'pr-1', headSha: 'sha-1' }),
      getPrFiles: async () => [
        { path: 'src/service.ts', additions: 5, deletions: 1 },
        { path: 'README.md', additions: 1, deletions: 0 },
      ],
      findingsForPull: async () => {
        throw new Error('db unavailable');
      },
    };
    const warnings: unknown[] = [];
    const service = new SmartDiffService({
      store,
      // Task 6 widened this port; only `summariesForPr` is exercised by
      // `get()`, which is all this hermetic test calls.
      repo: {
        summariesForPr: async () => [],
        upsertSummary: async () => {},
        featureModelChoice: async () => undefined,
      },
      model: async () => {
        throw new Error('not used: this test never calls summarize()');
      },
      log: { warn: (obj) => warnings.push(obj) },
    });

    const result = await service.get('ws-1', 'pr-1');

    expect(result.groups.map((g) => g.role)).toEqual(['core', 'boilerplate']);
    for (const group of result.groups) {
      for (const file of group.files) {
        expect(file.finding_marks).toEqual([]);
      }
    }
    expect(warnings).toHaveLength(1);
  });
});
