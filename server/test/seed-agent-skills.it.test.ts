import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import { SEED_AGENT_SKILLS, SEED_SKILLS } from '../src/db/seed-skills.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[seed-agent-skills] Docker not available — skipping integration tests.');
}

/**
 * The seed's skill wiring. The Test Quality Reviewer is a shell agent — it finds
 * nothing that its linked skills do not carry — so the links are the feature,
 * not plumbing around it, and link ORDER is the author's priority order in the
 * assembled prompt.
 *
 * The reconciliation pass is the part with real teeth: retargeting
 * `SEED_AGENT_SKILLS` on an already-seeded database has to remove the old wiring,
 * without touching a link the user made by hand.
 */
d('seed: built-in skills and their agent links', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId, userId } = await seed(pg.handle.db));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const db = () => pg.handle.db;

  const agentByName = async (name: string) => {
    const [row] = await db()
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, name)));
    return row;
  };

  const skillByName = async (name: string) => {
    const [row] = await db()
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, name)));
    return row;
  };

  /**
   * `[skillName, order]` for every link on an agent, sorted by name so the
   * assertion sees the stored `order` column rather than the row order Postgres
   * happened to return. Sorting by `order` and comparing names would pass with
   * every link at 0 — a stable sort would keep them in insertion order.
   */
  const linkedSkills = async (agentId: string): Promise<Array<[string, number]>> => {
    const rows = await db()
      .select({ name: t.skills.name, order: t.agentSkills.order })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.skills.id, t.agentSkills.skillId))
      .where(eq(t.agentSkills.agentId, agentId));
    return rows.sort((a, b) => a.name.localeCompare(b.name)).map((r) => [r.name, r.order]);
  };

  /** The same shape, derived from the declared wiring. */
  const expectedLinks = (agentName: string): Array<[string, number]> =>
    (SEED_AGENT_SKILLS[agentName] ?? [])
      .map((name, order): [string, number] => [name, order])
      .sort((a, b) => a[0].localeCompare(b[0]));

  it('seeds the Test Quality Reviewer enabled, on the default provider/model', async () => {
    const agent = await agentByName('Test Quality Reviewer');
    expect(agent).toBeDefined();
    expect(agent!.enabled).toBe(true);
    expect(agent!.version).toBe(1);
    expect(agent!.systemPrompt).toContain('## Skills / rules');
  });

  it('links every seeded skill to it, in SEED_AGENT_SKILLS order', async () => {
    const agent = await agentByName('Test Quality Reviewer');
    expect(await linkedSkills(agent!.id)).toEqual(expectedLinks('Test Quality Reviewer'));
  });

  it('leaves the other three reviewers with no skills', async () => {
    for (const name of ['General Reviewer', 'Security Reviewer', 'Performance Reviewer']) {
      const agent = await agentByName(name);
      expect(await linkedSkills(agent!.id), `${name} should have no linked skills`).toEqual([]);
    }
  });

  it('gives every seeded skill its v1 snapshot', async () => {
    for (const s of SEED_SKILLS) {
      const skill = await skillByName(s.name);
      expect(skill, `${s.name} not seeded`).toBeDefined();
      expect(skill!.version).toBe(1);
      const versions = await db()
        .select()
        .from(t.skillVersions)
        .where(eq(t.skillVersions.skillId, skill!.id));
      expect(versions.map((v) => v.version), `${s.name} version history`).toEqual([1]);
      expect(versions[0]!.body).toBe(skill!.body);
    }
  });

  it('re-seeding changes nothing', async () => {
    const agent = await agentByName('Test Quality Reviewer');
    const before = await linkedSkills(agent!.id);

    await seed(db());

    const agentsNamed = await db()
      .select()
      .from(t.agents)
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          eq(t.agents.name, 'Test Quality Reviewer'),
        ),
      );
    expect(agentsNamed).toHaveLength(1);
    expect(await linkedSkills(agent!.id)).toEqual(before);

    const skillRows = await db()
      .select()
      .from(t.skills)
      .where(
        and(
          eq(t.skills.workspaceId, workspaceId),
          inArray(
            t.skills.name,
            SEED_SKILLS.map((s) => s.name),
          ),
        ),
      );
    expect(skillRows).toHaveLength(SEED_SKILLS.length);
  });

  it("drops a stale built-in link but keeps a custom agent's link to a built-in skill", async () => {
    const general = await agentByName('General Reviewer');
    const skill = await skillByName('flaky-test-gate');

    // The wiring this design moved away from: a built-in skill on the General
    // Reviewer. The seed owns this pair, so it must be reconciled away.
    await db()
      .insert(t.agentSkills)
      .values({ agentId: general!.id, skillId: skill!.id, order: 0 })
      .onConflictDoNothing();

    // A link the user made. Nothing the seed knows about owns it.
    const [custom] = await db()
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'My Own Reviewer',
        description: 'user-created',
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        systemPrompt: '# Role\nmine',
        enabled: true,
        version: 1,
        createdBy: userId,
      })
      .returning();
    await db()
      .insert(t.agentSkills)
      .values({ agentId: custom!.id, skillId: skill!.id, order: 0 })
      .onConflictDoNothing();

    await seed(db());

    expect(await linkedSkills(general!.id)).toEqual([]);
    expect(await linkedSkills(custom!.id)).toEqual([['flaky-test-gate', 0]]);
    const tqr = await agentByName('Test Quality Reviewer');
    expect(await linkedSkills(tqr!.id)).toEqual(expectedLinks('Test Quality Reviewer'));
  });
});
