/**
 * repo-intel: reverse-dependency BFS + declaration-file caller exclusion.
 *
 * `file_edges_repo_to_idx (repo_id, to_file)` was created so blast could answer
 * "who depends on this file?" in O(degree); until now nothing read it. These
 * cases pin the walk's contract: bounded depth, cycle-safe, input files never
 * echoed back, deterministic order.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('repo-intel blast reads', () => {
  let pg: PgFixture;
  let repo: RepoIntelRepository;
  /** Import-graph fixture repo. */
  let graphRepoId: string;
  /** Self-reference fixture repo (kept separate so the two can't cross-talk). */
  let refRepoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    const [graph] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner: 'acme', name: 'graph', fullName: 'acme/graph' })
      .returning();
    const [refs] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner: 'acme', name: 'selfref', fullName: 'acme/selfref' })
      .returning();
    graphRepoId = graph!.id;
    refRepoId = refs!.id;
    repo = new RepoIntelRepository(pg.handle.db);

    // Import chain a ← b ← c ← d (an arrow means "imports"), plus a cycle
    // x ↔ y hanging off a. `fromFile` imports `toFile`.
    await pg.handle.db.insert(t.fileEdges).values([
      { repoId: graphRepoId, fromFile: 'src/b.ts', toFile: 'src/a.ts' },
      { repoId: graphRepoId, fromFile: 'src/c.ts', toFile: 'src/b.ts' },
      { repoId: graphRepoId, fromFile: 'src/d.ts', toFile: 'src/c.ts' },
      { repoId: graphRepoId, fromFile: 'src/x.ts', toFile: 'src/a.ts' },
      { repoId: graphRepoId, fromFile: 'src/x.ts', toFile: 'src/y.ts' },
      { repoId: graphRepoId, fromFile: 'src/y.ts', toFile: 'src/x.ts' },
    ]);
    // An edge in the OTHER repo that would break every assertion if the walk
    // forgot its repoId predicate.
    await pg.handle.db
      .insert(t.fileEdges)
      .values([{ repoId: refRepoId, fromFile: 'src/leak.ts', toFile: 'src/a.ts' }]);

    // `rateLimit` is declared in ratelimit.ts and referenced twice: once from a
    // genuine cross-file caller, once from its OWN declaration file (a
    // recursive call or a re-export). The second is not a blast caller.
    await pg.handle.db.insert(t.references).values([
      {
        repoId: refRepoId,
        fromPath: 'src/api/index.ts',
        toSymbol: 'rateLimit',
        line: 23,
        declFile: 'src/middleware/ratelimit.ts',
      },
      {
        repoId: refRepoId,
        fromPath: 'src/middleware/ratelimit.ts',
        toSymbol: 'rateLimit',
        line: 41,
        declFile: 'src/middleware/ratelimit.ts',
      },
    ]);
    await pg.handle.db.insert(t.fileRank).values([
      {
        repoId: refRepoId,
        filePath: 'src/api/index.ts',
        pagerank: 0.9,
        hotness: 0,
        rank: 0.9,
        percentile: 90,
      },
      {
        repoId: refRepoId,
        filePath: 'src/middleware/ratelimit.ts',
        pagerank: 0.5,
        hotness: 0,
        rank: 0.5,
        percentile: 50,
      },
    ]);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  describe('getReverseDependents', () => {
    it('depth 1 returns only direct importers, sorted, excluding the input', async () => {
      const got = await repo.getReverseDependents(graphRepoId, ['src/a.ts'], 1);
      expect(got).toEqual(['src/b.ts', 'src/x.ts']);
    });

    it('depth 2 adds the next level and stops there', async () => {
      const got = await repo.getReverseDependents(graphRepoId, ['src/a.ts'], 2);
      // b, x at level 1; c (imports b) and y (imports x) at level 2.
      expect(got).toEqual(['src/b.ts', 'src/c.ts', 'src/x.ts', 'src/y.ts']);
      // d.ts imports c.ts — three hops away, so the bound must exclude it.
      expect(got).not.toContain('src/d.ts');
    });

    it('is cycle-safe: x ↔ y terminates and never repeats a file', async () => {
      const got = await repo.getReverseDependents(graphRepoId, ['src/a.ts'], 5);
      expect(new Set(got).size).toBe(got.length);
      // Depth 3 reaches d; the x/y cycle contributes nothing new after level 2.
      expect(got).toEqual(['src/b.ts', 'src/c.ts', 'src/d.ts', 'src/x.ts', 'src/y.ts']);
    });

    it('never returns an input file, even when inputs import each other', async () => {
      const got = await repo.getReverseDependents(graphRepoId, ['src/x.ts', 'src/y.ts'], 2);
      expect(got).not.toContain('src/x.ts');
      expect(got).not.toContain('src/y.ts');
    });

    it('defaults to the BLAST_BFS_DEPTH bound when no depth is passed', async () => {
      const got = await repo.getReverseDependents(graphRepoId, ['src/a.ts']);
      expect(got).toEqual(['src/b.ts', 'src/c.ts', 'src/x.ts', 'src/y.ts']);
    });

    it('stays inside its repo — another repo importing the same path is invisible', async () => {
      const got = await repo.getReverseDependents(graphRepoId, ['src/a.ts'], 2);
      expect(got).not.toContain('src/leak.ts');
    });

    it('returns [] for no input files without querying', async () => {
      expect(await repo.getReverseDependents(graphRepoId, [])).toEqual([]);
    });
  });

  describe('getResolvedCallers', () => {
    it('drops the self-file reference and keeps the cross-file caller', async () => {
      const rows = await repo.getResolvedCallers(
        refRepoId,
        ['src/middleware/ratelimit.ts'],
        ['rateLimit'],
      );
      expect(rows.map((r) => r.fromPath)).toEqual(['src/api/index.ts']);
    });
  });
});
