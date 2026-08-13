import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { SETTINGS_ROOTS_KEY } from './constants.js';
import { agentToken, fingerprintAttachments, parseRoots } from './helpers.js';
import type {
  AttachmentRecord,
  AttachmentsToken,
  OrderInput,
  OrderInputSkill,
  OwnerKind,
  RepoRef,
  ReplaceOutcome,
} from './domain.js';

/**
 * The module's only Drizzle. Everything this feature persists is
 * `context_attachments` — **paths only**, never document text — plus the
 * cross-table reads it needs over `agents`, `agent_skills`, `skills`, `repos`
 * and `settings`. A cross-*table* read inside one repository is allowed and is
 * the established pattern (`ConventionsRepository.featureModelChoice`,
 * `SkillsRepository.usage`); importing `modules/agents/repository.ts` would be
 * a `no-cross-module-internals` violation, so nothing here does.
 *
 * Nothing in this file throws `NotFound`: a miss is `undefined` and the
 * service/route turns it into a 404. Every method that can address another
 * tenant's row filters on `workspaceId` — a cross-workspace agent, skill or
 * repository is invisible, which is what makes AC-14's 404 (never a 403)
 * possible at the route.
 */

/** The handle `db.transaction` hands its callback — same query API as `Db`. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * One agent's stored attachment set for a repository: its own rows, plus every
 * linked skill in **link order** with that skill's rows. Structurally identical
 * to `OrderInput` — the run path and the editor read exactly the same shape, and
 * `domain.ts` owns it so `ports.ts` can name it without importing this file.
 */
export type AgentBundle = OrderInput & { version: number };

/** The `agent_versions.config_json` shape this module writes (snake_case, as stored). */
interface AgentConfigSnapshot {
  provider: string;
  model: string;
  system_prompt: string;
  output_schema: unknown;
  strategy: string;
  ci_fail_on: string;
  repo_intel: boolean;
  skills: string[];
  /** The ordered attachment paths for the repository that was just replaced. */
  context_paths: string[];
}

export class ProjectContextRepository {
  constructor(private db: Db) {}

  // ------------------------------------------------------------------ usage

