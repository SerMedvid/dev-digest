/**
 * POST /reviews/adhoc — a stateless review of a posted diff, the server side of
 * `devdigest review --mode working`.
 *
 * The two things worth pinning: it runs the SAME engine and grounding gate the
 * PR path does (so an ungrounded finding is dropped and reported, not served),
 * and it persists NOTHING — asserted by counting rows before and after, not by
 * reading the code.
 *
 * DB-backed because auth resolves the seeded workspace on every request.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { MAX_ADHOC_DIFF_BYTES } from '../src/modules/reviews/constants.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Two added lines at 3 and 4 — the only lines a finding can ground against. */
const DIFF = [
  'diff --git a/src/config.ts b/src/config.ts',
  '--- a/src/config.ts',
  '+++ b/src/config.ts',
  '@@ -1,2 +1,4 @@',
  ' const a = 1;',
  ' const b = 2;',
  '+const KEY = "sk_live_abc123";',
  '+export const cfg = { KEY };',
].join('\n');

/** One finding grounded in the diff, one citing a file that isn't in it. */
const REVIEW_FIXTURE = {
  verdict: 'request_changes',
  summary: 'A live secret is committed.',
  score: 40,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded secret key',
      file: 'src/config.ts',
      start_line: 3,
      end_line: 3,
      rationale: 'Line 3 adds a literal `sk_live_` key.',
      suggestion: 'Move it to an env var and rotate.',
      confidence: 0.98,
    },
    {
      id: 'f2',
      severity: 'WARNING',
      category: 'perf',
      title: 'N+1 query in a file this diff never touched',
      file: 'src/api/users.ts',
      start_line: 45,
      end_line: 52,
      rationale: 'Invented — nothing in the posted diff supports this.',
      confidence: 0.6,
    },
  ],
};

async function rowCounts(db: PgFixture['handle']['db']) {
  const [runs, reviews, findings, traces] = await Promise.all([
    db.select().from(t.agentRuns),
    db.select().from(t.reviews),
    db.select().from(t.findings),
    db.select().from(t.runTraces),
  ]);
  return {
    runs: runs.length,
    reviews: reviews.length,
    findings: findings.length,
    traces: traces.length,
  };
}

d('POST /reviews/adhoc (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let llm: MockLLMProvider;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        llm: { openrouter: llm, openai: llm, anthropic: llm },
        git: new MockGitClient(),
        github: new MockGitHubClient(),
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  describe('the happy path', () => {
    it('reviews the posted diff and reports what grounding dropped', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/reviews/adhoc',
        payload: { diff: DIFF },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      // The grounded finding survives; the invented one does not — and the
      // drop is REPORTED rather than silently swallowed.
      expect(body.review.findings).toHaveLength(1);
      expect(body.review.findings[0].file).toBe('src/config.ts');
      expect(body.dropped.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(body.scope_dropped)).toBe(true);

      expect(body.agent.name).toBeTruthy();
      expect(body.agent.ci_fail_on).toBeTruthy();
      expect(typeof body.model).toBe('string');
      expect(typeof body.tokens_in).toBe('number');
      expect(typeof body.tokens_out).toBe('number');
      expect(body).toHaveProperty('cost_usd');
    });

    it("counts blockers with the agent's own ci_fail_on threshold", async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/reviews/adhoc',
        payload: { diff: DIFF },
      });
      const body = res.json();
      // The kept finding is CRITICAL, so anything but `never` blocks on it.
      const expected = body.agent.ci_fail_on === 'never' ? 0 : 1;
      expect(body.blockers).toBe(expected);
    });

    it('persists absolutely nothing', async () => {
      const before = await rowCounts(pg.handle.db);
      const res = await app.inject({
        method: 'POST',
        url: '/reviews/adhoc',
        payload: { diff: DIFF },
      });
      expect(res.statusCode).toBe(200);
      expect(await rowCounts(pg.handle.db)).toEqual(before);
    });

    it('accepts an explicit agent name, case-insensitively', async () => {
      const [agent] = await pg.handle.db
        .select()
        .from(t.agents)
        .where(eq(t.agents.workspaceId, workspaceId));

      const res = await app.inject({
        method: 'POST',
        url: '/reviews/adhoc',
        payload: { diff: DIFF, agent: agent!.name.toUpperCase() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().agent.name).toBe(agent!.name);
    });

    it('picks the same default agent on every call', async () => {
      const first = await app.inject({
        method: 'POST',
        url: '/reviews/adhoc',
        payload: { diff: DIFF },
      });
      const second = await app.inject({
        method: 'POST',
        url: '/reviews/adhoc',
        payload: { diff: DIFF },
      });
      expect(first.json().agent.name).toBe(second.json().agent.name);
    });
  });

  describe('refusals', () => {
    it('404s an agent name nobody has, naming the ones that exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/reviews/adhoc',
        payload: { diff: DIFF, agent: 'Nonexistent Reviewer' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.message).toContain('Enabled agents:');
    });

    it('422s an empty diff at the schema, before any work', async () => {
      const before = llm.calls.length;
      const res = await app.inject({
        method: 'POST',
        url: '/reviews/adhoc',
        payload: { diff: '' },
      });
      expect(res.statusCode).toBe(422);
      expect(llm.calls).toHaveLength(before);
    });

    it('422s text that is not a diff, with code empty_diff and no model call', async () => {
      const before = llm.calls.length;
      const res = await app.inject({
        method: 'POST',
        url: '/reviews/adhoc',
        payload: { diff: 'just some prose, definitely not a unified diff' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('empty_diff');
      expect(llm.calls).toHaveLength(before);
    });

    it('413s a body over the cap, before the handler runs', async () => {
      const before = llm.calls.length;
      const res = await app.inject({
        method: 'POST',
        url: '/reviews/adhoc',
        payload: { diff: 'x'.repeat(MAX_ADHOC_DIFF_BYTES + 1024) },
      });
      expect(res.statusCode).toBe(413);
      expect(llm.calls).toHaveLength(before);
    });
  });

  describe('no enabled agents', () => {
    it('409s with a message naming the fix', async () => {
      const [ws] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: 'Agentless', slug: 'agentless-adhoc' })
        .returning();
      // The seeded workspace's agents stay enabled, so disable within a
      // workspace of its own rather than breaking every case above.
      const bare = await buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: {
          llm: { openrouter: llm },
          git: new MockGitClient(),
          github: new MockGitHubClient(),
        },
      });
      try {
        await pg.handle.db
          .update(t.agents)
          .set({ enabled: false })
          .where(eq(t.agents.workspaceId, workspaceId));

        const res = await bare.inject({
          method: 'POST',
          url: '/reviews/adhoc',
          payload: { diff: DIFF },
        });
        expect(res.statusCode).toBe(409);
        expect(res.json().error.code).toBe('no_agents');
        expect(res.json().error.message).toContain('Agents screen');
      } finally {
        await pg.handle.db
          .update(t.agents)
          .set({ enabled: true })
          .where(eq(t.agents.workspaceId, workspaceId));
        await bare.close();
        expect(ws).toBeDefined();
      }
    });
  });
});
