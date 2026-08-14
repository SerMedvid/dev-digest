import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type {
  ContextAttachmentsView,
  ContextDocList,
  ContextPreview,
} from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { approxTokens } from '../src/adapters/tokenizer/index.js';
import { CloneReader } from '../src/adapters/clone-reader/index.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { schema } from '../src/db/schema.js';
import type { Db } from '../src/db/client.js';
import { ProjectContextRepository } from '../src/modules/project-context/repository.js';
import { CloneWalker } from '../src/modules/project-context/walk.js';
import {
  DEFAULT_CONTEXT_ROOTS,
  MAX_DOCS_PER_RUN,
  MAX_DOC_BYTES,
  SETTINGS_ROOTS_KEY,
} from '../src/modules/project-context/constants.js';
import {
  agentToken,
  estimateTokensFromBytes,
  fingerprintAttachments,
} from '../src/modules/project-context/helpers.js';
import type {
  AttachmentRecord,
  ReplaceOutcome,
} from '../src/modules/project-context/domain.js';

/**
 * Project context, DB-backed. **One** outer `describe` owns the testcontainer:
 * vitest fires an `afterAll` registered inside a `describe` as soon as that
 * block's tests finish, so two sibling top-level blocks sharing a module-level
 * handle hand the second one a closed pool (`server/INSIGHTS.md`, 2026-08-10).
 * Task 8 adds the route cases as another nested `describe` under this same
 * block — do not promote anything here to the top level.
 *
 * The seeded demo repo has `clone_path: null` (`src/db/seed.ts`), so a clone
 * reading assertion green-passes on the `no_clone` early return
 * (`server/INSIGHTS.md`, 2026-08-03). The fixture therefore `mkdtemp`s a real
 * clone with **nested** documents, points a repo row at it, and the first case
 * asserts discovery over it is non-empty before anything else is believed.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context] Docker not available — skipping integration tests.');
}

/** A document larger than the read cap: attaching it must still succeed (AC-11). */
const BIG_DOC = 'docs/big.md';
const BIG_DOC_BYTES = 3 * 1024 * 1024;

/** Every document in the read-cap fixture clone is this, so all sizes are equal. */
const CAP_DOC_TEXT = '12345678';
const CAP_DOC_BYTES = CAP_DOC_TEXT.length;

const AGENT_DEFAULTS = {
  provider: 'openai' as const,
  model: 'gpt-4o-mini',
  systemPrompt: 'Review the diff.',
};

/**
 * `[path, order]` pairs sorted by **path**. Never assert paths sorted by
 * `order`: `Array#sort` is stable, so that comparison passes even when every
 * `order` is identical and the stored column takes no part in it
 * (`server/INSIGHTS.md`, 2026-08-03).
 */