  /**
   * Usage count per path for one repository: **one** round trip, whatever the
   * size of the document list. Two queries per document over a 500-row listing
   * is the defect the NFR §Performance row names, and the it-test asserts the
   * statement count rather than only the numbers.
   *
   * The counting rule has three parts that pull in different directions:
   *
   *  - a row reaches an agent when `agent_id = agents.id` **or** when its
   *    `skill_id` is linked to that agent through `agent_skills`;
   *  - `skills.enabled = false` is filtered (AC-73): a disabled skill injects
   *    nothing, so it carries no reach. Because the filter sits in the `skills`
   *    join condition of a LEFT JOIN, a document reachable only that way still
   *    appears in the map — with 0 — rather than vanishing from it;
   *  - `agents.enabled` is **not** filtered (AC-57): the number describes
   *    configuration, and a disabled agent is still configured to read it.
   *
   * `count(distinct agents.id)` is what makes one skill carrying two documents
   * linked to three agents give each document 3 and not 6, and what makes a path
   * attached both directly and through a skill to the same agent count once.
   */
  async usageCounts(workspaceId: string, repoId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        path: t.contextAttachments.path,
        agents: sql<number>`count(distinct ${t.agents.id})::int`,
      })
      .from(t.contextAttachments)
      .leftJoin(
        t.skills,
        and(
          eq(t.skills.id, t.contextAttachments.skillId),
          eq(t.skills.workspaceId, t.contextAttachments.workspaceId),
          eq(t.skills.enabled, true),
        ),
      )
      .leftJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
      .leftJoin(
        t.agents,
        and(
          sql`${t.agents.id} = coalesce(${t.contextAttachments.agentId}, ${t.agentSkills.agentId})`,
          eq(t.agents.workspaceId, t.contextAttachments.workspaceId),
        ),
      )
      .where(
        and(
          eq(t.contextAttachments.workspaceId, workspaceId),
          eq(t.contextAttachments.repoId, repoId),
        ),
      )
      .groupBy(t.contextAttachments.path);

    return new Map(rows.map((row) => [row.path, row.agents]));
  }

  // ----------------------------------------------------------------- writes

  /**
   * Replace one agent's attachment set for one repository, and record the new
   * agent version (AC-12, AC-13).
   *
   * The whole thing is **one** `db.transaction` over the agent row taken
   * `FOR UPDATE`, and every statement runs on `tx` — a snapshot written on
   * `this.db` escapes the transaction and can be seen without the rows it
   * describes. The version is bumped in SQL (`version + 1`) and the snapshot
   * uses the number `.returning()` gave back, so two concurrent replaces get
   * their own version *and* their own snapshot; computing `existing.version + 1`
   * in JS and swallowing the collision with `.onConflictDoNothing()` is exactly
   * the silent history loss `server/INSIGHTS.md` (2026-08-03) describes.
   * `AgentsRepository.setSkills` neither locks nor transacts — it is the
   * precedent this deliberately does not copy.
   *
   * **The lock alone does not stop a lost update.** It serialises the two
   * transactions, but each body is a *whole replacement* the client computed
   * from a snapshot it read earlier, so whichever transaction commits last wins
   * — and that is not the order they were sent. Tick A then tick B, let B's
   * transaction take the lock first, and A's `[A]` then deletes and re-inserts
   * over B's `[A,B]`: B is gone, durably, snapshot included. `expectedVersion`
   * closes it. It is compared **inside** the transaction, against the row this
   * `FOR UPDATE` just returned — a `SELECT` before the lock would be the same
   * unlocked read-modify-write in a different place (`server/INSIGHTS.md`,
   * 2026-08-03). `FOR UPDATE` follows the update chain, so after waiting on
   * another writer this sees that writer's *committed* version, not the one the
   * statement's original snapshot held.
   *
   * Returns `not_found` when the agent is not this workspace's, `stale` when the
   * token moved, and `written` with the new token otherwise. Nothing is written
   * in either of the first two cases.
   */
  async replaceAgentAttachments(
    workspaceId: string,
    agentId: string,
    repoId: string,
    paths: string[],
    expectedVersion?: AttachmentsToken,
  ): Promise<ReplaceOutcome> {
    // First occurrence wins. `context_attachments_agent_uq` makes a repeated
    // path unstorable, so deduping here keeps a repeated path in one request
    // from becoming a 500, and keeps `order` contiguous from zero.
    const ordered = dedupe(paths);

    return this.db.transaction(async (tx): Promise<ReplaceOutcome> => {
      const [agent] = await tx
        .select()
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
        .for('update');
      if (!agent) return { status: 'not_found' };

      const current = agentToken(agent.version);
      if (expectedVersion !== undefined && expectedVersion !== current) {
        return { status: 'stale', token: current };
      }

      await tx
        .delete(t.contextAttachments)
        .where(
          and(
            eq(t.contextAttachments.agentId, agentId),
            eq(t.contextAttachments.repoId, repoId),
          ),
        );

      if (ordered.length > 0) {
        await tx.insert(t.contextAttachments).values(
          ordered.map((path, index) => ({
            workspaceId,
            ownerKind: 'agent' as const,
            agentId,
            skillId: null,
            repoId,
            path,
            order: index,
          })),
        );
      }

      const [bumped] = await tx
        .update(t.agents)
        .set({ version: sql`${t.agents.version} + 1` })
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
        .returning();
      const version = bumped!.version;

      const skills = await tx
        .select({ skillId: t.agentSkills.skillId })
        .from(t.agentSkills)
        .where(eq(t.agentSkills.agentId, agentId))
        .orderBy(asc(t.agentSkills.order));

      const configJson: AgentConfigSnapshot = {
        provider: bumped!.provider,
        model: bumped!.model,
        system_prompt: bumped!.systemPrompt,
        output_schema: bumped!.outputSchema,
        strategy: bumped!.strategy,
        ci_fail_on: bumped!.ciFailOn,
        repo_intel: bumped!.repoIntel,
        skills: skills.map((row) => row.skillId),
        context_paths: ordered,
      };
      // No `.onConflictDoNothing()`: a swallowed snapshot insert is history loss,
      // and with the lock plus the SQL-side bump this version cannot collide.
      await tx.insert(t.agentVersions).values({ agentId, version, configJson });

      return { status: 'written', token: agentToken(version) };
    });
  }

  /**
   * Replace one skill's attachment set for one repository. Transactional and
   * `FOR UPDATE` on the skill row for the same reason as the agent path — the
   * delete and the insert are one edit, and a concurrent replace must not
   * interleave into a set that is neither caller's.
   *
   * No version bump: a skill's version tracks its **body** (`skill_versions`),
   * and an attachment change does not rewrite it. A skill that is not this
   * workspace's writes nothing; the route 404s off `skillOwner`.
   *
   * That absent counter is why the compare-and-set here is against a
   * **fingerprint of the stored set** rather than a version column. `skills.version`
   * exists but is the wrong number: this write does not move it, so two
   * overlapping replaces would both send the same value, both compare equal, and
   * the lost update would land anyway. `fingerprintAttachments` moves exactly
   * when the set does. The rows are read *after* the `FOR UPDATE` on the skill
   * row, which is what makes the read see the previous writer's committed state:
   * under READ COMMITTED each statement takes its own snapshot, so a statement
   * issued after the lock was granted sees everything that writer committed.
   */
  async replaceSkillAttachments(
    workspaceId: string,
    skillId: string,
    repoId: string,
    paths: string[],
    expectedVersion?: AttachmentsToken,
  ): Promise<ReplaceOutcome> {
    const ordered = dedupe(paths);

    return this.db.transaction(async (tx): Promise<ReplaceOutcome> => {
      const [skill] = await tx
        .select({ id: t.skills.id })
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)))
        .for('update');
      if (!skill) return { status: 'not_found' };

      // Same projection and same ORDER BY as `attachmentsFor`, so the token the
      // view handed out and the token compared here describe one thing.
      const stored = await tx
        .select({ path: t.contextAttachments.path })
        .from(t.contextAttachments)
        .where(
          and(
            eq(t.contextAttachments.skillId, skillId),
            eq(t.contextAttachments.repoId, repoId),
          ),
        )
        .orderBy(asc(t.contextAttachments.order), asc(t.contextAttachments.path));
      const current = fingerprintAttachments(stored.map((row) => row.path));
      if (expectedVersion !== undefined && expectedVersion !== current) {
        return { status: 'stale', token: current };
      }

      await tx
        .delete(t.contextAttachments)
        .where(
          and(
            eq(t.contextAttachments.skillId, skillId),
            eq(t.contextAttachments.repoId, repoId),
          ),
        );

      if (ordered.length > 0) {
        await tx.insert(t.contextAttachments).values(
          ordered.map((path, index) => ({
            workspaceId,
            ownerKind: 'skill' as const,
            agentId: null,
            skillId,
            repoId,
            path,
            order: index,
          })),
        );
      }

      return { status: 'written', token: fingerprintAttachments(ordered) };
    });
  }

  // ------------------------------------------------------------------ reads

  /** The repository row this feature needs. `clonePath` is nullable (AC-7). */
  async getRepo(workspaceId: string, repoId: string): Promise<RepoRef | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        fullName: t.repos.fullName,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * The configured search roots (AC-3, AC-76). Selected by `workspaceId` and
   * `key` only — exactly what `GET /settings` does — and the raw `value` goes to
   * `parseRoots`, which never throws and degrades to the defaults.
   *
   * The *last* row wins, because `rowsToSettings` collapses the same select by
   * overwriting and being arbitrarily different from the screen that shows the
   * value helps nobody. What "last" means is fixed by the `ORDER BY`, and that
   * is not optional: `settings_ws_user_key_uq` is not `NULLS NOT DISTINCT`, so a
   * workspace-level row (`user_id IS NULL`) and one row per user can all coexist
   * for the same key — reachable today with two seeded users. Without an
   * `ORDER BY` the winner is whatever the plan happened to emit, and Postgres
   * may return two consecutive requests in different physical orders (a plain
   * `UPDATE` is enough to move a tuple), so the document list would flicker
   * between two root sets on refresh.
   *
   * Ascending `user_id` puts NULL last, so the workspace-level row wins when one
   * exists, and `id` breaks the tie between two users' rows. Which *ought* to
   * win — user over workspace, or the reverse — is a recorded open question in
   * the spec and is deliberately not answered here; this only guarantees that
   * the same rows always produce the same answer.
   */
  async roots(workspaceId: string): Promise<string[]> {
    const rows = await this.db
      .select({ value: t.settings.value })
      .from(t.settings)
      .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, SETTINGS_ROOTS_KEY)))
      .orderBy(asc(t.settings.userId), asc(t.settings.id));
    return parseRoots(rows.at(-1)?.value);
  }

  /** A skill's identity, for the editor's header and the route's 404 (AC-14). */
  async skillOwner(
    workspaceId: string,
    skillId: string,
  ): Promise<{ id: string; name: string } | undefined> {
    const [row] = await this.db
      .select({ id: t.skills.id, name: t.skills.name })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)));
    return row;
  }

  /**
   * One owner's stored rows, in stored order. `repoId` of `null` means every
   * repository (the "attached elsewhere" view); `path` breaks a tie so the
   * result is deterministic even if two rows share an `order`.
   *
   * Owner-scoped rather than workspace-scoped on purpose: the caller has already
   * resolved the owner through `agentBundle` / `skillOwner`, both of which filter
   * `workspaceId`, and the row's owner FK is what confines it.
   */
  async attachmentsFor(
    ownerKind: OwnerKind,
    ownerId: string,
    repoId: string | null,
  ): Promise<AttachmentRecord[]> {
    const owner =
      ownerKind === 'agent'
        ? eq(t.contextAttachments.agentId, ownerId)
        : eq(t.contextAttachments.skillId, ownerId);

    return this.db
      .select({
        path: t.contextAttachments.path,
        repoId: t.contextAttachments.repoId,
        order: t.contextAttachments.order,
      })
      .from(t.contextAttachments)
      .where(repoId === null ? owner : and(owner, eq(t.contextAttachments.repoId, repoId)))
      .orderBy(asc(t.contextAttachments.order), asc(t.contextAttachments.path));
  }

  /**
   * Everything the agent editor needs for one repository, or `undefined` when
   * the agent is not this workspace's (AC-14). Disabled skills are reported with
   * `enabled: false` rather than dropped — the editor shows them struck through,
   * and only the ordering helpers act on the flag (AC-20).
   */
  async agentBundle(
    workspaceId: string,
    agentId: string,
    repoId: string,
  ): Promise<AgentBundle | undefined> {
    const [agent] = await this.db
      .select({ id: t.agents.id, version: t.agents.version })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)));
    if (!agent) return undefined;

    return {
      // The agent view's concurrency token, read in the same statement that
      // proved the agent is this workspace's.
      version: agent.version,
      direct: await this.attachmentsFor('agent', agentId, repoId),
      skills: await this.linkedSkillAttachments(this.db, agentId, repoId),
    };
  }

  /**
   * The run path's input: this agent's rows and its linked skills' rows for the
   * PR's repository **only**. An attachment made against a different repository
   * is not read and is not named in the trace (AC-19), and filtering it in SQL is
   * what guarantees the service never sees it.
   */
  async resolveForRun(agentId: string, repoId: string): Promise<OrderInput> {
    return {
      direct: await this.attachmentsFor('agent', agentId, repoId),
      skills: await this.linkedSkillAttachments(this.db, agentId, repoId),
    };
  }

  /**
   * Linked skills in `agent_skills.order`, each with its rows for `repoId` in
   * stored order. One query: a LEFT JOIN so a linked skill with no attachments
   * is still reported (its position matters to the editor), grouped in JS
   * because the row order the `ORDER BY` fixes *is* the answer.
   */
  private async linkedSkillAttachments(
    db: Db | Tx,
    agentId: string,
    repoId: string,
  ): Promise<OrderInputSkill[]> {
    const rows = await db
      .select({
        id: t.skills.id,
        name: t.skills.name,
        enabled: t.skills.enabled,
        path: t.contextAttachments.path,
        repoId: t.contextAttachments.repoId,
        order: t.contextAttachments.order,
      })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.skills.id, t.agentSkills.skillId))
      .leftJoin(
        t.contextAttachments,
        and(
          eq(t.contextAttachments.skillId, t.skills.id),
          eq(t.contextAttachments.repoId, repoId),
        ),
      )
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(
        asc(t.agentSkills.order),
        asc(t.skills.id),
        asc(t.contextAttachments.order),
        asc(t.contextAttachments.path),
      );

    const bySkill = new Map<string, OrderInputSkill>();
    for (const row of rows) {
      let skill = bySkill.get(row.id);
      if (skill === undefined) {
        skill = { id: row.id, name: row.name, enabled: row.enabled, attachments: [] };
        bySkill.set(row.id, skill);
      }
      // LEFT JOIN: a skill with nothing attached for this repo yields one row of nulls.
      if (row.path !== null && row.repoId !== null && row.order !== null) {
        skill.attachments.push({ path: row.path, repoId: row.repoId, order: row.order });
      }
    }
    return [...bySkill.values()];
  }
}

/** First occurrence wins, preserving order. */
function dedupe(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}
