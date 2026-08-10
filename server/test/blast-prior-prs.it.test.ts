/**
 * The prior-PRs SQL, against a real Postgres. Grouping, the distinct counts,
 * the ordering and the status allowlist can only be verified here — a stubbed
 * version of this file would assert nothing about the query.
 *
 * Fixtures are inserted by the test rather than taken from `seed.ts`: the seed
 * creates ONE pull request, with `status: 'needs_review'`, so a seeded database
 * has neither a second PR to compare against nor one with a merge state.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  getPriorPrsTouching,
  countPrsWithoutFiles,
} from '../src/modules/reviews/repository/pull.repo.js';
import { PRIOR_PR_STATUSES } from '../src/modules/blast/constants.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

let pg: PgFixture;
let db: PgFixture['handle']['db'];
let workspaceId: string;
let repoId: string;
let otherRepoId: string;
/** The PR under review — the one whose files everything is compared against. */
let subjectId: string;

/** Insert a PR with the given files. Returns its id. */
async function makePr(args: {
  repo: string;
  number: number;
  title: string;
  author: string;
  status: string;
  updatedAt: Date | null;
  files: string[];
  workspace?: string;
}): Promise<string> {
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId: args.workspace ?? workspaceId,
      repoId: args.repo,
      number: args.number,
      title: args.title,
      author: args.author,
      branch: `b${args.number}`,
      base: 'main',
      headSha: `sha${args.number}`,
      status: args.status,
      updatedAt: args.updatedAt,
    })
    .returning();
  if (args.files.length > 0) {
    await db.insert(t.prFiles).values(args.files.map((path) => ({ prId: pr!.id, path })));
  }
  return pr!.id;
}

