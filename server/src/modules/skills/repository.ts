import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';
import { isBodyChange } from './helpers.js';

/**
 * Skills data-access. Owns `skills`, `skill_versions`, and the SKILL side of
 * `agent_skills` (which agents use this skill). The AGENT side — link, reorder,
 * list-for-one-agent — belongs to AgentsRepository. Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

/** The handle `db.transaction` hands its callback — same query API as `Db`. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
  /**
   * Defaults to 'manual'. The conventions extractor passes 'extracted'; see the
   * trust note in specs/skills.md before adding a third source.
   */
  source?: SkillSource;
  /** Paths the extracted rules were evidenced against. */
  evidenceFiles?: string[];
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

/** A skill row plus how many agents link it (list screen). */
export interface SkillUsageRow {
  skill: SkillRow;
  agentCount: number;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  /** All skills in the workspace, alphabetical, each with its link count. */
  async list(workspaceId: string): Promise<SkillUsageRow[]> {
    const rows = await this.db
      .select({
        skill: t.skills,
        agentCount: sql<number>`count(${t.agentSkills.agentId})::int`,
      })
      .from(t.skills)
      .leftJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.skills.workspaceId, workspaceId))
      .groupBy(t.skills.id)
      .orderBy(asc(t.skills.name));
    return rows.map((r) => ({ skill: r.skill, agentCount: r.agentCount }));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Case-insensitive name lookup — names are unique per workspace. */
  async findByName(workspaceId: string, name: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(
        and(eq(t.skills.workspaceId, workspaceId), sql`lower(${t.skills.name}) = lower(${name})`),
      );
    return row;
  }

  /** Insert a skill AND record version 1 in skill_versions. */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source ?? 'manual',
        ...(values.evidenceFiles !== undefined ? { evidenceFiles: values.evidenceFiles } : {}),
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
      })
      .returning();
    await this.snapshotVersion(this.db, row!, INITIAL_SKILL_VERSION, null);
    return row!;
  }

  /**
   * Patch a skill. A changed `body` bumps the version and snapshots it with the
   * caller's `summary`; every other field is a plain update. A summary sent
   * without a body change is dropped — there is no version for it to describe.
   *
   * Runs in a transaction that takes `FOR UPDATE` on the skill row, because
   * "did the body change?" is a read-modify-write and every part of it has to
   * see the same body. Two concurrent saves against one unlocked read left the
   * live body in no snapshot at all: the one whose patch matched the body it
   * read decided "unchanged", skipped the bump, and still wrote its body over
   * the other's — so skills.body and the snapshot for skills.version disagreed
   * (observed in ~5 of 8 races before the lock). The second save now waits and
   * re-reads, so it compares against what actually landed.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
    summary?: string,
  ): Promise<SkillRow | undefined> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .for('update');
      if (!existing) return undefined;

      const bodyChanged = isBodyChange(existing, patch);

      const [row] = await tx
        .update(t.skills)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          // Bumped in SQL rather than as `existing.version + 1`. The lock above
          // already makes those equivalent; this keeps the version correct if the
          // lock is ever dropped, since two savers computing the same next
          // version would collide on (skill_id, version) and lose a snapshot to
          // `onConflictDoNothing`. Same reason bumpForSkillChange does it here.
          ...(bodyChanged ? { version: sql`${t.skills.version} + 1` } : {}),
        })
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .returning();

      if (bodyChanged && row) await this.snapshotVersion(tx, row, row.version, summary ?? null);
      return row;
    });
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** Agents that link this skill, alphabetical. The skill side of agent_skills. */
  async usage(skillId: string): Promise<{ id: string; name: string; enabled: boolean }[]> {
    return this.db
      .select({ id: t.agents.id, name: t.agents.name, enabled: t.agents.enabled })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(eq(t.agentSkills.skillId, skillId))
      .orderBy(asc(t.agents.name));
  }

  /** All snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** One snapshot, or undefined when that version was never recorded. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  private async snapshotVersion(
    db: Db | Tx,
    row: SkillRow,
    version: number,
    summary: string | null,
  ): Promise<void> {
    await db
      .insert(t.skillVersions)
      .values({ skillId: row.id, version, summary, body: row.body })
      .onConflictDoNothing();
  }
}
