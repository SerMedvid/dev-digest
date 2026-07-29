import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts (line 11 added) so grounding can keep a
 * finding on line 11 and drop one on line 999 / a non-existent file.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A Review fixture: one valid finding (line 11), one hallucinated (line 999). */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  // persist the patch so the reviewer can reconstruct a diff (MockGit also returns one)
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

/**
 * Insert a review + its findings directly. The findings roll-up needs precise
 * severities/confidences/rationale lengths that a mocked LLM run can't give,
 * and severity is a plain text column — so an out-of-enum value is only
 * reachable this way.
 */
async function insertReviewWithFindings(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  prId: string,
  findings: { severity: string; confidence: number; title: string; rationale?: string }[],
) {
  const [review] = await db
    .insert(t.reviews)
    .values({ workspaceId, prId, kind: 'review', verdict: 'comment' })
    .returning();
  if (findings.length > 0) {
    await db.insert(t.findings).values(
      findings.map((f, i) => ({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 10 + i,
        endLine: 10 + i,
        severity: f.severity,
        category: 'security',
        title: f.title,
        rationale: f.rationale ?? 'because.',
        confidence: f.confidence,
      })),
    );
  }
  return review!;
}

d('A2 reviews + agents (Testcontainers pg)', () => {
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

  function appWith(structured: unknown, provider: 'openai' | 'anthropic' = 'openai') {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          [provider]: new MockLLMProvider(provider, { structured }),
        },
      },
    });
  }

  it('agents CRUD', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Test Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a reviewer.',
      },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json();
    expect(agent.version).toBe(1);

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    expect(list.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    // a config change bumps version
    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'Updated prompt.' },
      })
    ).json();
    expect(updated.version).toBe(2);

    await app.close();
  });

  it('runs a review: map-reduce + grounding drops the hallucinated finding, keeps the valid one', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);

    // runReview is fire-and-forget: wait for the background run, then read the
    // persisted reviews (the POST returns runIds, not the reviews themselves).
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews).toHaveLength(1);

    const review = reviews[0];
    expect(review.verdict).toBe('request_changes');
    // Score is derived from the GROUNDED findings, not the model's self-reported
    // 42: grounding keeps one CRITICAL (line 11) ⇒ 100 − 35 = 65.
    expect(review.score).toBe(65);
    // grounding kept only the valid finding (line 11), dropped the line-999 one
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].file).toBe('src/config.ts');
    expect(review.findings[0].start_line).toBe(11);

    // a run_traces document was written (single doc)
    const runId = body.runs[0].run_id;
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.config.model).toBe('gpt-4.1');
    expect(trace.stats.grounding).toBe('1/2 passed');
    expect(trace.log.length).toBeGreaterThan(0);

    // agent_runs row populated for A5 to aggregate
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.findingsCount).toBe(1);
    expect(run!.grounding).toBe('1/2 passed');

    // Cost survives the engine → executor → agent_runs → API path. The mock LLM
    // reports 0.001 per call, so the persisted value is a positive number.
    expect(run!.costUsd).toBeGreaterThan(0);
    expect(trace.stats.cost_usd).toBeCloseTo(run!.costUsd!, 10);
    const runsList = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })).json();
    expect(runsList[0].cost_usd).toBeCloseTo(run!.costUsd!, 10);

    await app.close();
  });

  it('cost: PR list rolls up run spend; a failed run stores null, not 0', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Cost', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    // Two successful runs on the same PR — the list column shows the TOTAL.
    for (let i = 0; i < 2; i++) {
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
      await waitForPrRuns(pg.handle.db, pr.id, { expected: i + 1 });
    }
    const runs = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })).json();
    expect(runs).toHaveLength(2);
    const expectedTotal = runs.reduce((n: number, r: { cost_usd: number | null }) => n + (r.cost_usd ?? 0), 0);
    expect(expectedTotal).toBeGreaterThan(0);

    const pulls = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const listed = pulls.find((p: { number: number }) => p.number === pr.number);
    expect(listed.cost_usd).toBeCloseTo(expectedTotal, 10);

    await app.close();

    // A run that FAILS (fixture doesn't satisfy the Review schema) must persist
    // a null cost. 0 would render as "$0" — i.e. "this run was free" — which is
    // a different claim from "we don't know what it cost".
    const failApp = await appWith({ not: 'a review' });
    const { repo: repo2, pr: pr2 } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent2 = (
      await failApp.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Boom', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();
    await failApp.inject({ method: 'POST', url: `/pulls/${pr2.id}/review`, payload: { agentId: agent2.id } });
    await waitForPrRuns(pg.handle.db, pr2.id, { expected: 1 });

    const failedRuns = (await failApp.inject({ method: 'GET', url: `/pulls/${pr2.id}/runs` })).json();
    expect(failedRuns[0].status).toBe('failed');
    expect(failedRuns[0].cost_usd).toBeNull();

    // …and the PR-list roll-up over only-null costs is null, not 0.
    const pulls2 = (await failApp.inject({ method: 'GET', url: `/repos/${repo2.id}/pulls` })).json();
    const listed2 = pulls2.find((p: { number: number }) => p.number === pr2.number);
    expect(listed2.cost_usd).toBeNull();

    await failApp.close();
  });

  it('findings counters: per-severity roll-up across reviews, capped+ordered preview, unknown severities folded away', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const db = pg.handle.db;

    const LONG_RATIONALE = 'x'.repeat(400);
    await insertReviewWithFindings(db, workspaceId, pr.id, [
      { severity: 'CRITICAL', confidence: 0.9, title: 'crit-hi', rationale: LONG_RATIONALE },
      { severity: 'CRITICAL', confidence: 0.5, title: 'crit-lo' },
      { severity: 'WARNING', confidence: 0.8, title: 'warn-hi' },
      { severity: 'SUGGESTION', confidence: 0.7, title: 'sugg-mid' },
      // Not one of the three Severity values — must vanish from BOTH counts and
      // preview even though its confidence would otherwise rank it first.
      { severity: 'INFO', confidence: 0.99, title: 'unknown-sev' },
    ]);
    // A SECOND review of the same PR: counts aggregate across all of them.
    await insertReviewWithFindings(db, workspaceId, pr.id, [
      { severity: 'WARNING', confidence: 0.6, title: 'warn-lo' },
      { severity: 'SUGGESTION', confidence: 0.95, title: 'sugg-hi' },
      { severity: 'SUGGESTION', confidence: 0.1, title: 'sugg-lo' },
    ]);
    // Another WORKSPACE'S review of the very same PR row: scoping is what keeps
    // it out, so a missing workspace filter would show up here.
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other' }).returning();
    await insertReviewWithFindings(db, otherWs!.id, pr.id, [
      { severity: 'CRITICAL', confidence: 1, title: 'leaked-from-other-workspace' },
    ]);

    const listPulls = async () =>
      (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const listed = (await listPulls()).find((p: { number: number }) => p.number === pr.number);

    expect(listed.findings_by_severity).toEqual({ CRITICAL: 2, WARNING: 2, SUGGESTION: 3 });

    // Preview: capped at 6 of the 7, severity rank first, confidence desc within.
    expect(listed.findings_preview.map((f: { title: string }) => f.title)).toEqual([
      'crit-hi',
      'crit-lo',
      'warn-hi',
      'warn-lo',
      'sugg-hi',
      'sugg-mid',
    ]);
    expect(listed.findings_preview[0].rationale_snippet).toHaveLength(280);
    expect(listed.findings_preview[0].file).toBe('src/config.ts');
    expect(listed.findings_preview[0].confidence).toBeCloseTo(0.9, 10);

    // Dismissing removes a finding from the counters; un-dismissing restores it.
    const [critHi] = await db.select().from(t.findings).where(eq(t.findings.title, 'crit-hi'));
    await app.inject({ method: 'POST', url: `/findings/${critHi!.id}/dismiss` });
    const afterDismiss = (await listPulls()).find((p: { number: number }) => p.number === pr.number);
    expect(afterDismiss.findings_by_severity).toEqual({ CRITICAL: 1, WARNING: 2, SUGGESTION: 3 });
    expect(afterDismiss.findings_preview.map((f: { title: string }) => f.title)).not.toContain(
      'crit-hi',
    );
    // …and 'sugg-lo' is now in range of the 6-item cap.
    expect(afterDismiss.findings_preview).toHaveLength(6);

    await app.inject({ method: 'POST', url: `/findings/${critHi!.id}/accept` });
    const afterAccept = (await listPulls()).find((p: { number: number }) => p.number === pr.number);
    expect(afterAccept.findings_by_severity).toEqual({ CRITICAL: 2, WARNING: 2, SUGGESTION: 3 });

    await app.close();
  });

  it('findings counters: no findings → null (not zeros); a thrown roll-up degrades to null and still 200s', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // Never reviewed at all.
    const unreviewed = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    expect(unreviewed[0].findings_by_severity).toBeNull();
    expect(unreviewed[0].findings_preview).toBeNull();

    // Reviewed, but every finding dismissed → still null, not `{0,0,0}` / `[]`.
    await insertReviewWithFindings(pg.handle.db, workspaceId, pr.id, [
      { severity: 'WARNING', confidence: 0.4, title: 'only-finding' },
    ]);
    const [only] = await pg.handle.db
      .select()
      .from(t.findings)
      .where(eq(t.findings.title, 'only-finding'));
    await app.inject({ method: 'POST', url: `/findings/${only!.id}/dismiss` });
    const allDismissed = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    expect(allDismissed[0].findings_by_severity).toBeNull();
    expect(allDismissed[0].findings_preview).toBeNull();

    // Degradation: the counters are never a reason for the list to 500.
    const spy = vi
      .spyOn(app.container.reviewRepo, 'findingsSummaryByPr')
      .mockRejectedValue(new Error('boom'));
    const degraded = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` });
    expect(degraded.statusCode).toBe(200);
    expect(degraded.json()[0].findings_by_severity).toBeNull();
    expect(degraded.json()[0].findings_preview).toBeNull();
    // One aggregate for the whole page — never one per row.
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();

    await app.close();
  });

  it('dual-provider structured output: anthropic provider returns the same Review shape', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'anthropic');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Claude Rev', provider: 'anthropic', model: 'claude-x', system_prompt: 'rev' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews[0].findings).toHaveLength(1);
    expect(reviews[0].model).toBe('claude-x');
    await app.close();
  });

  it('finding actions: accept, dismiss', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ActAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    const findingId = reviews[0].findings[0].id;

    const accepted = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` })
    ).json();
    expect(accepted.finding.accepted_at).not.toBeNull();

    const dismissed = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` })
    ).json();
    expect(dismissed.finding.dismissed_at).not.toBeNull();
    expect(dismissed.finding.accepted_at).toBeNull();

    await app.close();
  });

  it('SSE: /runs/:id/events streams events and completes', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SseAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    // The run is synchronous; events are buffered on the bus. Subscribing after
    // the run still replays the buffer (replay-first semantics), then completes.
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;

    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    // The replay buffer should contain our log lines as SSE `data:` frames.
    expect(sse.payload).toContain('Starting review');
    expect(sse.payload).toContain('Citation grounding');
    await app.close();
  });

  it('run all enabled agents reviews with each enabled agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    // seed has 2 enabled agents; we may have created more above in this PR's ws.
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });
});
