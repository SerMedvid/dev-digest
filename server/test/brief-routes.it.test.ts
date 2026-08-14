/**
 * GET and POST /pulls/:id/brief, end to end over a hand-seeded PR.
 *
 * The LLM is a `MockLLMProvider` in the `openai` slot (what the `risk_brief`
 * registry default resolves to), and every read case asserts it recorded ZERO
 * further calls — the read path must never spend one. That counter, not
 * timing, is how AC-4 is checked.
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

const HEAD = 'briefsha000001';

/**
 * The model's answer. `src/imaginary.ts` is deliberately not in `pr_files`:
 * every route case below is also a live assertion that the grounding gate ran
 * before anything was persisted.
 */
const MODEL_BRIEF = {
  what: 'Adds rate limiting to the public API.',
  why: 'Unauthenticated clients can hammer the public endpoints without limit.',
  risk_level: 'high',
  risks: [
    {
      title: 'Committed secret',
      explanation: 'A live key is in the diff.',
      severity: 'high',
      refs: ['src/config.ts'],
    },
    {
      title: 'Invented',
      explanation: 'About a file that is not in this PR.',
      severity: 'low',
      refs: ['src/imaginary.ts'],
    },
  ],
  review_focus: [
    { file: 'src/config.ts', line: 12, reason: 'The secret.' },
    { file: 'src/imaginary.ts', line: 3, reason: 'Does not exist.' },
  ],
};

let repoSeq = 0;

async function seedPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  opts: { files: boolean; withReview: boolean; headSha?: string } = { files: true, withReview: true },
) {
  const name = `brief-${repoSeq++}`;
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
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/ratelimit',
      base: 'main',
      headSha: opts.headSha ?? HEAD,
      additions: 88,
      deletions: 2,
      filesCount: 2,
      status: 'open',
      body: 'Prevent abuse.',
    })
    .returning();

  if (opts.files) {
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0, patch: null },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 2, patch: null },
    ]);
  }

  let reviewId: string | null = null;
  if (opts.withReview) {
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'A key is committed.',
        score: 61,
        model: 'seed',
      })
      .returning();
    reviewId = review!.id;
    await db.insert(t.findings).values({
      reviewId,
      file: 'src/config.ts',
      startLine: 10,
      endLine: 14,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded key',
      rationale: 'Line 12 has a live key.',
      confidence: 0.98,
    });
  }

  return { repo: repo!, pr: pr!, reviewId };
}

