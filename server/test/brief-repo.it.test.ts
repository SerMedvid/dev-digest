/**
 * `pr_brief` persistence and the workspace's `risk_brief` model choice.
 * Gated on Docker (needs Postgres), matching the other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { BriefRepository } from '../src/modules/brief/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const BRIEF = {
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
  ],
  review_focus: [{ file: 'src/config.ts', line: 12, reason: 'The secret.' }],
};

d('pr_brief persistence (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repo: BriefRepository;
  let prId: string;
  let reviewId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    repo = new BriefRepository(pg.handle.db);

    const [r] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'brief-repo', fullName: 'acme/brief-repo' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: r!.id,
        number: 21,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'sha-one',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'open',
      })
      .returning();
    prId = pr!.id;
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId, kind: 'review', verdict: 'comment', model: 'seed' })
      .returning();
    reviewId = review!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('returns undefined for a PR with no brief', async () => {
    expect(await repo.get(crypto.randomUUID())).toBeUndefined();
  });

  it('round-trips the row', async () => {
    await repo.put({
      prId,
      headSha: 'sha-one',
      brief: BRIEF,
      reviewId,
      sources: ['pr', 'files (60 of 214)'],
      estTokensIn: 7_100,
      provider: 'openai',
      model: 'gpt-4.1',
    });

    const row = await repo.get(prId);
    expect(row?.headSha).toBe('sha-one');
    expect(row?.brief).toEqual(BRIEF);
    expect(row?.reviewId).toBe(reviewId);
    expect(row?.sources).toEqual(['pr', 'files (60 of 214)']);
    expect(row?.estTokensIn).toBe(7_100);
    expect(row?.provider).toBe('openai');
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it('replaces every column on a second put, createdAt included', async () => {
    const first = await repo.get(prId);
    // A regeneration is a NEW brief at a new head, not an edit of the first one
    // ever made for this PR — so the timestamp moves with it.
    await new Promise((r) => setTimeout(r, 5));
    await repo.put({
      prId,
      headSha: 'sha-two',
      brief: { ...BRIEF, risk_level: 'low', risks: [] },
      reviewId: null,
      sources: ['pr'],
      estTokensIn: 100,
      provider: 'seed',
      model: 'seed',
    });

    const second = await repo.get(prId);
    expect(second?.headSha).toBe('sha-two');
    expect(second?.reviewId).toBeNull();
    expect(second?.sources).toEqual(['pr']);
    expect(second?.estTokensIn).toBe(100);
    expect(second?.model).toBe('seed');
    expect((second?.brief as { risks: unknown[] }).risks).toEqual([]);
    expect(second!.createdAt.getTime()).toBeGreaterThan(first!.createdAt.getTime());

    // Still one row: `pr_id` is the primary key, one brief per PR.
    const all = await pg.handle.db.select().from(t.prBrief);
    expect(all.filter((r) => r.prId === prId)).toHaveLength(1);
  });

  /**
   * `settings`'s unique index is on (workspace_id, user_id, key) and `user_id`
   * is nullable, so Postgres treats every workspace-level row as distinct and
   * `ON CONFLICT` never matches. Replace by delete-then-insert.
   */
  async function putFeatureModels(value: unknown) {
    await pg.handle.db
      .delete(t.settings)
      .where(
        and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')),
      );
    await pg.handle.db.insert(t.settings).values({ workspaceId, key: 'feature_models', value });
  }

  it('reads the workspace risk_brief choice, and undefined when unset', async () => {
    expect(await repo.featureModelChoice(workspaceId)).toBeUndefined();

    await putFeatureModels({ risk_brief: { provider: 'anthropic', model: 'claude-sonnet-5' } });

    expect(await repo.featureModelChoice(workspaceId)).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
    });
  });

  it('returns undefined rather than throwing on a malformed stored choice', async () => {
    await putFeatureModels({ risk_brief: 'gpt-4.1' });
    // A hand-edited settings row must fall back to the registry default, not
    // fail every generation in the workspace.
    expect(await repo.featureModelChoice(workspaceId)).toBeUndefined();
  });

  it('seeds exactly one brief for the demo PR, at the seeded head', async () => {
    // Re-seeding an already-seeded database must not duplicate or move it.
    await seed(pg.handle.db);
    const [demo] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.number, 482));
    const rows = await pg.handle.db
      .select()
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, demo!.id));

    expect(rows).toHaveLength(1);
    // Read off the PR row rather than restated, or the card renders as
    // permanently stale on a fresh install.
    expect(rows[0]!.headSha).toBe(demo!.headSha);
    expect(rows[0]!.reviewId).not.toBeNull();
    expect(rows[0]!.provider).toBe('seed');
  });
});