// One outer suite owns the container, as `blast-routes.it.test.ts` does: an
// `afterAll` inside a sibling `describe` fires before the NEXT describe's tests,
// which would hand the route case a closed connection.
d('prior PRs (Testcontainers pg)', () => {
  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;

    // Seed first and hang the fixtures off the SEEDED workspace: `getContext`
    // resolves the current workspace by looking that row up, so a PR under a
    // freshly-inserted workspace would 404 through the route in Task 4.
    // (`blast-routes.it.test.ts` does exactly this.) The fixture repo is our
    // own, so the seeded PR never affects a repo-scoped count.
    await seed(db);
    const [ws] = await db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'api', fullName: 'acme/api' })
      .returning();
    repoId = repo!.id;
    const [other] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'web', fullName: 'acme/web' })
      .returning();
    otherRepoId = other!.id;

    subjectId = await makePr({
      repo: repoId,
      number: 500,
      title: 'Subject',
      author: 'me',
      status: 'open',
      updatedAt: new Date('2026-08-10T00:00:00Z'),
      files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    });

    // Three shared paths — the most overlap, so it must sort first.
    await makePr({
      repo: repoId, number: 478, title: 'Three shared', author: 'sergii',
      status: 'merged', updatedAt: new Date('2026-08-01T00:00:00Z'),
      files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/z.ts'],
    });
    // One shared path, but the most recent of the one-overlap PRs.
    await makePr({
      repo: repoId, number: 455, title: 'One shared, recent', author: 'dana',
      status: 'closed', updatedAt: new Date('2026-08-05T00:00:00Z'),
      files: ['src/a.ts'],
    });
    // One shared path, older — proves the secondary sort key.
    await makePr({
      repo: repoId, number: 400, title: 'One shared, old', author: 'dana',
      status: 'merged', updatedAt: new Date('2026-01-01T00:00:00Z'),
      files: ['src/b.ts'],
    });
    // Still open — history only, so it must be excluded.
    await makePr({
      repo: repoId, number: 491, title: 'Open collision', author: 'dana',
      status: 'open', updatedAt: new Date('2026-08-09T00:00:00Z'),
      files: ['src/a.ts'],
    });
    // Never synced from GitHub — the schema default, not a merge state.
    await makePr({
      repo: repoId, number: 492, title: 'Never synced', author: 'dana',
      status: 'needs_review', updatedAt: new Date('2026-08-09T00:00:00Z'),
      files: ['src/a.ts'],
    });
    // Merged, shares nothing.
    await makePr({
      repo: repoId, number: 300, title: 'No overlap', author: 'dana',
      status: 'merged', updatedAt: new Date('2026-07-01T00:00:00Z'),
      files: ['src/unrelated.ts'],
    });
    // Merged and overlapping, but in a DIFFERENT repo.
    await makePr({
      repo: otherRepoId, number: 12, title: 'Other repo', author: 'dana',
      status: 'merged', updatedAt: new Date('2026-08-08T00:00:00Z'),
      files: ['src/a.ts'],
    });
    // Merged, overlapping, but its detail was never opened — no pr_files rows.
    await makePr({
      repo: repoId, number: 460, title: 'Never opened', author: 'dana',
      status: 'merged', updatedAt: new Date('2026-08-07T00:00:00Z'),
      files: [],
    });
  }, 120_000);

  afterAll(async () => {
    await pg?.stop();
  });

  const run = () =>
    getPriorPrsTouching(db, {
      workspaceId,
      repoId,
      excludePrId: subjectId,
      paths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      statuses: PRIOR_PR_STATUSES,
      limit: 10,
    });

  it('orders by overlap, then by recency', async () => {
    const rows = await run();
    expect(rows.map((r) => r.number)).toEqual([478, 455, 400]);
  });

  it('counts distinct shared paths, ignoring the PR files that do not overlap', async () => {
    const rows = await run();
    const top = rows.find((r) => r.number === 478)!;
    // Four files touched, three of them shared. `src/z.ts` must not be counted.
    expect(top.overlapCount).toBe(3);
    expect([...top.overlapFiles].sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('carries the fields the row needs and nothing invented', async () => {
    const rows = await run();
    const top = rows.find((r) => r.number === 478)!;
    expect(top.title).toBe('Three shared');
    expect(top.author).toBe('sergii');
    expect(top.status).toBe('merged');
    expect(top.updatedAt?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('excludes open, never-synced, non-overlapping, other-repo and the subject itself', async () => {
    const numbers = (await run()).map((r) => r.number);
    expect(numbers).not.toContain(500); // the subject
    expect(numbers).not.toContain(491); // open
    expect(numbers).not.toContain(492); // needs_review, never synced
    expect(numbers).not.toContain(300); // merged, no shared path
    expect(numbers).not.toContain(12); // other repo
  });

  it('scopes to the workspace', async () => {
    const [ws2] = await db.insert(t.workspaces).values({ name: 'prior-prs-other-ws' }).returning();
    const rows = await getPriorPrsTouching(db, {
      workspaceId: ws2!.id,
      repoId,
      excludePrId: subjectId,
      paths: ['src/a.ts'],
      statuses: PRIOR_PR_STATUSES,
      limit: 10,
    });
    expect(rows).toEqual([]);
  });

  it('honours the limit', async () => {
    const rows = await getPriorPrsTouching(db, {
      workspaceId,
      repoId,
      excludePrId: subjectId,
      paths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      statuses: PRIOR_PR_STATUSES,
      limit: 2,
    });
    expect(rows.map((r) => r.number)).toEqual([478, 455]);
  });

  it('counts the PRs that have no stored files at all', async () => {
    // #460 is the only PR in this repo with no `pr_files` rows.
    const n = await countPrsWithoutFiles(db, {
      workspaceId,
      repoId,
      excludePrId: subjectId,
    });
    expect(n).toBe(1);
  });

  describe('GET /pulls/:id/prior-prs', () => {
    it('serves the list and the disclosure, and 404s an unknown PR', async () => {
      const app = await buildApp({
        config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
        db,
        overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
      });
      try {
        const res = await app.inject({ method: 'GET', url: `/pulls/${subjectId}/prior-prs` });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.prs.map((p: { number: number }) => p.number)).toEqual([478, 455, 400]);
        expect(body.prs[0].overlap_count).toBe(3);
        // Serialised, so the Date is gone and an ISO string is in its place.
        expect(body.prs[0].updated_at).toBe('2026-08-01T00:00:00.000Z');
        expect(body.uncomparable_prs).toBe(1);

        const missing = await app.inject({
          method: 'GET',
          url: '/pulls/00000000-0000-0000-0000-000000000000/prior-prs',
        });
        expect(missing.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });
  });
});
