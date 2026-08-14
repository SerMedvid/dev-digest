/**
 * pr_intent persistence — upsertIntent/getIntent widened to carry the
 * evidence trail (head sha, confidence, sources, missing context, model).
 * Gated on Docker (needs Postgres), matching the other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name: 'intent-repo', fullName: 'acme/intent-repo' })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 11,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'deadbeef',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

d('pr_intent persistence (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let reviewRepo: ReviewRepository;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    reviewRepo = new ReviewRepository(pg.handle.db);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    prId = pr.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('round-trips the record and overwrites on re-derivation', async () => {
    await reviewRepo.upsertIntent(prId, {
      intent: { intent: 'Add rate limiting', in_scope: ['middleware'], out_of_scope: ['auth'] },
      headSha: 'sha-one',
      confidence: 'low',
      sources: ['title', 'hunk_headers'],
      missingContext: ['issue #7 could not be fetched: 404'],
      linkedIssue: { number: 12, title: 'Rate limit us', body: 'Please.', state: 'open' },
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash-lite',
    });

    const first = await reviewRepo.getIntent(prId);
    expect(first?.intent).toBe('Add rate limiting');
    expect(first?.in_scope).toEqual(['middleware']);
    expect(first?.confidence).toBe('low');
    expect(first?.missingContext).toEqual(['issue #7 could not be fetched: 404']);
    expect(first?.headSha).toBe('sha-one');
    expect(first?.createdAt).toBeInstanceOf(Date);
    expect(first?.linkedIssue).toEqual({
      number: 12,
      title: 'Rate limit us',
      body: 'Please.',
      state: 'open',
    });

    await reviewRepo.upsertIntent(prId, {
      intent: { intent: 'Add rate limiting, take two', in_scope: ['middleware'], out_of_scope: [] },
      headSha: 'sha-two',
      confidence: 'high',
      sources: ['title', 'description', 'issue#471'],
      missingContext: [],
      // A PR that no longer links an issue. The column is in `values`, so
      // re-derivation replaces it wholesale — a stale reference surviving here
      // is a reference the brief would then render as current (L05).
      linkedIssue: null,
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash-lite',
    });

    const second = await reviewRepo.getIntent(prId);
    expect(second?.headSha).toBe('sha-two');
    expect(second?.confidence).toBe('high');
    expect(second?.missingContext).toEqual([]);
    expect(second?.out_of_scope).toEqual([]);
    expect(second?.linkedIssue).toBeNull();
  });

  it('returns undefined for a PR with no intent', async () => {
    expect(await reviewRepo.getIntent(crypto.randomUUID())).toBeUndefined();
  });
});