function pairsByPath(rows: AttachmentRecord[]): [string, number][] {
  return rows
    .map((row): [string, number] => [row.path, row.order])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

d('project-context (DB-backed)', () => {
  let pg: PgFixture;
  let db: Db;
  let workspaceId: string;
  /** The seeded user — the only real `settings.user_id` this file can store. */
  let seededUserId: string;
  let otherWorkspaceId: string;
  let cloneDir: string;
  /** The seeded repo, repointed at a real clone. */
  let repoId: string;
  let repo: ProjectContextRepository;

  let seq = 0;
  const nextName = (kind: string): string => `ctx-${kind}-${seq++}`;

  async function newRepo(clonePath: string | null = null, ws?: string): Promise<string> {
    const name = nextName('repo');
    const [row] = await db
      .insert(t.repos)
      .values({
        workspaceId: ws ?? workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        clonePath,
      })
      .returning();
    return row!.id;
  }

  async function newAgent(opts: { ws?: string; enabled?: boolean } = {}) {
    const [row] = await db
      .insert(t.agents)
      .values({
        workspaceId: opts.ws ?? workspaceId,
        name: nextName('agent'),
        ...AGENT_DEFAULTS,
        enabled: opts.enabled ?? true,
      })
      .returning();
    return row!;
  }

  async function newSkill(opts: { ws?: string; enabled?: boolean } = {}) {
    const [row] = await db
      .insert(t.skills)
      .values({
        workspaceId: opts.ws ?? workspaceId,
        name: nextName('skill'),
        description: 'a skill',
        type: 'rubric',
        source: 'manual',
        body: '# rule',
        enabled: opts.enabled ?? true,
      })
      .returning();
    return row!;
  }

  async function link(agentId: string, skillId: string, order: number): Promise<void> {
    await db.insert(t.agentSkills).values({ agentId, skillId, order });
  }

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    ({ workspaceId, userId: seededUserId } = await seed(db));

    const [other] = await db.insert(t.workspaces).values({ name: 'other-tenant' }).returning();
    otherWorkspaceId = other!.id;

    // A real clone, with nested documents — a flat fixture cannot surface a
    // separator bug (AC-2).
    cloneDir = await mkdtemp(join(tmpdir(), 'devdigest-project-context-'));
    await mkdir(join(cloneDir, 'specs'), { recursive: true });
    await mkdir(join(cloneDir, 'docs', 'deep'), { recursive: true });
    await mkdir(join(cloneDir, 'insights'), { recursive: true });
    await writeFile(join(cloneDir, 'specs', 'a.md'), '# a\n', 'utf8');
    await writeFile(join(cloneDir, 'docs', 'b.md'), '# b\n', 'utf8');
    await writeFile(join(cloneDir, 'docs', 'deep', 'e.md'), '# e\n', 'utf8');
    await writeFile(join(cloneDir, 'insights', 'c.md'), '# c\n', 'utf8');
    await writeFile(join(cloneDir, 'docs', 'big.md'), Buffer.alloc(BIG_DOC_BYTES, 0x61));

    const [seededRepo] = await db
      .update(t.repos)
      .set({ clonePath: cloneDir })
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')))
      .returning();
    repoId = seededRepo!.id;

    repo = new ProjectContextRepository(db);
  });

  afterAll(async () => {
    await pg?.stop();
    if (cloneDir) await rm(cloneDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------- the fixture

  it('the fixture clone is real: discovery finds the nested documents (AC-7 row read)', async () => {
    const { docs } = await new CloneWalker().walk(cloneDir, [...DEFAULT_CONTEXT_ROOTS]);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.map((doc) => doc.path)).toEqual(
      expect.arrayContaining(['specs/a.md', 'docs/b.md', 'docs/deep/e.md', 'insights/c.md', BIG_DOC]),
    );
    expect(docs.find((doc) => doc.path === BIG_DOC)!.sizeBytes).toBeGreaterThan(MAX_DOC_BYTES);

    const ref = await repo.getRepo(workspaceId, repoId);
    expect(ref).toEqual({ id: repoId, fullName: 'acme/payments-api', clonePath: cloneDir });
  });

  // ------------------------------------------------------------- attachments

  describe('attachments', () => {
    it('attaches a 3 MB document — the cap binds at read time, not attach time (AC-11)', async () => {
      const agent = await newAgent();
      const outcome = await repo.replaceAgentAttachments(workspaceId, agent.id, repoId, [BIG_DOC]);
      expect(outcome).toEqual({ status: 'written', token: agentToken(agent.version + 1) });
      expect(await repo.attachmentsFor('agent', agent.id, repoId)).toEqual([
        { path: BIG_DOC, repoId, order: 0 },
      ]);
    });

    it('replace writes order = index, and re-reading returns the stored order (AC-10)', async () => {
      const agent = await newAgent();
      const paths = ['specs/a.md', 'docs/deep/e.md', 'insights/c.md', 'docs/b.md'];
      await repo.replaceAgentAttachments(workspaceId, agent.id, repoId, paths);

      const rows = await repo.attachmentsFor('agent', agent.id, repoId);
      expect(rows.map((row) => row.path)).toEqual(paths);
      expect(pairsByPath(rows)).toEqual([
        ['docs/b.md', 3],
        ['docs/deep/e.md', 1],
        ['insights/c.md', 2],
        ['specs/a.md', 0],
      ]);

      // A second replace is a replace: the dropped rows are gone and the kept
      // one is renumbered from zero.
      await repo.replaceAgentAttachments(workspaceId, agent.id, repoId, ['docs/b.md']);
      expect(pairsByPath(await repo.attachmentsFor('agent', agent.id, repoId))).toEqual([
        ['docs/b.md', 0],
      ]);
    });

    it('a skill carries its own ordered set (AC-10)', async () => {
      const skill = await newSkill();
      await repo.replaceSkillAttachments(workspaceId, skill.id, repoId, [
        'insights/c.md',
        'specs/a.md',
      ]);
      const rows = await repo.attachmentsFor('skill', skill.id, repoId);
      expect(rows.map((row) => row.path)).toEqual(['insights/c.md', 'specs/a.md']);
      expect(pairsByPath(rows)).toEqual([
        ['insights/c.md', 0],
        ['specs/a.md', 1],
      ]);
      expect(await repo.skillOwner(workspaceId, skill.id)).toEqual({
        id: skill.id,
        name: skill.name,
      });
    });

    it('one replace bumps agents.version by exactly 1 and writes one snapshot (AC-12)', async () => {
      const agent = await newAgent();
      const skill = await newSkill();
      await link(agent.id, skill.id, 0);
      const paths = ['specs/a.md', 'docs/b.md'];

      const outcome = await repo.replaceAgentAttachments(workspaceId, agent.id, repoId, paths);
      expect(outcome).toEqual({ status: 'written', token: agentToken(agent.version + 1) });
      const version = agent.version + 1;

      const [row] = await db.select().from(t.agents).where(eq(t.agents.id, agent.id));
      expect(row!.version).toBe(agent.version + 1);

      const snapshots = await db
        .select()
        .from(t.agentVersions)
        .where(eq(t.agentVersions.agentId, agent.id));
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]!.version).toBe(version);

      const config = snapshots[0]!.configJson as Record<string, unknown>;
      expect(config.context_paths).toEqual(paths);
      expect(config).toMatchObject({
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
        strategy: 'single-pass',
        ci_fail_on: 'critical',
        repo_intel: true,
        skills: [skill.id],
      });
      expect(Object.keys(config)).toContain('output_schema');
    });

    /**
     * AC-13. Both orderings, three iterations each, inside one `it`, with the
     * ordering and iteration in every message: a single-ordering single-shot
     * race test goes green against the broken code roughly 3 times in 8
     * (`server/INSIGHTS.md`, 2026-08-03). The falsifier that needs the
     * transaction (not just the SQL-side bump) is the last pair of assertions:
     * an unlocked delete/insert interleaves into a set that is neither call's.
     */
    it('two concurrent replaces each produce their own version and snapshot (AC-13)', async () => {
      const raceRepoId = await newRepo(cloneDir);
      const pathsA = ['specs/a.md', 'docs/b.md'];
      const pathsB = ['insights/c.md'];

      for (const ordering of ['A-then-B', 'B-then-A'] as const) {
        for (let iteration = 1; iteration <= 3; iteration += 1) {
          const label = `ordering=${ordering} iteration=${iteration}`;
          const agent = await newAgent();
          const start = agent.version;
          const callA = (): Promise<ReplaceOutcome> =>
            repo.replaceAgentAttachments(workspaceId, agent.id, raceRepoId, pathsA);
          const callB = (): Promise<ReplaceOutcome> =>
            repo.replaceAgentAttachments(workspaceId, agent.id, raceRepoId, pathsB);

          const returned =
            ordering === 'A-then-B'
              ? await Promise.all([callA(), callB()])
              : await Promise.all([callB(), callA()]);

          // Neither sends an `expectedVersion`, so neither is refused: this case
          // is about the version/snapshot pair, and the compare-and-set has its
          // own case below.
          expect(
            returned.map((outcome) => outcome.status),
            `${label}: both calls found the agent and wrote`,
          ).toEqual(['written', 'written']);
          expect(
            returned
              .map((outcome) => (outcome.status === 'written' ? Number(outcome.token) : NaN))
              .sort((x, y) => x - y),
            `${label}: distinct versions`,
          ).toEqual([start + 1, start + 2]);

          const [row] = await db.select().from(t.agents).where(eq(t.agents.id, agent.id));
          expect(row!.version, `${label}: agents.version`).toBe(start + 2);

          const snapshots = await db
            .select()
            .from(t.agentVersions)
            .where(eq(t.agentVersions.agentId, agent.id))
            .orderBy(asc(t.agentVersions.version));
          expect(
            snapshots.map((snapshot) => snapshot.version),
            `${label}: one snapshot per version`,
          ).toEqual([start + 1, start + 2]);

          const stored = (await repo.attachmentsFor('agent', agent.id, raceRepoId)).map(
            (record) => record.path,
          );
          expect(
            [pathsA, pathsB],
            `${label}: stored set ${JSON.stringify(stored)} is a mix of both replaces`,
          ).toContainEqual(stored);
          const lastConfig = snapshots.at(-1)!.configJson as { context_paths: string[] };
          expect(
            lastConfig.context_paths,
            `${label}: the winning snapshot describes what is stored`,
          ).toEqual(stored);
        }
      }
    });

    /**
     * LU — the lost update, at the layer that has it.
     *
     * The lock serialises the two transactions but says nothing about the fact
     * that each body is a **whole replacement** computed from a snapshot read
     * earlier. Tick A (`[A]`), then tick B (`[A,B]`): if B's transaction takes the
     * lock first, A's then deletes and re-inserts `[A]` over it and B is gone —
     * durably, since the replace snapshots `agent_versions` too. Both replaces
     * here carry the **same** starting token, which is exactly what two
     * overlapping toggles from one editor do.
     *
     * Both orderings, three iterations each, with the ordering and iteration in
     * every message: a single-shot single-ordering race test goes green against
     * the broken code roughly 3 times in 8 (`server/INSIGHTS.md`, 2026-08-03).
     *
     * The falsifier is the pair of assertions at the end: without the
     * compare-and-set both calls report `written`, and the stored set is whichever
     * transaction committed last — so the surviving set can be the one whose call
     * was *issued* first, with the other's document silently deleted.
     */
    it('refuses the second of two overlapping agent replaces on a stale token (LU)', async () => {
      const raceRepoId = await newRepo(cloneDir);
      const pathsA = ['specs/a.md'];
      const pathsB = ['specs/a.md', 'docs/b.md'];

      for (const ordering of ['A-then-B', 'B-then-A'] as const) {
        for (let iteration = 1; iteration <= 3; iteration += 1) {
          const label = `ordering=${ordering} iteration=${iteration}`;
          const agent = await newAgent();
          // What both callers believe they are replacing: the state before either
          // of them ran.
          const believed = agentToken(agent.version);
          const callA = (): Promise<ReplaceOutcome> =>
            repo.replaceAgentAttachments(workspaceId, agent.id, raceRepoId, pathsA, believed);
          const callB = (): Promise<ReplaceOutcome> =>
            repo.replaceAgentAttachments(workspaceId, agent.id, raceRepoId, pathsB, believed);

          const returned =
            ordering === 'A-then-B'
              ? await Promise.all([callA(), callB()])
              : await Promise.all([callB(), callA()]);

          const statuses = returned.map((outcome) => outcome.status);
          expect(
            [...statuses].sort(),
            `${label}: exactly one replace is applied, the other is stale`,
          ).toEqual(['stale', 'written']);

          const written = returned.findIndex((outcome) => outcome.status === 'written');
          const sent = ordering === 'A-then-B' ? [pathsA, pathsB] : [pathsB, pathsA];
          const stored = (await repo.attachmentsFor('agent', agent.id, raceRepoId)).map(
            (record) => record.path,
          );
          expect(stored, `${label}: the stored set is the accepted replace's body`).toEqual(
            sent[written],
          );

          // The refused body was not applied *at all*: no rows, and no version or
          // snapshot burned on it either.
          const [row] = await db.select().from(t.agents).where(eq(t.agents.id, agent.id));
          expect(row!.version, `${label}: one bump, not two`).toBe(agent.version + 1);
          const snapshots = await db
            .select()
            .from(t.agentVersions)
            .where(eq(t.agentVersions.agentId, agent.id));
          expect(snapshots, `${label}: one snapshot, for the accepted replace`).toHaveLength(1);
          expect(
            (snapshots[0]!.configJson as { context_paths: string[] }).context_paths,
            `${label}: the snapshot describes what is stored`,
          ).toEqual(stored);

          // The stale caller is told what the state actually is, so it can refetch
          // rather than guess.
          const stale = returned.find((outcome) => outcome.status === 'stale');
          expect(stale, `${label}: the stale outcome carries the current token`).toEqual({
            status: 'stale',
            token: agentToken(agent.version + 1),
          });
        }
      }
    });

    /**
     * The same race for a skill. A skill has no counter this write may bump —
     * `skills.version` tracks its *body* and an attachment replace deliberately
     * leaves it alone, so it cannot detect a concurrent attachment replace at all
     * — so the token is a fingerprint of the stored set, read under the same
     * `FOR UPDATE` lock. The last assertion is what makes that choice mean
     * something: `skills.version` is unmoved throughout, which is precisely why it
     * could not have served as the token.
     */
    it('refuses the second of two overlapping skill replaces on a stale token (LU)', async () => {
      const raceRepoId = await newRepo(cloneDir);
      const pathsA = ['specs/a.md'];
      const pathsB = ['specs/a.md', 'docs/b.md'];

      for (const ordering of ['A-then-B', 'B-then-A'] as const) {
        for (let iteration = 1; iteration <= 3; iteration += 1) {
          const label = `ordering=${ordering} iteration=${iteration}`;
          const skill = await newSkill();
          const believed = fingerprintAttachments([]);
          const callA = (): Promise<ReplaceOutcome> =>
            repo.replaceSkillAttachments(workspaceId, skill.id, raceRepoId, pathsA, believed);
          const callB = (): Promise<ReplaceOutcome> =>
            repo.replaceSkillAttachments(workspaceId, skill.id, raceRepoId, pathsB, believed);

          const returned =
            ordering === 'A-then-B'
              ? await Promise.all([callA(), callB()])
              : await Promise.all([callB(), callA()]);

          expect(
            returned.map((outcome) => outcome.status).sort(),
            `${label}: exactly one replace is applied, the other is stale`,
          ).toEqual(['stale', 'written']);

          const written = returned.findIndex((outcome) => outcome.status === 'written');
          const sent = ordering === 'A-then-B' ? [pathsA, pathsB] : [pathsB, pathsA];
          const stored = (await repo.attachmentsFor('skill', skill.id, raceRepoId)).map(
            (record) => record.path,
          );
          expect(stored, `${label}: the stored set is the accepted replace's body`).toEqual(
            sent[written],
          );
          expect(
            returned[written],
            `${label}: the accepted replace returns the new set's token`,
          ).toEqual({ status: 'written', token: fingerprintAttachments(stored) });

          const [row] = await db.select().from(t.skills).where(eq(t.skills.id, skill.id));
          expect(
            row!.version,
            `${label}: skills.version never moves, so it cannot be the token`,
          ).toBe(skill.version);
        }
      }
    });

    /** The token an editor was handed is the token its next replace is allowed to send. */
    it('accepts the token the view just handed out, for either owner (LU)', async () => {
      const roundTripRepoId = await newRepo(cloneDir);
      const agent = await newAgent();
      const skill = await newSkill();

      const first = await repo.replaceAgentAttachments(
        workspaceId,
        agent.id,
        roundTripRepoId,
        ['specs/a.md'],
        agentToken(agent.version),
      );
      expect(first.status).toBe('written');
      const bundle = await repo.agentBundle(workspaceId, agent.id, roundTripRepoId);
      expect(agentToken(bundle!.version)).toBe(
        first.status === 'written' ? first.token : undefined,
      );
      expect(
        await repo.replaceAgentAttachments(
          workspaceId,
          agent.id,
          roundTripRepoId,
          ['docs/b.md'],
          agentToken(bundle!.version),
        ),
      ).toMatchObject({ status: 'written' });

      const wrote = await repo.replaceSkillAttachments(
        workspaceId,
        skill.id,
        roundTripRepoId,
        ['specs/a.md'],
        fingerprintAttachments([]),
      );
      expect(wrote.status).toBe('written');
      const stored = await repo.attachmentsFor('skill', skill.id, roundTripRepoId);
      expect(
        await repo.replaceSkillAttachments(
          workspaceId,
          skill.id,
          roundTripRepoId,
          ['docs/b.md'],
          fingerprintAttachments(stored.map((record) => record.path)),
        ),
      ).toMatchObject({ status: 'written' });
    });

    it('another workspace cannot read or write an agent, skill or repo (AC-14)', async () => {
      const foreignRepoId = await newRepo(null, otherWorkspaceId);
      const foreignAgent = await newAgent({ ws: otherWorkspaceId });
      const foreignSkill = await newSkill({ ws: otherWorkspaceId });

      expect(await repo.getRepo(workspaceId, foreignRepoId)).toBeUndefined();
      expect(await repo.agentBundle(workspaceId, foreignAgent.id, foreignRepoId)).toBeUndefined();
      expect(await repo.skillOwner(workspaceId, foreignSkill.id)).toBeUndefined();

      // Neither replace writes a row, and neither moves the agent's version.
      expect(
        await repo.replaceAgentAttachments(workspaceId, foreignAgent.id, foreignRepoId, [
          'specs/a.md',
        ]),
      ).toEqual({ status: 'not_found' });
      expect(
        await repo.replaceSkillAttachments(workspaceId, foreignSkill.id, foreignRepoId, [
          'specs/a.md',
        ]),
      ).toEqual({ status: 'not_found' });
      expect(await repo.attachmentsFor('agent', foreignAgent.id, null)).toEqual([]);
      expect(await repo.attachmentsFor('skill', foreignSkill.id, null)).toEqual([]);
      const [row] = await db.select().from(t.agents).where(eq(t.agents.id, foreignAgent.id));
      expect(row!.version).toBe(foreignAgent.version);
      expect(
        await db.select().from(t.agentVersions).where(eq(t.agentVersions.agentId, foreignAgent.id)),
      ).toEqual([]);

      // The owning workspace still sees its own rows.
      expect(await repo.getRepo(otherWorkspaceId, foreignRepoId)).toMatchObject({
        id: foreignRepoId,
      });
      expect(
        await repo.agentBundle(otherWorkspaceId, foreignAgent.id, foreignRepoId),
      ).toEqual({ direct: [], skills: [], version: foreignAgent.version });
      expect((await repo.usageCounts(workspaceId, foreignRepoId)).size).toBe(0);
    });

    it('deleting the repo, or the skill, deletes its attachments (AC-15)', async () => {
      const doomedRepoId = await newRepo(cloneDir);
      const agent = await newAgent();
      const skill = await newSkill();
      await repo.replaceAgentAttachments(workspaceId, agent.id, doomedRepoId, ['specs/a.md']);
      await repo.replaceSkillAttachments(workspaceId, skill.id, doomedRepoId, ['docs/b.md']);
      await repo.replaceSkillAttachments(workspaceId, skill.id, repoId, ['insights/c.md']);
      expect(await repo.attachmentsFor('skill', skill.id, null)).toHaveLength(2);

      await db.delete(t.repos).where(eq(t.repos.id, doomedRepoId));
      expect(
        await db
          .select()
          .from(t.contextAttachments)
          .where(eq(t.contextAttachments.repoId, doomedRepoId)),
      ).toEqual([]);
      // The other repo's rows for the same skill survive.
      expect(await repo.attachmentsFor('skill', skill.id, null)).toHaveLength(1);

      await db.delete(t.skills).where(eq(t.skills.id, skill.id));
      expect(await repo.attachmentsFor('skill', skill.id, null)).toEqual([]);
    });
  });

  // ------------------------------------------------------------ usage counts

  describe('usageCounts', () => {
    /** Three agents reached through one enabled skill carrying two documents. */
    const P1 = 'specs/p1.md';
    const P2 = 'specs/p2.md';
    /** Direct attachment on a DISABLED agent — still counted (AC-57). */
    const P3 = 'docs/p3.md';
    /** Reachable only through a DISABLED skill — counted for nobody (AC-73). */
    const P4 = 'docs/p4.md';
    /** Direct AND inherited on the same agent — one agent, not two (edge 20). */
    const P5 = 'insights/p5.md';

    let usageRepoId: string;
    let emptyRepoId: string;

    beforeAll(async () => {
      usageRepoId = await newRepo(cloneDir);
      emptyRepoId = await newRepo(cloneDir);

      const shared = await newSkill();
      await repo.replaceSkillAttachments(workspaceId, shared.id, usageRepoId, [P1, P2]);
      const readers = [await newAgent(), await newAgent(), await newAgent()];
      for (const agent of readers) await link(agent.id, shared.id, 0);
      // The first reader also attaches P1 directly: still one agent (AC-57).
      await repo.replaceAgentAttachments(workspaceId, readers[0]!.id, usageRepoId, [P1]);

      const disabledAgent = await newAgent({ enabled: false });
      await repo.replaceAgentAttachments(workspaceId, disabledAgent.id, usageRepoId, [P3]);

      const disabledSkill = await newSkill({ enabled: false });
      await repo.replaceSkillAttachments(workspaceId, disabledSkill.id, usageRepoId, [P4]);
      const throughDisabled = await newAgent();
      await link(throughDisabled.id, disabledSkill.id, 0);

      const bothWays = await newAgent();
      const bothWaysSkill = await newSkill();
      await link(bothWays.id, bothWaysSkill.id, 0);
      await repo.replaceSkillAttachments(workspaceId, bothWaysSkill.id, usageRepoId, [P5]);
      await repo.replaceAgentAttachments(workspaceId, bothWays.id, usageRepoId, [P5]);
    });

    it('counts DISTINCT agents, ignores agents.enabled, honours skills.enabled', async () => {
      const counts = await repo.usageCounts(workspaceId, usageRepoId);

      // One skill, two documents, three agents → 3 each, never 6 (edge 19).
      expect(counts.get(P1)).toBe(3);
      expect(counts.get(P2)).toBe(3);
      // A disabled AGENT still counts — the number describes configuration (AC-57).
      expect(counts.get(P3)).toBe(1);
      // A disabled SKILL injects nothing, so it carries no reach (AC-73).
      expect(counts.get(P4)).toBe(0);
      // Direct + inherited on one agent is one agent (edge 20).
      expect(counts.get(P5)).toBe(1);
      expect([...counts.keys()].sort()).toEqual([P3, P4, P5, P1, P2].sort());
    });

    it('is scoped to the workspace and the repository (AC-14)', async () => {
      expect((await repo.usageCounts(workspaceId, emptyRepoId)).size).toBe(0);
      expect((await repo.usageCounts(otherWorkspaceId, usageRepoId)).size).toBe(0);
    });

    it('produces the whole map in ONE round trip (NFR §Performance)', async () => {
      const oneQueryRepoId = await newRepo(cloneDir);
      const agent = await newAgent();
      const skill = await newSkill();
      await link(agent.id, skill.id, 0);
      await repo.replaceAgentAttachments(workspaceId, agent.id, oneQueryRepoId, [P1, P2]);
      await repo.replaceSkillAttachments(workspaceId, skill.id, oneQueryRepoId, [P3]);

      // Every statement drizzle sends is logged, so this counts real round
      // trips rather than builder calls.
      const sent: string[] = [];
      const countingDb = drizzle(pg.handle.sql, {
        schema,
        logger: { logQuery: (query) => void sent.push(query) },
      });
      const counting = new ProjectContextRepository(countingDb);

      const counts = await counting.usageCounts(workspaceId, oneQueryRepoId);

      expect(sent, `expected one query, got:\n${sent.join('\n')}`).toHaveLength(1);
      expect(counts.size).toBe(3);
      expect([counts.get(P1), counts.get(P2), counts.get(P3)]).toEqual([1, 1, 1]);
    });
  });

  // ------------------------------------------------------------------- roots

  describe('roots', () => {
    it('defaults with no row, the stored value with a valid one, defaults for a bad one (AC-3, AC-77)', async () => {
      await db
        .delete(t.settings)
        .where(
          and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, SETTINGS_ROOTS_KEY)),
        );
      expect(await repo.roots(workspaceId)).toEqual(['specs', 'docs', 'insights']);

      const [row] = await db
        .insert(t.settings)
        .values({ workspaceId, userId: null, key: SETTINGS_ROOTS_KEY, value: ['guides', 'rfcs'] })
        .returning();
      expect(await repo.roots(workspaceId)).toEqual(['guides', 'rfcs']);

      // A stored value that fails the contract degrades to the defaults rather
      // than widening the walk (AC-77).
      await db.update(t.settings).set({ value: ['../..'] }).where(eq(t.settings.id, row!.id));
      expect(await repo.roots(workspaceId)).toEqual(['specs', 'docs', 'insights']);

      // Another workspace's row is not visible (AC-14).
      expect(await repo.roots(otherWorkspaceId)).toEqual(['specs', 'docs', 'insights']);
    });

    /**
     * C7. `settings_ws_user_key_uq` is not `NULLS NOT DISTINCT`, so a
     * workspace-level row (`user_id IS NULL`) and a user-level row can hold the
     * same key at the same time — reachable today, with two seeded users. The
     * select filters `workspaceId + key` and takes the last row, so without an
     * `ORDER BY` "last" is whatever the plan emitted, and the document list
     * flickers between two root sets on refresh.
     *
     * Two assertions, because neither alone is enough. The behavioural half
     * reads three times across two rewrites — a plain `UPDATE` writes a new
     * tuple version at the end of the heap, so a sequential scan hands the rows
     * back in the opposite order afterwards — and names the winner, so a
     * tie-break that silently flips is a failure too. But on two rows the
     * planner may serve this from `settings_ws_user_key_uq`, whose own order
     * happens to match, and then the broken code passes: removing the
     * `ORDER BY` was measured to survive that half. So the emitted SQL is
     * asserted as well, through drizzle's logger — the same technique the
     * one-round-trip case above uses. The guarantee is that the *database* is
     * asked for an order, not that today's plan happens to supply one.
     */
    it('resolves the same row on every read when a workspace and a user row coexist (C7)', async () => {
      await db
        .delete(t.settings)
        .where(
          and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, SETTINGS_ROOTS_KEY)),
        );

      const [workspaceRow] = await db
        .insert(t.settings)
        .values({ workspaceId, userId: null, key: SETTINGS_ROOTS_KEY, value: ['ws-root'] })
        .returning();
      const [userRow] = await db
        .insert(t.settings)
        .values({
          workspaceId,
          userId: seededUserId,
          key: SETTINGS_ROOTS_KEY,
          value: ['user-root'],
        })
        .returning();
      // The premise: the table really does permit the pair.
      const stored = await db
        .select()
        .from(t.settings)
        .where(
          and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, SETTINGS_ROOTS_KEY)),
        );
      expect(stored, 'both rows coexist for one key').toHaveLength(2);

      const first = await repo.roots(workspaceId);
      // Rewrite the user row: its live tuple moves to the end of the heap.
      await db
        .update(t.settings)
        .set({ value: ['user-root'] })
        .where(eq(t.settings.id, userRow!.id));
      const second = await repo.roots(workspaceId);
      // Now the workspace row's, so the physical order is the other way round.
      await db
        .update(t.settings)
        .set({ value: ['ws-root'] })
        .where(eq(t.settings.id, workspaceRow!.id));
      const third = await repo.roots(workspaceId);

      expect([second, third], 'the answer does not depend on physical row order').toEqual([
        first,
        first,
      ]);
      // Ascending `user_id` puts NULL last and the last row wins, so the
      // workspace-level row is the documented winner. WHICH of the two ought to
      // win is a recorded open question in the spec; that it is always the same
      // one is not.
      expect(first).toEqual(['ws-root']);

      // The select really asks for an order — not "the plan happened to return
      // one". Every statement drizzle sends is logged, so this reads the SQL.
      const sent: string[] = [];
      const loggingDb = drizzle(pg.handle.sql, {
        schema,
        logger: { logQuery: (query) => void sent.push(query) },
      });
      await new ProjectContextRepository(loggingDb).roots(workspaceId);
      expect(sent, `expected one query, got:\n${sent.join('\n')}`).toHaveLength(1);
      expect(sent[0]!.toLowerCase()).toContain('order by');
      expect(sent[0]!.toLowerCase()).toContain('user_id');

      await db
        .delete(t.settings)
        .where(
          and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, SETTINGS_ROOTS_KEY)),
        );
    });
  });

  // ---------------------------------------------------- run-time resolution

  describe('resolveForRun / agentBundle', () => {
    it('omits attachments whose repo_id differs from the run repo (AC-19)', async () => {
      const otherRepoId = await newRepo(cloneDir);
      const agent = await newAgent();
      const skill = await newSkill();
      await link(agent.id, skill.id, 0);

      await repo.replaceAgentAttachments(workspaceId, agent.id, repoId, ['specs/a.md']);
      await repo.replaceAgentAttachments(workspaceId, agent.id, otherRepoId, ['docs/b.md']);
      await repo.replaceSkillAttachments(workspaceId, skill.id, repoId, ['insights/c.md']);
      await repo.replaceSkillAttachments(workspaceId, skill.id, otherRepoId, ['docs/deep/e.md']);

      // Both repos really do hold rows, so the filter below is doing work.
      expect(await repo.attachmentsFor('agent', agent.id, null)).toHaveLength(2);

      const input = await repo.resolveForRun(agent.id, repoId);
      expect(input.direct).toEqual([{ path: 'specs/a.md', repoId, order: 0 }]);
      expect(input.skills).toHaveLength(1);
      expect(input.skills[0]).toMatchObject({ id: skill.id, name: skill.name, enabled: true });
      expect(input.skills[0]!.attachments).toEqual([{ path: 'insights/c.md', repoId, order: 0 }]);
    });

    it('agentBundle preserves link order and reports each skill enabled flag', async () => {
      const bundleRepoId = await newRepo(cloneDir);
      const agent = await newAgent();
      const first = await newSkill();
      const second = await newSkill({ enabled: false });
      // Linked in the opposite order to their creation, so link order is not
      // insertion order and not alphabetical.
      await link(agent.id, second.id, 0);
      await link(agent.id, first.id, 1);
      await repo.replaceSkillAttachments(workspaceId, first.id, bundleRepoId, ['specs/a.md']);
      await repo.replaceSkillAttachments(workspaceId, second.id, bundleRepoId, ['docs/b.md']);
      await repo.replaceAgentAttachments(workspaceId, agent.id, bundleRepoId, ['insights/c.md']);

      const bundle = await repo.agentBundle(workspaceId, agent.id, bundleRepoId);
      expect(bundle!.direct).toEqual([{ path: 'insights/c.md', repoId: bundleRepoId, order: 0 }]);
      expect(bundle!.skills.map((skill) => [skill.id, skill.enabled])).toEqual([
        [second.id, false],
        [first.id, true],
      ]);
      expect(bundle!.skills[0]!.attachments.map((record) => record.path)).toEqual(['docs/b.md']);
      expect(bundle!.skills[1]!.attachments.map((record) => record.path)).toEqual(['specs/a.md']);
    });
  });

  // ------------------------------------------------------------------ routes
  /**
   * The HTTP surface, through the real `buildApp` — so the container getters,
   * the static module registration and the route schemas are all exercised
   * rather than described. Nested inside the outer block on purpose: a sibling
   * top-level `describe` would be handed a pool this file's `afterAll` has
   * already closed (`server/INSIGHTS.md`, 2026-08-10).
   *
   * Every case goes through the service (never `repo` directly on the write
   * path) because `attachmentsFor`/`resolveForRun` take no `workspaceId`: a
   * route wired onto them with `req.params` would be an IDOR, and the 404 cases
   * below are what proves it is not.
   *
   * The two settings cases come **last**: they change `context_roots` for the
   * whole workspace, so running them earlier would silently narrow the
   * discovery every case above depends on.
   */
  describe('routes', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;
    /**
     * A repo row with `clone_path: null` — the seeded one would have been it
     * (`server/INSIGHTS.md`, 2026-08-03), but this file's `beforeAll`
     * deliberately points it at the fixture clone, so the null case needs its
     * own row.
     */
    let noCloneRepoId: string;
    /** A second clone holding only `adr/`, so a roots change is observable. */
    let adrCloneDir: string;
    let adrRepoId: string;
    /**
     * A clone with more documents than the per-run cap, all the same size, so the
     * footer's "only what the run reads" figure differs from the whole set's by an
     * exact multiple (R2).
     */
    let capCloneDir: string;
    let capDocs: string[];
    /**
     * How many reads and stats the reader was actually asked for. Shared by every
     * case in this block, so a case that cares must snapshot it before acting
     * rather than expect a zero.
     */
    const readerCalls = { read: 0, stat: 0 };

    beforeAll(async () => {
      app = await buildApp({
        config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
        db,
        overrides: {
          git: new MockGitClient(),
          github: new MockGitHubClient(),
          /**
           * `js-tiktoken`'s BPE is quadratic in the length of a single "word",
           * and `BIG_DOC` is 3 MB of one unbroken run of `a` — of which any
           * reader takes the first 64 KB. Measured on this machine: 4 KB →
           * 1.3 s, 8 KB → 5.3 s, 16 KB → 23 s, so 64 KB is minutes (64 KB of
           * ordinary prose is 11 ms).
           *
           * Neither read endpoint tokenizes any more. The **document list**
           * estimates from `size_bytes`, and since R1 so does the **attachment
           * view**, from the size its `stat` reported — which is what took that
           * stall off the PUT the client fires on every checkbox tick (pinned
           * hermetically in `test/project-context-service.test.ts`).
           *
           * The stub stays because the **run and the skill preview** still count
           * exactly, over the text they inject, and `BIG_DOC` reaches both. It is
           * the adapter's own `ceil(chars/4)` fallback: a real function of the
           * text, so `token_estimate > 0` keeps its meaning and these cases stay
           * about the HTTP wiring.
           */
          tokenizer: { count: (text: string) => approxTokens(text) },
          /**
           * The real reader, counted. R1's claim is behavioural — the attachment
           * view answers from a `stat` and never transfers a byte — and since the
           * estimate is clamped to `MAX_DOC_BYTES` there is no longer any *figure*
           * that distinguishes a stat from a capped read. Both report the file's
           * real `bytes` and both now yield `ceil(MAX_DOC_BYTES / 4)`, so the only
           * honest way to assert "reads nothing" is to count the reads.
           *
           * It delegates in full, so every other case in this block still runs
           * against the genuine confinement.
           */
          cloneReader: {
            open: async (clonePath: string) => {
              const inner = await CloneReader.open(clonePath);
              return {
                read: (relPath: string, maxBytes: number) => {
                  readerCalls.read += 1;
                  return inner.read(relPath, maxBytes);
                },
                stat: (relPath: string) => {
                  readerCalls.stat += 1;
                  return inner.stat(relPath);
                },
              };
            },
          },
        },
      });

      noCloneRepoId = await newRepo(null);

      adrCloneDir = await mkdtemp(join(tmpdir(), 'devdigest-project-context-adr-'));
      await mkdir(join(adrCloneDir, 'adr'), { recursive: true });
      await writeFile(join(adrCloneDir, 'adr', 'decision.md'), '# adr\n', 'utf8');
      adrRepoId = await newRepo(adrCloneDir);

      capCloneDir = await mkdtemp(join(tmpdir(), 'devdigest-project-context-cap-'));
      await mkdir(join(capCloneDir, 'specs'), { recursive: true });
      capDocs = [];
      for (let index = 0; index < MAX_DOCS_PER_RUN + 3; index += 1) {
        const rel = `specs/c${String(index).padStart(2, '0')}.md`;
        await writeFile(join(capCloneDir, 'specs', rel.slice('specs/'.length)), CAP_DOC_TEXT);
        capDocs.push(rel);
      }

      // Start from the packaged defaults: the `roots` block above leaves an
      // invalid row behind on purpose.
      await db
        .delete(t.settings)
        .where(
          and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, SETTINGS_ROOTS_KEY)),
        );
    });

    afterAll(async () => {
      await app?.close();
      if (adrCloneDir) await rm(adrCloneDir, { recursive: true, force: true });
      if (capCloneDir) await rm(capCloneDir, { recursive: true, force: true });
    });

    async function rootsRows() {
      return db
        .select()
        .from(t.settings)
        .where(
          and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, SETTINGS_ROOTS_KEY)),
        );
    }

    it('GET /repos/:repoId/context is 200 + no_clone for a repo with no clone (AC-7)', async () => {
      const res = await app.inject({ method: 'GET', url: `/repos/${noCloneRepoId}/context` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as ContextDocList;
      expect(body.status).toBe('no_clone');
      expect(body.docs).toEqual([]);
      expect(body.omitted).toBe(0);
      expect(body.roots).toEqual([...DEFAULT_CONTEXT_ROOTS]);
    });

    /**
     * AC-7's other arm, and the one the spec verifies here rather than
     * hermetically: `clone_path` is set, but nothing is at the end of it — a
     * repository whose checkout was moved, pruned or never completed.
     *
     * Before the fix the walk swallowed the `readdir` ENOENT and returned
     * `{ docs: [] }`, so the response was `status: 'ok'` with an empty list —
     * byte-identical to a cloned repository holding no documents, which makes
     * the page render AC-41's "no documents under these roots" instead of
     * AC-40's "not cloned". The contrast against the fixture repo below is the
     * point: same shape of empty, two different statuses.
     */
    it('GET /repos/:repoId/context is 200 + no_clone when the clone directory is absent (AC-7)', async () => {
      const goneDir = await mkdtemp(join(tmpdir(), 'devdigest-project-context-gone-'));
      await rm(goneDir, { recursive: true, force: true });
      const goneRepoId = await newRepo(goneDir);

      const res = await app.inject({ method: 'GET', url: `/repos/${goneRepoId}/context` });

      expect(res.statusCode).toBe(200);
      const body = res.json() as ContextDocList;
      expect(body.status).toBe('no_clone');
      expect(body.docs).toEqual([]);
      expect(body.omitted).toBe(0);
      // Nothing about the filesystem leaks in the degraded response.
      expect(res.body).not.toContain(goneDir);

      // An empty-but-present clone is the OTHER state, and must still be `ok`.
      const emptyDir = await mkdtemp(join(tmpdir(), 'devdigest-project-context-empty-'));
      try {
        const emptyRepoId = await newRepo(emptyDir);
        const empty = await app.inject({ method: 'GET', url: `/repos/${emptyRepoId}/context` });
        expect(empty.statusCode).toBe(200);
        const emptyBody = empty.json() as ContextDocList;
        expect(emptyBody.status).toBe('ok');
        expect(emptyBody.docs).toEqual([]);
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it('lists the clone documents with POSIX paths, sizes, tokens and usage (AC-6, AC-9)', async () => {
      const agent = await newAgent();
      await repo.replaceAgentAttachments(workspaceId, agent.id, repoId, ['specs/a.md']);

      const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as ContextDocList;
      expect(body.status).toBe('ok');
      // Non-empty FIRST: every assertion below is meaningless against the
      // `no_clone` early return.
      expect(body.docs.length).toBeGreaterThan(0);
      expect(body.docs.map((doc) => doc.path)).toEqual(
        expect.arrayContaining(['specs/a.md', 'docs/b.md', 'docs/deep/e.md', 'insights/c.md']),
      );
      for (const doc of body.docs) {
        expect(doc.path, 'paths are POSIX on the wire').not.toContain('\\');
        expect(doc.root, 'root is a single segment').not.toContain('/');
      }

      const nested = body.docs.find((doc) => doc.path === 'docs/deep/e.md')!;
      expect(nested.root).toBe('docs');
      expect(nested.size_bytes).toBeGreaterThan(0);
      expect(nested.token_estimate).toBeGreaterThan(0);
      expect(body.docs.find((doc) => doc.path === 'specs/a.md')!.used_by_agents).toBeGreaterThan(0);
    });

    it('serves one document through GET /repos/:repoId/context/doc', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/repos/${repoId}/context/doc`,
        query: { path: 'docs/deep/e.md' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        path: 'docs/deep/e.md',
        content: '# e\n',
        size_bytes: 4,
        truncated: false,
      });
    });

    it('refuses a traversing ?path with the fixed reason and no file content (AC-23)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/repos/${repoId}/context/doc`,
        query: { path: '../../etc/passwd' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatchObject({
        code: 'not_found',
        message: 'path resolves outside the repository',
      });
      // Nothing about the filesystem leaks: no content field, no absolute path,
      // and not the caller's own input echoed back.
      expect(res.json().error.content).toBeUndefined();
      expect(res.body).not.toContain('etc/passwd');
      expect(res.body).not.toContain(cloneDir);
    });

    it('PUT then GET /agents/:agentId/context round-trips the effective set (AC-42)', async () => {
      const agent = await newAgent();
      const put = await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/context`,
        payload: { repo_id: repoId, paths: ['specs/a.md', 'docs/deep/e.md'] },
      });
      expect(put.statusCode).toBe(200);
      const view = put.json() as ContextAttachmentsView;
      expect(view.direct_count).toBe(2);
      expect(view.effective_count).toBe(2);
      expect(view.discovered_count).toBeGreaterThan(0);
      expect(view.token_estimate).toBeGreaterThan(0);
      expect(view.rows.map((row) => row.path)).toEqual(['specs/a.md', 'docs/deep/e.md']);
      expect(view.rows.every((row) => row.source === 'direct' && !row.missing)).toBe(true);

      const get = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/context`,
        query: { repoId },
      });
      expect(get.statusCode).toBe(200);
      expect(get.json()).toEqual(view);
    });

    /**
     * R1 at the HTTP level: the attachment view estimates tokens from the size
     * `stat` reported and reads nothing.
     *
     * `BIG_DOC` is 3 MB of one unbroken run of `a`, which is the shape that made
     * `js-tiktoken`'s BPE quadratic — the reason this suite has to stub the
     * tokenizer at all.
     *
     * The assertion is a **call count**, not a figure. This case originally
     * inferred "no read happened" from the estimate exceeding what a capped read
     * could produce; the clamp on `estimateTokensFromBytes` deliberately removed
     * that difference, so both a stat and a capped read now report the same
     * `bytes` and the same `ceil(MAX_DOC_BYTES / 4)`. An inference whose premise
     * has been legislated away is not a test — count the syscalls instead.
     */
    it('estimates the view tokens from the stat, reading no document (R1)', async () => {
      const agent = await newAgent();
      const before = { ...readerCalls };
      const put = await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/context`,
        payload: { repo_id: repoId, paths: [BIG_DOC] },
      });
      expect(put.statusCode).toBe(200);
      const view = put.json() as ContextAttachmentsView;

      // The whole point: the attached document was stat'd and never read.
      expect(readerCalls.read).toBe(before.read);
      expect(readerCalls.stat).toBeGreaterThan(before.stat);

      expect(view.rows[0]).toMatchObject({
        path: BIG_DOC,
        // `size_bytes` is still the file's real length — the clamp bounds what is
        // *billed*, not what is reported about the document on disk.
        size_bytes: BIG_DOC_BYTES,
        token_estimate: estimateTokensFromBytes(BIG_DOC_BYTES),
        missing: false,
        beyond_read_cap: false,
      });
      expect(view.token_estimate).toBe(estimateTokensFromBytes(BIG_DOC_BYTES));
      // Clamped: 3 MB of attachment bills what the run actually injects, not what
      // the file weighs (`helpers.ts`, `estimateTokensFromBytes`).
      expect(view.token_estimate).toBe(estimateTokensFromBytes(MAX_DOC_BYTES));
    });

    /**
     * R2 at the HTTP level. Past `MAX_DOCS_PER_RUN` the run drops the rest with
     * the `read_cap` reason, so the footer must stop at the cap and every row past
     * it must say so — nothing on screen surfaced the 20-document cap before this
     * flag existed.
     */
    it('marks the rows past the per-run cap and stops counting them (R2)', async () => {
      const capRepoId = await newRepo(capCloneDir);
      const agent = await newAgent();
      const paths = capDocs;
      expect(paths.length).toBeGreaterThan(MAX_DOCS_PER_RUN);

      const put = await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/context`,
        payload: { repo_id: capRepoId, paths },
      });
      expect(put.statusCode).toBe(200);
      const view = put.json() as ContextAttachmentsView;

      expect(view.rows).toHaveLength(paths.length);
      expect(
        view.rows.filter((row) => row.beyond_read_cap === true).map((row) => row.path),
      ).toEqual(paths.slice(MAX_DOCS_PER_RUN));
      // Every document in this clone is the same size, so the footer is exactly
      // the cap's worth — not the whole set's.
      const each = estimateTokensFromBytes(CAP_DOC_BYTES);
      expect(view.token_estimate).toBe(each * MAX_DOCS_PER_RUN);
      expect(view.token_estimate).toBeLessThan(each * paths.length);
    });

    /**
     * LU at the HTTP level: a replace whose `expected_version` has moved is a
     * **409** — not a 404 (the owner exists) and not a 422 (the body is well
     * formed) — and it changes nothing.
     */
    it('409s a PUT whose expected_version is stale, and stores nothing (LU)', async () => {
      const agent = await newAgent();
      const first = await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/context`,
        payload: { repo_id: repoId, paths: ['specs/a.md'] },
      });
      expect(first.statusCode).toBe(200);
      const fresh = (first.json() as ContextAttachmentsView).version;
      expect(fresh).toBe(agentToken(agent.version + 1));

      const stale = await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/context`,
        payload: {
          repo_id: repoId,
          paths: ['docs/b.md'],
          expected_version: agentToken(agent.version),
        },
      });
      expect(stale.statusCode).toBe(409);
      expect((stale.json() as { error: { code: string } }).error.code).toBe('conflict');

      // Nothing changed, and the fresh token still works.
      const get = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/context`,
        query: { repoId },
      });
      const view = get.json() as ContextAttachmentsView;
      expect(view.rows.map((row) => row.path)).toEqual(['specs/a.md']);
      expect(view.version).toBe(fresh);

      const accepted = await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/context`,
        payload: { repo_id: repoId, paths: ['docs/b.md'], expected_version: fresh },
      });
      expect(accepted.statusCode).toBe(200);
      expect((accepted.json() as ContextAttachmentsView).rows.map((row) => row.path)).toEqual([
        'docs/b.md',
      ]);
    });

    it('409s a stale PUT for a skill too, off the set fingerprint (LU)', async () => {
      const skill = await newSkill();
      const first = await app.inject({
        method: 'PUT',
        url: `/skills/${skill.id}/context`,
        payload: { repo_id: repoId, paths: ['specs/a.md'] },
      });
      expect(first.statusCode).toBe(200);
      const fresh = (first.json() as ContextAttachmentsView).version;
      expect(fresh).toBe(fingerprintAttachments(['specs/a.md']));

      const stale = await app.inject({
        method: 'PUT',
        url: `/skills/${skill.id}/context`,
        payload: {
          repo_id: repoId,
          paths: ['docs/b.md'],
          // The empty set — what the editor believed before the first PUT.
          expected_version: fingerprintAttachments([]),
        },
      });
      expect(stale.statusCode).toBe(409);
      expect((stale.json() as { error: { code: string } }).error.code).toBe('conflict');
      const get = await app.inject({
        method: 'GET',
        url: `/skills/${skill.id}/context`,
        query: { repoId },
      });
      expect((get.json() as ContextAttachmentsView).rows.map((row) => row.path)).toEqual([
        'specs/a.md',
      ]);
    });

    /**
     * The lost update as the user produces it: tick A, then tick B before the
     * first response lands, both PUTs computed from the same view. Two
     * `app.inject`s in one `Promise.all` genuinely interleave their reads, which
     * two direct repository calls did not (`server/INSIGHTS.md`, 2026-08-03) —
     * this is the layer that has the race.
     *
     * Both orderings, three iterations, ordering and iteration in every message.
     * Without the compare-and-set both PUTs are 200 and the surviving set is
     * whichever transaction committed last, so `[A]` can silently win over
     * `[A,B]`; with it, exactly one is applied and the other is told.
     */
    it('one of two overlapping PUTs is 409, and the accepted one is what is stored (LU)', async () => {
      const pathsA = ['specs/a.md'];
      const pathsB = ['specs/a.md', 'docs/b.md'];

      for (const ordering of ['A-then-B', 'B-then-A'] as const) {
        for (let iteration = 1; iteration <= 3; iteration += 1) {
          const label = `ordering=${ordering} iteration=${iteration}`;
          const raceRepoId = await newRepo(cloneDir);
          const agent = await newAgent();
          const believed = agentToken(agent.version);
          const put = (paths: string[]) =>
            app.inject({
              method: 'PUT',
              url: `/agents/${agent.id}/context`,
              payload: { repo_id: raceRepoId, paths, expected_version: believed },
            });

          const [firstRes, secondRes] =
            ordering === 'A-then-B'
              ? await Promise.all([put(pathsA), put(pathsB)])
              : await Promise.all([put(pathsB), put(pathsA)]);

          const codes = [firstRes.statusCode, secondRes.statusCode];
          expect([...codes].sort(), `${label}: one 200 and one 409, statuses ${codes}`).toEqual([
            200, 409,
          ]);

          const sent = ordering === 'A-then-B' ? [pathsA, pathsB] : [pathsB, pathsA];
          const winner = firstRes.statusCode === 200 ? 0 : 1;
          const loser = winner === 0 ? 1 : 0;
          const responses = [firstRes, secondRes];
          expect(
            (responses[loser]!.json() as { error: { code: string } }).error.code,
            `${label}: the refused PUT is a conflict`,
          ).toBe('conflict');

          const get = await app.inject({
            method: 'GET',
            url: `/agents/${agent.id}/context`,
            query: { repoId: raceRepoId },
          });
          const stored = (get.json() as ContextAttachmentsView).rows.map((row) => row.path);
          expect(stored, `${label}: the stored set is the accepted PUT's body`).toEqual(
            sent[winner],
          );
          expect(
            (responses[winner]!.json() as ContextAttachmentsView).rows.map((row) => row.path),
            `${label}: the accepted PUT returned the set it stored`,
          ).toEqual(stored);
        }
      }
    });

    /**
     * The field is optional, and omitting it keeps the previous last-writer-wins
     * behaviour: nothing else in the repository sends it yet, and the client half
     * is wired separately. Both PUTs succeed and one body is lost — which is the
     * behaviour a caller opts into by sending no token, stated here so it cannot
     * change by accident.
     */
    it('two overlapping PUTs with no expected_version both succeed (LU, compatibility)', async () => {
      const raceRepoId = await newRepo(cloneDir);
      const agent = await newAgent();
      const pathsA = ['specs/a.md'];
      const pathsB = ['specs/a.md', 'docs/b.md'];
      const put = (paths: string[]) =>
        app.inject({
          method: 'PUT',
          url: `/agents/${agent.id}/context`,
          payload: { repo_id: raceRepoId, paths },
        });

      const [a, b] = await Promise.all([put(pathsA), put(pathsB)]);
      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);

      const get = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/context`,
        query: { repoId: raceRepoId },
      });
      const stored = (get.json() as ContextAttachmentsView).rows.map((row) => row.path);
      expect([pathsA, pathsB]).toContainEqual(stored);
    });

    it('PUT then GET /skills/:skillId/context, and the preview serialises them (AC-49)', async () => {
      const skill = await newSkill();
      const put = await app.inject({
        method: 'PUT',
        url: `/skills/${skill.id}/context`,
        payload: { repo_id: repoId, paths: ['specs/a.md'] },
      });
      expect(put.statusCode).toBe(200);
      expect((put.json() as ContextAttachmentsView).rows.map((row) => row.path)).toEqual([
        'specs/a.md',
      ]);

      const get = await app.inject({
        method: 'GET',
        url: `/skills/${skill.id}/context`,
        query: { repoId },
      });
      expect(get.statusCode).toBe(200);
      expect((get.json() as ContextAttachmentsView).effective_count).toBe(1);

      const preview = await app.inject({
        method: 'GET',
        url: `/skills/${skill.id}/context/preview`,
        query: { repoId },
      });
      expect(preview.statusCode).toBe(200);
      const body = preview.json() as ContextPreview;
      expect(body.unread).toEqual([]);
      expect(body.block.startsWith('## Project context\n')).toBe(true);
      expect(body.block).toContain('source="spec-0"');
      expect(body.block).toContain('# a\n');
    });

    it('another workspace’s agent, skill and repo are 404, never 403 (AC-14)', async () => {
      const foreignAgent = await newAgent({ ws: otherWorkspaceId });
      const foreignSkill = await newSkill({ ws: otherWorkspaceId });
      const foreignRepoId = await newRepo(cloneDir, otherWorkspaceId);

      const agentPut = await app.inject({
        method: 'PUT',
        url: `/agents/${foreignAgent.id}/context`,
        payload: { repo_id: repoId, paths: ['specs/a.md'] },
      });
      expect(agentPut.statusCode).toBe(404);
      expect(agentPut.json().error.code).toBe('not_found');

      const skillPut = await app.inject({
        method: 'PUT',
        url: `/skills/${foreignSkill.id}/context`,
        payload: { repo_id: repoId, paths: ['specs/a.md'] },
      });
      expect(skillPut.statusCode).toBe(404);

      const repoGet = await app.inject({
        method: 'GET',
        url: `/repos/${foreignRepoId}/context`,
      });
      expect(repoGet.statusCode).toBe(404);

      const agentGet = await app.inject({
        method: 'GET',
        url: `/agents/${foreignAgent.id}/context`,
        query: { repoId },
      });
      expect(agentGet.statusCode).toBe(404);

      // Nothing was written for either foreign owner, in any repository.
      expect(await repo.attachmentsFor('agent', foreignAgent.id, null)).toEqual([]);
      expect(await repo.attachmentsFor('skill', foreignSkill.id, null)).toEqual([]);
    });

    it('a non-uuid id or repoId is 422 from the route schema, not a 404', async () => {
      const agent = await newAgent();

      const badParam = await app.inject({
        method: 'PUT',
        url: '/agents/not-a-uuid/context',
        payload: { repo_id: repoId, paths: [] },
      });
      expect(badParam.statusCode).toBe(422);
      expect(badParam.json().error.code).toBe('validation_error');

      const badQuery = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/context`,
        query: { repoId: 'not-a-uuid' },
      });
      expect(badQuery.statusCode).toBe(422);

      const badBody = await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/context`,
        payload: { repo_id: 'not-a-uuid', paths: [] },
      });
      expect(badBody.statusCode).toBe(422);

      const badRepoParam = await app.inject({ method: 'GET', url: '/repos/nope/context' });
      expect(badRepoParam.statusCode).toBe(422);
    });

    it('PUT /settings refuses a traversing context_roots and persists nothing (AC-75)', async () => {
      await db
        .delete(t.settings)
        .where(
          and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, SETTINGS_ROOTS_KEY)),
        );

      const res = await app.inject({
        method: 'PUT',
        url: '/settings',
        payload: { context_roots: ['../..'] },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
      expect(await rootsRows()).toEqual([]);

      // A separator is refused the same way, and still writes nothing.
      const withSeparator = await app.inject({
        method: 'PUT',
        url: '/settings',
        payload: { context_roots: ['a/b'] },
      });
      expect(withSeparator.statusCode).toBe(422);
      expect(await rootsRows()).toEqual([]);
    });

    it('PUT /settings accepts a segment list and the next discovery searches it (AC-3)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/settings',
        payload: { context_roots: ['adr'] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().context_roots).toEqual(['adr']);
      expect((await rootsRows()).map((row) => row.value)).toEqual([['adr']]);

      const list = await app.inject({ method: 'GET', url: `/repos/${adrRepoId}/context` });
      expect(list.statusCode).toBe(200);
      const body = list.json() as ContextDocList;
      expect(body.roots).toEqual(['adr']);
      expect(body.docs.map((doc) => doc.path)).toEqual(['adr/decision.md']);

      // And the default roots are no longer searched: the fixture clone has no
      // `adr/`, so its documents drop out of discovery entirely.
      const fixture = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
      expect((fixture.json() as ContextDocList).docs).toEqual([]);
    });
  });
});