d('brief routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let llm: MockLLMProvider;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    llm = new MockLLMProvider('openai', { structuredBySchema: { PrBrief: MODEL_BRIEF } });
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        llm: { openai: llm },
        git: new MockGitClient(),
        github: new MockGitHubClient(),
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  function structuredCalls() {
    return llm.calls.filter((c) => c.method === 'completeStructured');
  }

  describe('POST then GET at an unchanged head (AC-1, AC-4)', () => {
    it('generates once and serves the stored record on every read', async () => {
      const { pr, reviewId } = await seedPr(pg.handle.db, workspaceId);
      const before = structuredCalls().length;

      const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
      expect(post.statusCode).toBe(200);
      const generated = post.json();

      // All five fields, from one structured call.
      expect(generated.what).toBe(MODEL_BRIEF.what);
      expect(generated.why).toBe(MODEL_BRIEF.why);
      expect(generated.risk_level).toBe('high');
      expect(generated.head_sha).toBe(HEAD);
      expect(generated.review_id).toBe(reviewId);
      expect(generated.stale).toBe(false);
      expect(generated.provider).toBe('openai');
      expect(generated.est_tokens_in).toBeGreaterThan(0);

      // The grounding gate ran before persistence: the invented risk is gone,
      // and the invented focus item with it.
      expect(generated.risks.map((r: { title: string }) => r.title)).toEqual(['Committed secret']);
      expect(generated.review_focus).toEqual([
        { file: 'src/config.ts', line: 12, reason: 'The secret.' },
      ]);

      const first = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
      const second = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(first.json()).toEqual(generated);
      expect(second.json()).toEqual(generated);

      // One POST, two GETs, exactly one model call. Asserted on the counter,
      // never on timing.
      expect(structuredCalls()).toHaveLength(before + 1);
    });
  });

  describe('POST always regenerates (AC-7)', () => {
    it('spends a second call and replaces the row', async () => {
      const { pr } = await seedPr(pg.handle.db, workspaceId);
      const before = structuredCalls().length;

      const first = (await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).json();
      await new Promise((r) => setTimeout(r, 5));
      const second = (await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).json();

      expect(structuredCalls()).toHaveLength(before + 2);
      expect(new Date(second.created_at).getTime()).toBeGreaterThan(
        new Date(first.created_at).getTime(),
      );
      const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
      expect(rows).toHaveLength(1);
    });
  });

  describe('the head moving invalidates the cache', () => {
    it('404s with the "not generated for this state" message, not the unknown-PR one', async () => {
      const { pr } = await seedPr(pg.handle.db, workspaceId);
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });

      await pg.handle.db
        .update(t.pullRequests)
        .set({ headSha: 'moved-on-000002' })
        .where(eq(t.pullRequests.id, pr.id));

      const before = structuredCalls().length;
      const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
      expect(res.statusCode).toBe(404);
      // The two 404s carry deliberately different messages and must not be
      // collapsed: one means "not yours", the other "not yet".
      expect(res.json().error.message).toContain('No brief has been generated');
      expect(structuredCalls()).toHaveLength(before);
    });
  });

  describe('staleness (AC-8)', () => {
    it('still serves the row, marked stale, once a newer review has run', async () => {
      const { pr } = await seedPr(pg.handle.db, workspaceId);
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });

      await pg.handle.db
        .insert(t.reviews)
        .values({ workspaceId, prId: pr.id, kind: 'review', verdict: 'approve', model: 'seed' });

      const before = structuredCalls().length;
      const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
      expect(res.statusCode).toBe(200);
      expect(res.json().stale).toBe(true);
      // Stale is a marker, not a trigger: nothing regenerates on the user's
      // behalf.
      expect(structuredCalls()).toHaveLength(before);
    });
  });

  describe('refusals', () => {
    it('422s brief_no_inputs on a PR with no changed files, with no model call (AC-10)', async () => {
      const { pr } = await seedPr(pg.handle.db, workspaceId, { files: false, withReview: false });
      const before = structuredCalls().length;

      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('brief_no_inputs');
      expect(structuredCalls()).toHaveLength(before);
    });

    it('yields one 200 and one 409 for two concurrent POSTs (AC-11)', async () => {
      const { pr } = await seedPr(pg.handle.db, workspaceId);
      const [a, b] = await Promise.all([
        app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` }),
        app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` }),
      ]);
      const codes = [a.statusCode, b.statusCode].sort();
      expect(codes).toEqual([200, 409]);
      const conflict = a.statusCode === 409 ? a : b;
      expect(conflict.json().error.code).toBe('conflict');
    });

    it('422s a non-uuid :id on both routes', async () => {
      for (const method of ['GET', 'POST'] as const) {
        const res = await app.inject({ method, url: '/pulls/not-a-uuid/brief' });
        expect(res.statusCode).toBe(422);
      }
    });
  });

  describe('workspace scoping (AC-12)', () => {
    it('404s a PR in another workspace on both routes, with the unknown-PR message', async () => {
      const [other] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: 'other-ws' })
        .returning();
      const { pr } = await seedPr(pg.handle.db, other!.id);

      for (const method of ['GET', 'POST'] as const) {
        const res = await app.inject({ method, url: `/pulls/${pr.id}/brief` });
        // 404 and never 403: a PR in another workspace is indistinguishable
        // from one that does not exist.
        expect(res.statusCode).toBe(404);
        expect(res.json().error.message).toBe('Pull request not found');
      }
    });
  });

  describe('degradation on a real request (AC-9)', () => {
    it('generates without a review, an index or a clone, and says what was missing', async () => {
      const { pr } = await seedPr(pg.handle.db, workspaceId, { files: true, withReview: false });
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.review_id).toBeNull();
      expect(body.sources).toContain('findings (no review yet)');
      // No index rows were seeded for this repo, so the map is degraded — one
      // input of seven, so it omits its section rather than refusing.
      expect(body.sources.some((s: string) => s.startsWith('blast'))).toBe(true);
      // Nothing vouches for a line without findings.
      expect(body.review_focus.every((f: { line: number | null }) => f.line === null)).toBe(true);
    });
  });
});
