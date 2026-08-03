# Skills Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship reusable, versioned text *skills* that a user can create and edit,
attach to many agents in an explicit order, and see take effect in a real review
prompt.

**Architecture:** A new `skills` module on the server owns `skills`,
`skill_versions`, and the reverse (skill → agents) side of `agent_skills`; the
agent side stays in `AgentsRepository` and cross-module access goes through a new
`container.skillsRepo`. The client gets a `/skills` master-detail screen and a
Skills tab in the agent editor. The last mile is one call in `run-executor.ts`
that hands the linked bodies to `reviewPullRequest` — `reviewer-core` already
renders them into `## Skills / rules`.

**Tech Stack:** Fastify + `fastify-type-provider-zod`, Drizzle (Postgres),
vitest + testcontainers on the server; Next 15 App Router, React 19, TanStack
Query, `next-intl`, vitest + React Testing Library on the client. Two new client
dependencies: `diff` and `@dnd-kit/*`.

**Spec:** [`docs/superpowers/specs/2026-08-02-skills-design.md`](../specs/2026-08-02-skills-design.md)

## Global Constraints

- **Package managers differ.** `server/` and `client/` use **pnpm**. Never run
  `npm install` in either — it writes a second lockfile.
- **`@devdigest/shared` is two physical copies.** Every contract edit must be
  applied identically to `server/src/vendor/shared/contracts/knowledge.ts` **and**
  `client/src/vendor/shared/contracts/knowledge.ts`, and both packages
  type-checked.
- **A skill is text.** No tools, no execution, no fetching, no code paths that
  interpret the body. The only thing that happens to a body is that it is stored,
  rendered as Markdown for preview, and concatenated into a prompt.
- **Services never take `Container`.** `SkillsService` takes its repository. A
  service that imports `platform/container.js` closes a real import cycle and
  fails `pnpm arch:check`.
- **Module-shared row types come from `src/db/rows.ts`**, never from another
  module's `repository.ts` — `helpers.ts` importing a row type out of
  `repository.ts` creates a type-only cycle that `no-circular` fails on
  (`server/INSIGHTS.md`, 2026-08-02).
- **Every route calls `getContext(container, req)`** and scopes every query by
  `workspaceId`. A row from another workspace is a **404**, never a 403.
- **Never hand-edit an applied migration.** Change `src/db/schema/*.ts` and run
  `pnpm db:generate`.
- **Client styles live in `styles.ts` as an exported `s` object of
  `CSSProperties`** — despite what `client/CLAUDE.md` says about Tailwind class
  strings, every existing component folder uses inline style objects (see
  `client/src/app/agents/_components/AgentCard/styles.ts`). Match the neighbours.
- **Client data access is component → hook in `src/lib/hooks/` → `api` from
  `src/lib/api.ts`.** No `fetch` in a component.
- **User-facing strings go through `next-intl`** — `client/messages/en/skills.json`
  and `agents.json`. Never hardcode copy in JSX.
- **No `@testing-library/user-event`** in this repo; drive interactions with
  `fireEvent` from `@testing-library/react`.
- **Do not build:** URL import, community search, the Evals tab, the "Run on
  evals" button, or any accuracy metric (pull frequency, accept rate, findings
  counts, findings-by-category). They have no data behind them.
- **Do not modify `reviewer-core/`.** Its skills plumbing is already complete.
- Commit style: conventional commits with a scope (`feat(skills):`,
  `feat(server):`, `test(client):`), *why* in the body.
- Branch: `feat/skills-library` (already created, spec already committed on it).

## File Structure

**Server**

| File | Responsibility |
|---|---|
| `src/db/schema/skills.ts` (modify) | add `summary` to `skill_versions` |
| `src/db/rows.ts` (modify) | export `SkillRow`, `SkillVersionRow` |
| `src/db/migrations/00NN_*.sql` (generated) | the column |
| `src/modules/skills/constants.ts` | limits |
| `src/modules/skills/helpers.ts` | row → DTO, `isBodyChange` |
| `src/modules/skills/repository.ts` | all SQL for `skills`, `skill_versions`, skill→agents |
| `src/modules/skills/service.ts` | CRUD, versioning, restore, stats |
| `src/modules/skills/routes.ts` | HTTP + Zod |
| `src/modules/index.ts` (modify) | register the module |
| `src/platform/container.ts` (modify) | `skillsRepo` getter |
| `src/modules/agents/repository.ts` (modify) | version bump on link changes |
| `src/modules/reviews/run-executor.ts` (modify) | inject bodies into the prompt |
| `src/vendor/shared/contracts/knowledge.ts` (modify) | `SkillVersion`, `SkillStats`, `SkillWithUsage` |

**Client**

| File | Responsibility |
|---|---|
| `src/vendor/shared/contracts/knowledge.ts` (modify) | identical contract copy |
| `src/lib/hooks/skills.ts` | every skills query + mutation |
| `src/app/skills/layout.tsx` | left column + `{children}` |
| `src/app/skills/page.tsx` | "select a skill" state |
| `src/app/skills/[id]/page.tsx` | detail pane, tab in `?tab=` |
| `src/app/skills/_components/SkillsListView/**` | search, add menu, cards |
| `src/app/skills/[id]/_components/SkillDetail/**` | Config / Preview / Stats / Versions |
| `src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/**` | link + reorder |
| `src/vendor/ui/nav.ts` (modify) | `SKILLS LAB` section |
| `messages/en/skills.json`, `messages/en/agents.json` (modify) | copy |

---

### Task 1: Migration + shared contracts

The column and the DTO shapes every later task references.

**Files:**
- Modify: `server/src/db/schema/skills.ts`
- Modify: `server/src/db/rows.ts`
- Create: `server/src/db/migrations/00NN_<generated>.sql` (via `pnpm db:generate`)
- Modify: `server/src/vendor/shared/contracts/knowledge.ts`
- Modify: `client/src/vendor/shared/contracts/knowledge.ts`
- Test: `server/test/contracts.test.ts`

**Interfaces:**
- Produces: `SkillRow`, `SkillVersionRow` (row types); Zod schemas + types
  `SkillVersion`, `SkillAgentRef`, `SkillStats`, `SkillWithUsage`.

- [ ] **Step 1: Add the column to the schema**

In `server/src/db/schema/skills.ts`, add `summary` to `skillVersions` (between
`version` and `body`):

```ts
export const skillVersions = pgTable(
  'skill_versions',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** Optional one-line note describing what changed in this body. */
    summary: text('summary'),
    body: text('body').notNull(),
    createdAt: now(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.skillId, t.version] }) }),
);
```

- [ ] **Step 2: Export the row types**

Append to `server/src/db/rows.ts`:

```ts
export type SkillRow = typeof t.skills.$inferSelect;
export type SkillVersionRow = typeof t.skillVersions.$inferSelect;
```

- [ ] **Step 3: Generate the migration**

Run: `cd server && pnpm db:generate`
Expected: a new `src/db/migrations/00NN_*.sql` containing
`ALTER TABLE "skill_versions" ADD COLUMN "summary" text;` plus a new
`meta/00NN_snapshot.json`. Do not edit either by hand.

- [ ] **Step 4: Add the contracts (server copy)**

In `server/src/vendor/shared/contracts/knowledge.ts`, directly after the
`CommunitySkill` block:

```ts
/** One immutable snapshot of a skill body. `summary` is the author's note. */
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  summary: z.string().nullable(),
  body: z.string(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

/** An agent that has this skill linked. */
export const SkillAgentRef = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
});
export type SkillAgentRef = z.infer<typeof SkillAgentRef>;

/** Everything the Stats tab can honestly show: who uses this skill. */
export const SkillStats = z.object({
  agent_count: z.number().int(),
  agents: z.array(SkillAgentRef),
});
export type SkillStats = z.infer<typeof SkillStats>;

/** List-row shape: a skill plus how many agents link it. */
export const SkillWithUsage = Skill.extend({ agent_count: z.number().int() });
export type SkillWithUsage = z.infer<typeof SkillWithUsage>;
```

- [ ] **Step 5: Copy the same block to the client**

Paste the identical block into
`client/src/vendor/shared/contracts/knowledge.ts` at the same position (after
`CommunitySkill`). The two files have drifted elsewhere — do not sync anything
you were not asked to.

- [ ] **Step 6: Write the failing contract test**

Append to `server/test/contracts.test.ts` (and add the four names to the import
list at the top of the file):

```ts
describe('Skill contracts', () => {
  it('SkillWithUsage carries the link count', () => {
    const row = SkillWithUsage.parse({
      id: 's1',
      name: 'pr-quality-rubric',
      description: 'Rubric for overall PR quality',
      type: 'rubric',
      source: 'manual',
      body: '# PR Quality Rubric',
      enabled: true,
      version: 5,
      agent_count: 3,
    });
    expect(row.agent_count).toBe(3);
  });

  it('SkillVersion allows a null summary', () => {
    const v = SkillVersion.parse({
      skill_id: 's1',
      version: 1,
      summary: null,
      body: '# initial',
      created_at: '2026-08-02T10:00:00.000Z',
    });
    expect(v.summary).toBeNull();
  });

  it('SkillStats defaults to an empty agent list', () => {
    const stats = SkillStats.parse({ agent_count: 0, agents: [] });
    expect(stats.agents).toEqual([]);
  });
});
```

- [ ] **Step 7: Run the test**

Run: `cd server && pnpm exec vitest run test/contracts.test.ts`
Expected: PASS (it fails before Step 4 with "SkillWithUsage is not exported").

- [ ] **Step 8: Type-check both packages**

Run: `cd server && pnpm typecheck` then `cd client && pnpm typecheck`
Expected: no errors in either.

- [ ] **Step 9: Commit**

```bash
git add server/src/db client/src/vendor/shared server/src/vendor/shared server/test/contracts.test.ts
git commit -m "feat(skills): version summaries + skill DTO contracts"
```

---

### Task 2: Skills repository, service and CRUD routes

The module skeleton and everything that is plain create/read/update/delete.
Versions and stats land in Tasks 3 and 4.

**Files:**
- Create: `server/src/modules/skills/constants.ts`
- Create: `server/src/modules/skills/helpers.ts`
- Create: `server/src/modules/skills/repository.ts`
- Create: `server/src/modules/skills/service.ts`
- Create: `server/src/modules/skills/routes.ts`
- Modify: `server/src/modules/index.ts`
- Modify: `server/src/platform/container.ts`
- Test: `server/test/skills.it.test.ts`

**Interfaces:**
- Consumes: `SkillRow`, `SkillVersionRow`, `SkillWithUsage` (Task 1).
- Produces:
  - `class SkillsRepository { constructor(db: Db); list(workspaceId): Promise<{skill: SkillRow; agentCount: number}[]>; getById(workspaceId, id): Promise<SkillRow | undefined>; findByName(workspaceId, name): Promise<SkillRow | undefined>; insert(values: InsertSkill): Promise<SkillRow>; update(workspaceId, id, patch: UpdateSkill, summary?: string): Promise<SkillRow | undefined>; deleteById(workspaceId, id): Promise<boolean>; }`
  - `class SkillsService { constructor(repo: SkillsRepository); list(workspaceId): Promise<SkillWithUsage[]>; get(workspaceId, id): Promise<Skill | undefined>; create(workspaceId, input: CreateSkillInput): Promise<Skill>; update(workspaceId, id, patch: UpdateSkillInput): Promise<Skill | undefined>; delete(workspaceId, id): Promise<boolean>; }`
  - `container.skillsRepo: SkillsRepository`
  - `toSkillDto(row: SkillRow): Skill`, `isBodyChange(existing, patch): boolean`

- [ ] **Step 1: Write the failing integration test**

Create `server/test/skills.it.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/** CRUD over /skills. Versioning lives in the version tests below it. */
d('/skills CRUD', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const body = (over: Record<string, unknown> = {}) => ({
    name: `rubric-${Math.random().toString(36).slice(2, 8)}`,
    description: 'Rubric for overall PR quality',
    type: 'rubric',
    body: '# PR Quality Rubric\nBe specific.',
    ...over,
  });

  it('creates a skill at version 1 with source=manual', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/skills', payload: body() });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ version: 1, source: 'manual', enabled: true });
    await app.close();
  });

  it('lists skills with an agent_count of 0 when nothing links them', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: body() });
    const list = await app.inject({ method: 'GET', url: '/skills' });
    expect(list.statusCode).toBe(200);
    const row = list.json().find((s: { id: string }) => s.id === created.json().id);
    expect(row.agent_count).toBe(0);
    await app.close();
  });

  it('rejects a duplicate name in the same workspace, case-insensitively', async () => {
    const app = await makeApp();
    const payload = body({ name: 'no-then-chains' });
    expect((await app.inject({ method: 'POST', url: '/skills', payload })).statusCode).toBe(201);
    const dup = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { ...payload, name: 'No-Then-Chains' },
    });
    expect(dup.statusCode).toBe(422);
    await app.close();
  });

  it('rejects a body over the character limit', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: body({ body: 'x'.repeat(20_001) }),
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('patches name and description without touching version', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: body() })).json().id;
    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { description: 'Tightened', enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ description: 'Tightened', enabled: false, version: 1 });
    await app.close();
  });

  it('deletes a skill and 404s afterwards', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: body() })).json().id;
    expect((await app.inject({ method: 'DELETE', url: `/skills/${id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/skills/${id}` })).statusCode).toBe(404);
    await app.close();
  });

  it('404s on an unknown id and 422s on a non-uuid id', async () => {
    const app = await makeApp();
    const ghost = '00000000-0000-0000-0000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/skills/${ghost}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/skills/not-a-uuid' })).statusCode).toBe(422);
    await app.close();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && pnpm exec vitest run test/skills.it.test.ts`
Expected: FAIL — every request 404s, because no `skills` module is registered.
(If Docker is unavailable the suite self-skips; start Docker, this task cannot be
verified without it.)

- [ ] **Step 3: Write the constants**

Create `server/src/modules/skills/constants.ts`:

```ts
/** Skill field limits. Enforced at the route so nothing is truncated later. */
export const MAX_SKILL_NAME_CHARS = 80;
export const MAX_SKILL_DESCRIPTION_CHARS = 300;
export const MAX_SKILL_BODY_CHARS = 20_000;
export const MAX_SKILL_SUMMARY_CHARS = 120;

export const INITIAL_SKILL_VERSION = 1;
```

- [ ] **Step 4: Write the helpers**

Create `server/src/modules/skills/helpers.ts`:

```ts
import type { Skill, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';

/**
 * Pure helpers for the skills module — row ⇄ DTO mapping and the version-bump
 * rule. Row types come from db/rows.ts, not from repository.ts: importing them
 * from the repository would close a type-only cycle that `no-circular` fails on.
 */

export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    summary: row.summary,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * Only a changed `body` creates a new version. Renames, retypes, description
 * edits and the enabled toggle do not — `skill_versions` stores bodies, so a
 * version with an identical body would carry no information.
 */
export function isBodyChange(existing: { body: string }, patch: { body?: string }): boolean {
  return patch.body !== undefined && patch.body !== existing.body;
}
```

- [ ] **Step 5: Write the repository**

Create `server/src/modules/skills/repository.ts`:

```ts
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';
import { isBodyChange } from './helpers.js';

/**
 * Skills data-access. Owns `skills`, `skill_versions`, and the SKILL side of
 * `agent_skills` (which agents use this skill). The AGENT side — link, reorder,
 * list-for-one-agent — belongs to AgentsRepository. Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
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
        and(
          eq(t.skills.workspaceId, workspaceId),
          sql`lower(${t.skills.name}) = lower(${name})`,
        ),
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
        source: 'manual',
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_SKILL_VERSION, null);
    return row!;
  }

  /**
   * Patch a skill. A changed `body` bumps the version and snapshots it with the
   * caller's `summary`; every other field is a plain update. A summary sent
   * without a body change is dropped — there is no version for it to describe.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
    summary?: string,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = isBodyChange(existing, patch);
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row) await this.snapshotVersion(row, nextVersion, summary ?? null);
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  private async snapshotVersion(
    row: SkillRow,
    version: number,
    summary: string | null,
  ): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId: row.id, version, summary, body: row.body })
      .onConflictDoNothing();
  }
}
```

- [ ] **Step 6: Write the service**

Create `server/src/modules/skills/service.ts`:

```ts
import type { Skill, SkillType, SkillWithUsage } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import type { SkillsRepository } from './repository.js';
import { toSkillDto } from './helpers.js';

/**
 * Skills business logic. A skill is reusable prompt text: many agents can link
 * the same one, and editing it changes every review that uses it.
 *
 * Takes its repository, NOT the Container — a service that imports the
 * composition root closes an import cycle (see server/INSIGHTS.md).
 */

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  /** Note attached to the version this save creates; ignored if body is unchanged. */
  summary?: string;
}

export class SkillsService {
  constructor(private repo: SkillsRepository) {}

  async list(workspaceId: string): Promise<SkillWithUsage[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map((r) => ({ ...toSkillDto(r.skill), agent_count: r.agentCount }));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    await this.assertNameFree(workspaceId, input.name);
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      body: input.body,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    if (patch.name !== undefined) await this.assertNameFree(workspaceId, patch.name, id);
    const row = await this.repo.update(
      workspaceId,
      id,
      {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      },
      patch.summary,
    );
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** Names are how a user identifies a skill in the agent editor — keep them unique. */
  private async assertNameFree(workspaceId: string, name: string, exceptId?: string) {
    const clash = await this.repo.findByName(workspaceId, name);
    if (clash && clash.id !== exceptId) {
      throw new ValidationError(`A skill named "${name}" already exists`);
    }
  }
}
```

- [ ] **Step 7: Write the routes**

Create `server/src/modules/skills/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsService } from './service.js';
import {
  MAX_SKILL_BODY_CHARS,
  MAX_SKILL_DESCRIPTION_CHARS,
  MAX_SKILL_NAME_CHARS,
  MAX_SKILL_SUMMARY_CHARS,
} from './constants.js';

/**
 * Skills module — the reusable rule library shared by agents.
 *   GET    /skills        → list (workspace-scoped, with agent_count)
 *   GET    /skills/:id    → one skill
 *   POST   /skills        → create (source is always 'manual')
 *   PUT    /skills/:id    → patch; a changed body versions the skill
 *   DELETE /skills/:id    → delete (agent links cascade)
 */

const name = z.string().min(1).max(MAX_SKILL_NAME_CHARS);
const description = z.string().max(MAX_SKILL_DESCRIPTION_CHARS);
const body = z.string().min(1).max(MAX_SKILL_BODY_CHARS);
const summary = z.string().max(MAX_SKILL_SUMMARY_CHARS);

const CreateSkillBody = z.object({
  name,
  description: description.optional(),
  type: SkillType,
  body,
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: name.optional(),
  description: description.optional(),
  type: SkillType.optional(),
  body: body.optional(),
  enabled: z.boolean().optional(),
  summary: summary.optional(),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container.skillsRepo);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const input = req.body;
    const skill = await service.create(workspaceId, {
      name: input.name,
      description: input.description ?? '',
      type: input.type,
      body: input.body,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    });
    reply.status(201);
    return skill;
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.update(workspaceId, req.params.id, req.body);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });
}
```

- [ ] **Step 8: Add the container getter**

In `server/src/platform/container.ts`: add the import next to the other module
repositories (`import { SkillsRepository } from '../modules/skills/repository.js';`),
the private field next to `_agentsRepo` (`private _skillsRepo?: SkillsRepository;`),
and the getter directly after `agentsRepo`:

```ts
  get skillsRepo(): SkillsRepository {
    return (this._skillsRepo ??= new SkillsRepository(this.db));
  }
```

- [ ] **Step 9: Register the module**

In `server/src/modules/index.ts` add `import skills from './skills/routes.js';`
and the `skills,` entry in the exported `modules` object (after `agents,`).

- [ ] **Step 10: Run the tests**

Run: `cd server && pnpm exec vitest run test/skills.it.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 11: Run the gates**

Run: `cd server && pnpm typecheck && pnpm arch:check`
Expected: no type errors; `arch:check` reports no *new* violations. If it flags
the skills module, the fix is structural (row types from `db/rows.ts`, service
takes the repository) — never regenerate the known-violations baseline.

- [ ] **Step 12: Commit**

```bash
git add server/src/modules/skills server/src/modules/index.ts server/src/platform/container.ts server/test/skills.it.test.ts
git commit -m "feat(server): skills module with workspace-scoped CRUD"
```

---

### Task 3: Version history and restore

**Files:**
- Modify: `server/src/modules/skills/repository.ts`
- Modify: `server/src/modules/skills/service.ts`
- Modify: `server/src/modules/skills/routes.ts`
- Test: `server/test/skills.it.test.ts`

**Interfaces:**
- Consumes: `SkillsRepository`, `SkillsService`, `toSkillVersionDto` (Task 2).
- Produces: `SkillsRepository.listVersions(skillId)`, `.getVersion(skillId, version)`;
  `SkillsService.listVersions(workspaceId, id): Promise<SkillVersion[] | undefined>`,
  `.getVersion(...)`, `.restore(workspaceId, id, version): Promise<Skill | undefined>`;
  routes `GET /skills/:id/versions` and `POST /skills/:id/versions/:version/restore`.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/skills.it.test.ts`, inside a second `d(...)` block that
reuses the same fixture setup (copy the `beforeAll`/`afterAll`/`makeApp`/`body`
helpers into it — the file's two describes are independent):

```ts
d('/skills versioning', () => {
  // …same pg fixture, makeApp() and body() helpers as the CRUD describe…

  it('a body change appends a version carrying the summary; list is newest-first', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: body() })).json().id;

    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { body: '# v2 body', summary: 'Added Tests dimension' },
    });
    expect(res.json().version).toBe(2);

    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({ summary: 'Added Tests dimension', body: '# v2 body' });
    expect(versions[1].summary).toBeNull();
    await app.close();
  });

  it('a rename does not create a version', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: body() })).json().id;
    await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { name: 'renamed-rule' } });
    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions).toHaveLength(1);
    await app.close();
  });

  it('saving an identical body does not create a version', async () => {
    const app = await makeApp();
    const payload = body();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload })).json().id;
    await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: payload.body } });
    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions).toHaveLength(1);
    await app.close();
  });

  it('restore appends a new version with the old body instead of rewinding', async () => {
    const app = await makeApp();
    const payload = body();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload })).json().id;
    await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: '# v2' } });

    const restored = await app.inject({
      method: 'POST',
      url: `/skills/${id}/versions/1/restore`,
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ version: 3, body: payload.body });

    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(versions[0].summary).toBe('Restored from v1');
    await app.close();
  });

  it('404s restoring a version that was never recorded', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: body() })).json().id;
    const res = await app.inject({ method: 'POST', url: `/skills/${id}/versions/99/restore` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd server && pnpm exec vitest run test/skills.it.test.ts -t versioning`
Expected: FAIL — `GET /skills/:id/versions` 404s (no such route).

- [ ] **Step 3: Add the repository reads**

Append to `SkillsRepository` in `server/src/modules/skills/repository.ts`:

```ts
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
```

Add `desc` to the `drizzle-orm` import at the top of the file.

- [ ] **Step 4: Add the service methods**

Append to `SkillsService`, and add `toSkillVersionDto` to the `./helpers.js`
import:

```ts
  /** Version history, newest first. undefined when the skill isn't in this workspace. */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(id);
    return rows.map(toSkillVersionDto);
  }

  /**
   * Restore an old body by APPENDING it as a new version. History is
   * append-only: nothing is rewritten, and the restore itself is auditable.
   */
  async restore(workspaceId: string, id: string, version: number): Promise<Skill | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const snapshot = await this.repo.getVersion(id, version);
    if (!snapshot) return undefined;
    const row = await this.repo.update(
      workspaceId,
      id,
      { body: snapshot.body },
      `Restored from v${version}`,
    );
    return row ? toSkillDto(row) : undefined;
  }
```

Add `SkillVersion` to the type import from `@devdigest/shared`.

- [ ] **Step 5: Add the routes**

Append inside `skillsRoutes` in `server/src/modules/skills/routes.ts`:

```ts
  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.post(
    '/skills/:id/versions/:version/restore',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.restore(workspaceId, req.params.id, req.params.version);
      if (!skill) throw new NotFoundError('Skill or version not found');
      return skill;
    },
  );
```

and the params schema next to the other schemas at the top of the file:

```ts
/** `/skills/:id/versions/:version` — id is a uuid, version a positive integer. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});
```

- [ ] **Step 6: Run the tests**

Run: `cd server && pnpm exec vitest run test/skills.it.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/skills server/test/skills.it.test.ts
git commit -m "feat(server): append-only skill version history with restore"
```

---

### Task 4: Skill usage stats

**Files:**
- Modify: `server/src/modules/skills/repository.ts`
- Modify: `server/src/modules/skills/service.ts`
- Modify: `server/src/modules/skills/routes.ts`
- Test: `server/test/skills.it.test.ts`

**Interfaces:**
- Produces: `SkillsRepository.usage(skillId): Promise<{id: string; name: string; enabled: boolean}[]>`;
  `SkillsService.stats(workspaceId, id): Promise<SkillStats | undefined>`;
  route `GET /skills/:id/stats`.

- [ ] **Step 1: Write the failing test**

Append to the versioning describe block in `server/test/skills.it.test.ts`:

```ts
  it('stats report the agents that link the skill', async () => {
    const app = await makeApp();
    const skillId = (await app.inject({ method: 'POST', url: '/skills', payload: body() })).json().id;

    const empty = await app.inject({ method: 'GET', url: `/skills/${skillId}/stats` });
    expect(empty.json()).toEqual({ agent_count: 0, agents: [] });

    const agentId = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Security Reviewer',
          provider: 'openai',
          model: 'gpt-4o-mini',
          system_prompt: 'Review the diff.',
        },
      })
    ).json().id;
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skillId] },
    });

    const stats = (await app.inject({ method: 'GET', url: `/skills/${skillId}/stats` })).json();
    expect(stats.agent_count).toBe(1);
    expect(stats.agents[0]).toMatchObject({ id: agentId, name: 'Security Reviewer', enabled: true });

    const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(list.find((s: { id: string }) => s.id === skillId).agent_count).toBe(1);
    await app.close();
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd server && pnpm exec vitest run test/skills.it.test.ts -t stats`
Expected: FAIL — 404, no `/skills/:id/stats` route.

- [ ] **Step 3: Add the repository read**

Append to `SkillsRepository`:

```ts
  /** Agents that link this skill, alphabetical. The skill side of agent_skills. */
  async usage(skillId: string): Promise<{ id: string; name: string; enabled: boolean }[]> {
    return this.db
      .select({ id: t.agents.id, name: t.agents.name, enabled: t.agents.enabled })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(eq(t.agentSkills.skillId, skillId))
      .orderBy(asc(t.agents.name));
  }
```

- [ ] **Step 4: Add the service method**

Append to `SkillsService` (add `SkillStats` to the shared type import):

```ts
  /**
   * Everything the Stats tab can honestly report. Accuracy metrics (pull rate,
   * accept rate) would need per-skill attribution on findings, which does not
   * exist — do not invent them here.
   */
  async stats(workspaceId: string, id: string): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const agents = await this.repo.usage(id);
    return { agent_count: agents.length, agents };
  }
```

- [ ] **Step 5: Add the route**

```ts
  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const stats = await service.stats(workspaceId, req.params.id);
    if (!stats) throw new NotFoundError('Skill not found');
    return stats;
  });
```

- [ ] **Step 6: Run the whole server suite**

Run: `cd server && pnpm exec vitest run test/skills.it.test.ts && pnpm typecheck && pnpm arch:check`
Expected: PASS, 13 tests; clean typecheck and arch gate.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/skills server/test/skills.it.test.ts
git commit -m "feat(server): report which agents use a skill"
```

---

### Task 5: Linking skills bumps the agent's version

**Files:**
- Modify: `server/src/modules/agents/repository.ts`
- Test: `server/test/agents-versions.it.test.ts`

**Interfaces:**
- Produces: `AgentsRepository.setSkills` and `.linkSkill` now bump `agents.version`
  and write an `agent_versions` snapshot; both keep their current signatures
  (`setSkills(agentId, skillIds): Promise<void>`, `linkSkill(agentId, skillId, order): Promise<void>`).

- [ ] **Step 1: Write the failing test**

Append to `server/test/agents-versions.it.test.ts`, inside the existing describe:

```ts
  it('changing the linked skill set bumps the agent version and snapshots it', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({ method: 'POST', url: '/agents', payload: createBody })
    ).json().id as string;
    const skillId = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: `rule-${Date.now()}`, type: 'rubric', body: '# rule' },
      })
    ).json().id as string;

    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skillId] },
    });

    const agent = (await app.inject({ method: 'GET', url: `/agents/${agentId}` })).json();
    expect(agent.version).toBe(2);

    const versions = (
      await app.inject({ method: 'GET', url: `/agents/${agentId}/versions` })
    ).json();
    expect(versions[0]).toMatchObject({ version: 2, config: { skills: [skillId] } });
    expect(versions[1].config.skills).toEqual([]);
    await app.close();
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd server && pnpm exec vitest run test/agents-versions.it.test.ts -t "linked skill set"`
Expected: FAIL — `expected 1 to be 2`; linking currently changes nothing about the version.

- [ ] **Step 3: Extract the bump**

In `server/src/modules/agents/repository.ts`, add a private helper below
`snapshotVersion`:

```ts
  /**
   * A change to the linked skill set IS a config change: an agent's behaviour
   * depends on its skills, so "agent v3" has to mean one fixed set of them.
   * Bumps the version and snapshots the new ordered ids.
   */
  private async bumpForSkillChange(agentId: string): Promise<void> {
    const [row] = await this.db
      .update(t.agents)
      .set({ version: sql`${t.agents.version} + 1` })
      .where(eq(t.agents.id, agentId))
      .returning();
    if (row) await this.snapshotVersion(row, row.version);
  }
```

Add `sql` to the `drizzle-orm` import at the top of the file.

- [ ] **Step 4: Call it from both link paths**

At the end of `setSkills` (after the insert, and also on the early-return path
when `skillIds` is empty) and at the end of `linkSkill`, call
`await this.bumpForSkillChange(agentId);`. `setSkills` becomes:

```ts
  async setSkills(agentId: string, skillIds: string[]): Promise<void> {
    await this.db.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
    if (skillIds.length > 0) {
      await this.db
        .insert(t.agentSkills)
        .values(skillIds.map((skillId, i) => ({ agentId, skillId, order: i })));
    }
    await this.bumpForSkillChange(agentId);
  }
```

- [ ] **Step 5: Run the agents suite**

Run: `cd server && pnpm exec vitest run test/agents-versions.it.test.ts`
Expected: PASS — the new test plus the seven that were already there.

- [ ] **Step 6: Commit**

```bash
git add server/src/modules/agents/repository.ts server/test/agents-versions.it.test.ts
git commit -m "feat(server): version an agent when its skill set changes"
```

---

### Task 6: Inject skill bodies into the review prompt

The point of the whole feature.

**Files:**
- Modify: `server/src/modules/reviews/run-executor.ts`
- Test: `server/test/skills-prompt.test.ts` (new, hermetic — no `.it.` suffix)

**Interfaces:**
- Consumes: `container.agentsRepo.linkedSkills(agentId): Promise<{skill: SkillRow; order: number}[]>` (existing).
- Produces: a `skills: string[]` field on the `reviewPullRequest` input when the
  agent has enabled linked skills.

- [ ] **Step 1: Write the failing test**

Create `server/test/skills-prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '@devdigest/reviewer-core';
import { enabledSkillBodies } from '../src/modules/reviews/helpers.js';
// `assemblePrompt` is exported from reviewer-core's index; `PromptAssembly` has
// both a nullish `skills` and a `user` string (vendor/shared/contracts/trace.ts).

/**
 * The skills → prompt contract. `enabledSkillBodies` is the pure selector the
 * run executor feeds to reviewer-core; the assembly assertions pin the section
 * it produces so a future prompt edit cannot silently drop user rules.
 */

const link = (id: string, body: string, enabled: boolean, order: number) => ({
  order,
  skill: {
    id,
    workspaceId: 'ws',
    name: id,
    description: '',
    type: 'rubric' as const,
    source: 'manual' as const,
    body,
    enabled,
    version: 1,
    evidenceFiles: null,
    createdAt: new Date(),
  },
});

describe('enabledSkillBodies', () => {
  it('keeps link order and drops globally disabled skills', () => {
    const bodies = enabledSkillBodies([
      link('first', '# First', true, 0),
      link('off', '# Off', false, 1),
      link('second', '# Second', true, 2),
    ]);
    expect(bodies).toEqual(['# First', '# Second']);
  });

  it('returns an empty array when nothing is linked', () => {
    expect(enabledSkillBodies([])).toEqual([]);
  });
});

describe('assembled prompt', () => {
  it('renders the bodies into a Skills / rules section in order', () => {
    const { assembly } = assemblePrompt({
      system: 'You are a reviewer.',
      skills: ['# First', '# Second'],
      diff: 'diff --git a/a.ts b/a.ts',
    });
    expect(assembly.skills).toBe('# First\n\n# Second');
    expect(assembly.user).toContain('## Skills / rules');
    expect(assembly.user.indexOf('# First')).toBeLessThan(assembly.user.indexOf('# Second'));
  });

  it('omits the section entirely when there are no skills', () => {
    const { assembly } = assemblePrompt({
      system: 'You are a reviewer.',
      skills: [],
      diff: 'diff --git a/a.ts b/a.ts',
    });
    expect(assembly.skills).toBeNull();
    expect(assembly.user).not.toContain('## Skills / rules');
  });
});
```

> Do not add a `skills` field to `reviewer-core` — `ReviewInput.skills` and the
> `## Skills / rules` rendering already exist
> ([`reviewer-core/src/prompt.ts:109`](../../../reviewer-core/src/prompt.ts)).
> This test pins that behaviour; it does not create it.

- [ ] **Step 2: Run and watch it fail**

Run: `cd server && pnpm exec vitest run test/skills-prompt.test.ts`
Expected: FAIL — `enabledSkillBodies` is not exported from the reviews helpers.

- [ ] **Step 3: Add the selector**

In `server/src/modules/reviews/helpers.ts`:

```ts
/**
 * A linked skill as far as the prompt cares. Declared structurally rather than
 * imported from `agents/repository.ts`: `tsPreCompilationDeps` makes even a
 * type-only cross-module import visible to `no-cross-module-internals`, and the
 * call site type-checks against `LinkedSkillRow` regardless.
 */
export interface PromptSkillLink {
  skill: { enabled: boolean; body: string };
}

/**
 * The skill bodies that go into a review prompt: link order (the repository
 * already sorts by `agent_skills.order`), globally disabled skills removed.
 * Pure — the executor does the I/O.
 */
export function enabledSkillBodies(links: PromptSkillLink[]): string[] {
  return links.filter((l) => l.skill.enabled).map((l) => l.skill.body);
}
```

- [ ] **Step 4: Wire it into the executor**

In `server/src/modules/reviews/run-executor.ts`, just above the
`const task = taskLine(pull) + rankNote;` line:

```ts
      // Linked skills — the user's reusable rules, in the order set in the agent
      // editor. Unlike repo-intel this is NOT best-effort: reviewing without the
      // rules the user configured is worse than failing the run.
      const skills = enabledSkillBodies(await this.container.agentsRepo.linkedSkills(agent.id));
      if (skills.length > 0) runLog.info(`Injecting ${skills.length} linked skill(s) into the prompt`);
```

and inside the `reviewPullRequest({ … })` call, next to the other optional
sections:

```ts
        // Reusable skill bodies. Trusted instructions (manual source only), so
        // they are NOT delimiter-wrapped; assemblePrompt omits the section when
        // the array is empty.
        ...(skills.length > 0 ? { skills } : {}),
```

Add `enabledSkillBodies` to the existing import from `./helpers.js`.

- [ ] **Step 5: Run the tests**

Run: `cd server && pnpm exec vitest run test/skills-prompt.test.ts && pnpm exec vitest run --exclude '**/*.it.test.ts'`
Expected: PASS — the new file plus the whole hermetic lane.

- [ ] **Step 6: Verify the gates**

Run: `cd server && pnpm typecheck && pnpm arch:check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/reviews server/test/skills-prompt.test.ts
git commit -m "feat(reviews): put an agent's linked skills into its prompt"
```

---

### Task 7: Client dependencies and data hooks

**Files:**
- Modify: `client/package.json` (via pnpm)
- Create: `client/src/lib/hooks/skills.ts`
- Modify: `client/src/lib/hooks/agents.ts`
- Modify: `client/src/lib/hooks/index.ts`

**Interfaces:**
- Produces: `useSkills()`, `useSkill(id)`, `useSkillVersions(id)`, `useSkillStats(id)`,
  `useCreateSkill()`, `useUpdateSkill()`, `useDeleteSkill()`, `useRestoreSkillVersion()`,
  `useAgentSkills(agentId)`, `useSetAgentSkills()`.
  Query keys: `["skills"]`, `["skill", id]`, `["skill-versions", id]`,
  `["skill-stats", id]`, `["agent-skills", agentId]`.

- [ ] **Step 1: Install the dependencies**

Run: `cd client && pnpm add diff @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities && pnpm add -D @types/diff`
Expected: only `pnpm-lock.yaml` changes besides `package.json`. If a
`package-lock.json` appears, delete it — this package is pnpm.

- [ ] **Step 2: Write the skills hooks**

Create `client/src/lib/hooks/skills.ts`:

```ts
/* hooks/skills.ts — React Query hooks for the Skills screen and the agent
   editor's Skills tab. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Skill, SkillStats, SkillType, SkillVersion, SkillWithUsage } from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<SkillWithUsage[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

export function useSkillStats(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-stats", id],
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">> & {
    summary?: string;
  };
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.post<Skill>(`/skills/${id}/versions/${version}/restore`),
    onSuccess: (data) => {
      qc.setQueryData(["skill", data.id], data);
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
```

- [ ] **Step 3: Add the agent-side link hooks**

Append to `client/src/lib/hooks/agents.ts`:

```ts
/** The ordered skill links of one agent (Skills tab). */
export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/**
 * Replace an agent's linked skills with `skillIds`, in that exact order. The
 * server treats this as a config change, so the agent's version bumps — that is
 * why `agent` and `agents` are invalidated too.
 */
export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }: { agentId: string; skillIds: string[] }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: (_d, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
```

Add `AgentSkillLink` to the type import at the top of that file.

- [ ] **Step 4: Re-export**

Add `export * from "./skills";` to `client/src/lib/hooks/index.ts`, matching the
existing lines.

- [ ] **Step 5: Type-check**

Run: `cd client && pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add client/package.json client/pnpm-lock.yaml client/src/lib/hooks
git commit -m "feat(client): data hooks for skills and agent skill links"
```

---

### Task 8: The `/skills` list screen

**Files:**
- Create: `client/src/app/skills/layout.tsx`
- Create: `client/src/app/skills/page.tsx`
- Create: `client/src/app/skills/_components/SkillsListView/{SkillsListView.tsx,constants.ts,helpers.ts,styles.ts,index.ts}`
- Create: `client/src/app/skills/_components/SkillsListView/_components/SkillCard/{SkillCard.tsx,SkillCard.test.tsx,styles.ts,index.ts}`
- Create: `client/src/app/skills/_components/SkillsListView/_components/CreateSkillModal/{CreateSkillModal.tsx,CreateSkillModal.test.tsx,constants.ts,styles.ts,index.ts}`
- Modify: `client/messages/en/skills.json`
- Modify: `client/src/vendor/ui/nav.ts`

**Interfaces:**
- Consumes: `useSkills`, `useUpdateSkill`, `useDeleteSkill`, `useCreateSkill` (Task 7).
- Produces: `<SkillsListView activeId?: string />`, `<SkillCard skill: SkillWithUsage; active?: boolean; onClick?: () => void; onToggle?: (enabled: boolean) => void />`,
  `<CreateSkillModal open: boolean; onClose: () => void; onCreated: (id: string) => void />`.

- [ ] **Step 1: Write the failing SkillCard test**

Create `SkillCard.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SkillWithUsage } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL: SkillWithUsage = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Rubric for overall PR quality",
  type: "rubric",
  source: "manual",
  body: "# PR Quality Rubric",
  enabled: true,
  version: 5,
  evidence_files: null,
  agent_count: 3,
};

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SkillCard", () => {
  it("renders name, type badge and how many agents use it", () => {
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("3 agents")).toBeInTheDocument();
  });

  it("says 'Not used yet' when no agent links it", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, agent_count: 0 }} />);
    expect(screen.getByText("Not used yet")).toBeInTheDocument();
  });

  it("reports toggle changes to the parent", () => {
    const onToggle = vi.fn();
    renderWithIntl(<SkillCard skill={SKILL} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});
```

> Check the vendored `Toggle` ([`src/vendor/ui/primitives/Toggle.tsx`](../../../client/src/vendor/ui/primitives/Toggle.tsx))
> for the role/attributes it actually renders and adjust the query in the third
> test to match — do not change the primitive.

- [ ] **Step 2: Run and watch it fail**

Run: `cd client && pnpm exec vitest run src/app/skills`
Expected: FAIL — cannot resolve `./SkillCard`.

- [ ] **Step 3: Add the copy**

Add to `client/messages/en/skills.json` — a `card` block and two `page` keys,
leaving the existing `url.*` / `community.*` blocks untouched:

```json
  "card": {
    "agentCount": "{count, plural, one {# agent} other {# agents}}",
    "unused": "Not used yet",
    "noDescription": "No description",
    "deleteConfirm": "Delete skill \"{name}\"? Agents using it lose the rule.",
    "deleteTitle": "Delete skill"
  },
```

and inside `page`, replace the `menu` block with the two sources that exist:

```json
    "menu": {
      "manual": "Create manually",
      "fromFile": "Import from file"
    },
```

- [ ] **Step 4: Write SkillCard**

`SkillCard.tsx` mirrors
[`AgentCard.tsx`](../../../client/src/app/agents/_components/AgentCard/AgentCard.tsx):
an `Icon.Sparkles` box, the name, a `Toggle` (stop propagation on its wrapper),
a delete button guarded by `window.confirm` using `card.deleteConfirm`, the
description (falling back to `card.noDescription`), and a meta row with a `Badge`
per `type` and `source` plus the agent count (`card.agentCount`, or `card.unused`
when zero). All colours and spacing go in `styles.ts` as an `s` object of
`CSSProperties`, copied in spirit from `AgentCard/styles.ts`. Type colours live in
`constants.ts` as a `Record<SkillType, string>` of CSS variables.

- [ ] **Step 5: Run the SkillCard test**

Run: `cd client && pnpm exec vitest run src/app/skills`
Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing CreateSkillModal test**

Create `CreateSkillModal.test.tsx` with the same `renderWithIntl` helper:

```tsx
describe("CreateSkillModal", () => {
  it("blocks submit until name and body are filled", () => {
    renderWithIntl(<CreateSkillModal open onClose={() => {}} onCreated={() => {}} />);
    expect(screen.getByRole("button", { name: /import skill|create/i })).toBeDisabled();
  });

  it("fills the body from a dropped markdown file", async () => {
    renderWithIntl(<CreateSkillModal open onClose={() => {}} onCreated={() => {}} />);
    const file = new File(["# From file"], "rule.md", { type: "text/markdown" });
    const input = screen.getByLabelText(/import from file/i);
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByDisplayValue("# From file")).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Write CreateSkillModal**

Compose the vendored `Modal`, `FormField`, `TextInput`, `Textarea`,
`SelectInput` and `Button`. Fields: name, description, type (the four
`SkillType` values from `listItem.type.*`), body. A `<input type="file"
accept=".md,text/markdown">` reads the file with `file.text()` and sets the body
state — the file never leaves the browser, and the name field defaults to the
file's basename when empty. Submit calls `useCreateSkill().mutate` and, on
success, `onCreated(skill.id)`. Show `drawer.importFailed` plus the `ApiError`
message on failure. The 20 000-character limit is mirrored client-side as a
counter and a disabled submit, so the user sees it before the 422.

- [ ] **Step 8: Write SkillsListView, the layout and the empty page**

`SkillsListView.tsx`: heading (`page.heading`), a `Dropdown` "Add Skill" trigger
with the two menu entries (both open `CreateSkillModal`; the file entry focuses
the file input), a `TextInput` search box filtering by name and description in a
`helpers.ts` `filterSkills(skills, query)`, then a `SkillCard` per skill. States:
`Skeleton` while loading, `ErrorState` with `page.loadError` and a retry on
error, `EmptyState` with `page.empty.*` when the list is empty. Toggling a card
calls `useUpdateSkill`. Clicking a card routes to `/skills/${id}` preserving the
current `?tab=`.

`layout.tsx` renders `AppShell` with the crumb `[{label: page.crumbLab},
{label: page.crumbSkills, href: "/skills"}]`, the fixed-width left column
containing `<SkillsListView activeId={…} />`, and `{children}` beside it — copy
the flex shell from
[`app/agents/[id]/page.tsx`](../../../client/src/app/agents/[id]/page.tsx#L55).
`page.tsx` renders an `EmptyState` from `page.selectPrompt.*`.

- [ ] **Step 9: Add the nav entry**

In `client/src/vendor/ui/nav.ts`, move the Agents item into a new section and add
Skills above it:

```ts
  {
    section: "SKILLS LAB",
    items: [
      { key: "skills", label: "Skills", icon: "Sparkles", href: "/skills", gKey: "s" },
      { key: "agents", label: "Agents", icon: "Cpu", href: "/agents", gKey: "a" },
    ],
  },
```

and add `{ keys: "g s", label: "Go to Skills", group: "Navigation" }` to
`SHORTCUTS`. `app-shell/helpers.ts` already maps `/skills` to the `skills` key —
leave it alone.

- [ ] **Step 10: Run the client suite and typecheck**

Run: `cd client && pnpm test && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 11: Commit**

```bash
git add client/src/app/skills client/src/vendor/ui/nav.ts client/messages/en/skills.json
git commit -m "feat(client): skills library list screen"
```

---

### Task 9: The detail pane — Config and Preview tabs

**Files:**
- Create: `client/src/app/skills/[id]/page.tsx`
- Create: `client/src/app/skills/[id]/_components/SkillDetail/{SkillDetail.tsx,constants.ts,styles.ts,index.ts}`
- Create: `.../SkillDetail/_components/ConfigTab/{ConfigTab.tsx,ConfigTab.test.tsx,styles.ts,index.ts}`
- Create: `.../SkillDetail/_components/PreviewTab/{PreviewTab.tsx,styles.ts,index.ts}`
- Modify: `client/messages/en/skills.json`

**Interfaces:**
- Consumes: `useSkill`, `useUpdateSkill` (Task 7).
- Produces: `<SkillDetail skill: Skill; tab: string; onTab: (t: string) => void />`,
  `TABS: readonly {key: string; labelKey: string; icon: IconName}[]` with keys
  `config | preview | stats | versions`.

- [ ] **Step 1: Write the failing ConfigTab test**

```tsx
describe("ConfigTab", () => {
  it("marks the body as unsaved once it is edited", () => {
    renderWithIntl(<ConfigTab skill={SKILL} />);
    fireEvent.change(screen.getByLabelText(/skill body/i), { target: { value: "# changed" } });
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });

  it("saves name, body and the change note together", async () => {
    const put = vi.fn().mockResolvedValue({ ...SKILL, body: "# changed", version: 6 });
    vi.stubGlobal("fetch", makeFetchMock(put));
    renderWithIntl(<ConfigTab skill={SKILL} />);
    fireEvent.change(screen.getByLabelText(/skill body/i), { target: { value: "# changed" } });
    fireEvent.change(screen.getByLabelText(/change note/i), { target: { value: "Tightened" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][1]).toMatchObject({ body: "# changed", summary: "Tightened" });
  });
});
```

> `makeFetchMock` is a local helper in the test file: return
> `{ ok: true, status: 200, json: async () => …, statusText: "OK" }` and record
> `(url, JSON.parse(init.body))`. The client's `apiFetch` is the only thing that
> touches `fetch`, so mocking it is enough — there is no MSW here.

- [ ] **Step 2: Run and watch it fail**

Run: `cd client && pnpm exec vitest run src/app/skills`
Expected: FAIL — no `ConfigTab` module.

- [ ] **Step 3: Add the copy**

```json
  "config": {
    "heading": "Configuration",
    "nameLabel": "Name",
    "descriptionLabel": "Description",
    "typeLabel": "Type",
    "bodyLabel": "Skill body",
    "bodyHint": "Markdown. Sent to the reviewing agent exactly as written.",
    "summaryLabel": "Change note",
    "summaryHint": "Optional — shown in the version history.",
    "unsaved": "unsaved",
    "chars": "{count} / {max} characters",
    "save": "Save",
    "saving": "Saving…",
    "saveFailed": "Could not save this skill.",
    "enabled": "Enabled"
  },
  "previewTab": {
    "heading": "Preview",
    "subtitle": "Rendered as the reviewing agent receives it."
  },
```

- [ ] **Step 4: Write ConfigTab**

Local state seeded from the `skill` prop, reset by a `useEffect` on `skill.id`.
Fields: name, description, type, enabled toggle, body `Textarea`, change-note
`TextInput`. An `unsaved` badge appears when any field differs from the prop. The
character counter uses `config.chars` and disables Save past 20 000. Save calls
`useUpdateSkill().mutate` with only the changed fields plus `summary` when the
body changed; on error render `config.saveFailed` inline with the `ApiError`
message.

- [ ] **Step 5: Write PreviewTab**

Render the body through the vendored `Markdown` primitive
([`src/vendor/ui/primitives/Markdown.tsx`](../../../client/src/vendor/ui/primitives/Markdown.tsx))
inside a bordered surface, with `previewTab.heading` / `previewTab.subtitle`
above it. An empty body shows `EmptyState`. Do not add another Markdown renderer.

- [ ] **Step 6: Write SkillDetail and the route**

`constants.ts` holds `TABS` (`config` → `Settings`, `preview` → `Eye`, `stats` →
`BarChart`, `versions` → `History`) with `labelKey`s under the `skills`
namespace; add a `detail.tabs.*` block to the messages. `SkillDetail.tsx` renders
the header (`Icon.Sparkles`, the name, a type `Badge`, a `v{n}` `Badge` from
`preview.version`) and the vendored `Tabs`, then switches on `tab`. Stats and
Versions are wired in Tasks 10–11; until then render `null` for those keys.

`[id]/page.tsx` mirrors
[`agents/[id]/page.tsx`](../../../client/src/app/agents/[id]/page.tsx): read
`useParams`, read/write the tab in `?tab=` with `router.replace`, `Skeleton`
while loading, `ErrorState` with `detail.loadError` on failure, and
`detail.notFound.*` for a 404.

- [ ] **Step 7: Run the tests and typecheck**

Run: `cd client && pnpm test && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add client/src/app/skills client/messages/en/skills.json
git commit -m "feat(client): skill config editor and markdown preview"
```

---

### Task 10: The Versions tab with diff and restore

**Files:**
- Create: `.../SkillDetail/_components/VersionsTab/{VersionsTab.tsx,VersionsTab.test.tsx,helpers.ts,helpers.test.ts,styles.ts,index.ts}`
- Create: `.../VersionsTab/_components/DiffView/{DiffView.tsx,styles.ts,index.ts}`
- Modify: `.../SkillDetail/SkillDetail.tsx`
- Modify: `client/messages/en/skills.json`

**Interfaces:**
- Consumes: `useSkillVersions`, `useRestoreSkillVersion` (Task 7); `diffLines` from `diff`.
- Produces: `<VersionsTab skill: Skill />`, `<DiffView from: string; to: string />`,
  `toDiffRows(from: string, to: string): {kind: "add" | "del" | "ctx"; text: string}[]`.

- [ ] **Step 1: Write the failing helper test**

`helpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toDiffRows } from "./helpers";

describe("toDiffRows", () => {
  it("marks added and removed lines and keeps context", () => {
    const rows = toDiffRows("a\nb\n", "a\nc\n");
    expect(rows).toEqual([
      { kind: "ctx", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "c" },
    ]);
  });

  it("returns only context rows for identical bodies", () => {
    expect(toDiffRows("same\n", "same\n").every((r) => r.kind === "ctx")).toBe(true);
  });

  it("handles an empty previous body", () => {
    expect(toDiffRows("", "new\n")).toEqual([{ kind: "add", text: "new" }]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd client && pnpm exec vitest run src/app/skills`
Expected: FAIL — no `toDiffRows`.

- [ ] **Step 3: Write the helper**

```ts
import { diffLines } from "diff";

export type DiffRowKind = "add" | "del" | "ctx";
export interface DiffRow {
  kind: DiffRowKind;
  text: string;
}

/** Flatten a line diff into renderable rows. Trailing blank lines are dropped. */
export function toDiffRows(from: string, to: string): DiffRow[] {
  return diffLines(from, to).flatMap((part) => {
    const kind: DiffRowKind = part.added ? "add" : part.removed ? "del" : "ctx";
    return part.value
      .split("\n")
      .filter((line, i, all) => !(line === "" && i === all.length - 1))
      .map((text) => ({ kind, text }));
  });
}
```

- [ ] **Step 4: Add the copy**

```json
  "versions": {
    "heading": "Version history",
    "count": "{count, plural, one {# version} other {# versions}}",
    "subtitle": "Every save snapshots the body, so a review can be traced to the exact text it ran on.",
    "current": "Current",
    "diff": "Diff",
    "hideDiff": "Hide diff",
    "restore": "Restore",
    "restoring": "Restoring…",
    "restoreConfirm": "Restore v{version}? This adds a new version with that body.",
    "restoreFailed": "Could not restore this version.",
    "noSummary": "No change note",
    "loadError": "Could not load the version history."
  },
```

- [ ] **Step 5: Write the failing VersionsTab test**

```tsx
describe("VersionsTab", () => {
  it("marks the newest version Current and gives it no Restore button", () => {
    renderWithVersions([v(2, "Tightened"), v(1, null)]);
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /restore/i })).toHaveLength(1);
  });

  it("toggles a diff open for an older version", () => {
    renderWithVersions([v(2, "Tightened"), v(1, null)]);
    fireEvent.click(screen.getByRole("button", { name: /^diff$/i }));
    expect(screen.getByTestId("diff-view")).toBeInTheDocument();
  });
});
```

`renderWithVersions` stubs `fetch` to return the array for
`/skills/sk1/versions`; `v(version, summary)` builds a `SkillVersion` with body
`"# v" + version`.

- [ ] **Step 6: Write VersionsTab and DiffView**

`VersionsTab` renders the heading, `versions.count`, and a row per version:
`v{n}` chip, `summary` or `versions.noSummary`, the date, and the actions. The
newest row shows the `versions.current` badge and no buttons. `Diff` toggles a
`DiffView from={thatVersion.body} to={skill.body}` (rendered with
`data-testid="diff-view"`); `Restore` confirms via `window.confirm` with
`versions.restoreConfirm` and calls `useRestoreSkillVersion`. `DiffView` maps
`toDiffRows` to monospace lines prefixed `+`/`-`/` ` and coloured from CSS
variables in `styles.ts`; it must scroll horizontally on its own
(`overflowX: "auto"`) rather than widening the pane.

- [ ] **Step 7: Wire the tab in and run**

Add the `versions` case to `SkillDetail`'s switch.
Run: `cd client && pnpm test && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add client/src/app/skills client/messages/en/skills.json
git commit -m "feat(client): skill version history with diff and restore"
```

---

### Task 11: The Stats tab

**Files:**
- Create: `.../SkillDetail/_components/StatsTab/{StatsTab.tsx,StatsTab.test.tsx,styles.ts,index.ts}`
- Modify: `.../SkillDetail/SkillDetail.tsx`
- Modify: `client/messages/en/skills.json`

**Interfaces:**
- Consumes: `useSkillStats` (Task 7).
- Produces: `<StatsTab skillId: string />`.

- [ ] **Step 1: Write the failing test**

```tsx
describe("StatsTab", () => {
  it("shows the usage count and links each agent to its editor", async () => {
    stubStats({ agent_count: 2, agents: [
      { id: "a1", name: "Security Reviewer", enabled: true },
      { id: "a2", name: "Performance Reviewer", enabled: false },
    ]});
    renderWithIntl(<StatsTab skillId="sk1" />);
    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Security Reviewer/ })).toHaveAttribute(
      "href",
      "/agents/a1",
    );
    expect(screen.getByText("disabled")).toBeInTheDocument();
  });

  it("shows an empty state when no agent uses the skill", async () => {
    stubStats({ agent_count: 0, agents: [] });
    renderWithIntl(<StatsTab skillId="sk1" />);
    expect(await screen.findByText("Not used by any agent yet")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd client && pnpm exec vitest run src/app/skills`
Expected: FAIL — no `StatsTab` module.

- [ ] **Step 3: Add the copy**

```json
  "stats": {
    "usedBy": "Used by",
    "agentsUnit": "agents",
    "agentsHeading": "Agents using this skill",
    "disabled": "disabled",
    "empty": "Not used by any agent yet",
    "emptyHint": "Attach it from an agent's Skills tab.",
    "loadError": "Could not load usage for this skill."
  },
```

- [ ] **Step 4: Write StatsTab**

One `Card` with the `stats.usedBy` label and the count (the tile layout from the
design, minus the three tiles that have no data), and a second card listing the
agents: name as a `next/link` to `/agents/${id}`, plus a `stats.disabled` badge
for disabled agents. `Skeleton` while loading, `ErrorState` with
`stats.loadError`, `EmptyState` with `stats.empty` / `stats.emptyHint` at zero.
**Do not add** a findings chart, a pull rate, or an accept rate — the data does
not exist, and a plausible-looking fake number is worse than an absent one.

- [ ] **Step 5: Wire the tab in and run**

Add the `stats` case to `SkillDetail`'s switch.
Run: `cd client && pnpm test && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add client/src/app/skills client/messages/en/skills.json
git commit -m "feat(client): show which agents use a skill"
```

---

### Task 12: The agent editor's Skills tab

**Files:**
- Create: `client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/{SkillsTab.tsx,SkillsTab.test.tsx,helpers.ts,helpers.test.ts,styles.ts,index.ts}`
- Create: `.../SkillsTab/_components/SkillRow/{SkillRow.tsx,styles.ts,index.ts}`
- Modify: `client/src/app/agents/[id]/_components/AgentEditor/{AgentEditor.tsx,constants.ts}`
- Modify: `client/src/app/agents/[id]/page.tsx` (`VALID_TABS`)
- Modify: `client/messages/en/agents.json`

**Interfaces:**
- Consumes: `useSkills` (Task 7), `useAgentSkills`, `useSetAgentSkills` (Task 7).
- Produces: `<SkillsTab agent: Agent />`,
  `orderRows(skills: SkillWithUsage[], linkedIds: string[]): {skill: SkillWithUsage; linked: boolean}[]`,
  `moveLinked(linkedIds: string[], from: number, to: number): string[]`.

- [ ] **Step 1: Write the failing helper test**

`helpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { moveLinked, orderRows } from "./helpers";

const sk = (id: string, name: string) => ({ id, name }) as never;

describe("orderRows", () => {
  it("puts linked skills first in link order, then the rest alphabetically", () => {
    const rows = orderRows(
      [sk("c", "charlie"), sk("a", "alpha"), sk("b", "bravo")],
      ["b", "c"],
    );
    expect(rows.map((r) => r.skill.id)).toEqual(["b", "c", "a"]);
    expect(rows.map((r) => r.linked)).toEqual([true, true, false]);
  });

  it("ignores linked ids that no longer exist", () => {
    const rows = orderRows([sk("a", "alpha")], ["ghost", "a"]);
    expect(rows.map((r) => r.skill.id)).toEqual(["a"]);
  });
});

describe("moveLinked", () => {
  it("moves an id to a new index", () => {
    expect(moveLinked(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("is a no-op when the index does not change", () => {
    expect(moveLinked(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd client && pnpm exec vitest run src/app/agents`
Expected: FAIL — no `./helpers` in `SkillsTab`.

- [ ] **Step 3: Write the helpers**

```ts
import type { SkillWithUsage } from "@devdigest/shared";

export interface SkillRowModel {
  skill: SkillWithUsage;
  linked: boolean;
}

/**
 * Linked skills first, in the order the agent stores; unlinked skills after
 * them, alphabetical. Only linked rows have an order to preserve, so the list
 * never has to invent one for the rest.
 */
export function orderRows(skills: SkillWithUsage[], linkedIds: string[]): SkillRowModel[] {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const linked = linkedIds
    .map((id) => byId.get(id))
    .filter((s): s is SkillWithUsage => s !== undefined)
    .map((skill) => ({ skill, linked: true }));
  const linkedSet = new Set(linked.map((r) => r.skill.id));
  const rest = skills
    .filter((s) => !linkedSet.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => ({ skill, linked: false }));
  return [...linked, ...rest];
}

/** Reorder the linked ids by moving one entry. */
export function moveLinked(linkedIds: string[], from: number, to: number): string[] {
  if (from === to) return linkedIds;
  const next = [...linkedIds];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return linkedIds;
  next.splice(to, 0, moved);
  return next;
}
```

- [ ] **Step 4: Add the copy**

Add to `client/messages/en/agents.json` under a new `skillsTab` key:

```json
  "skillsTab": {
    "heading": "Skills",
    "counter": "{linked} of {total} enabled",
    "hint": "Order matters — earlier skills appear earlier in the assembled prompt. Drag to reorder.",
    "filterPlaceholder": "Filter skills…",
    "empty": "No skills in this workspace yet",
    "emptyCta": "Create one in the Skills library",
    "loadError": "Could not load skills.",
    "saveFailed": "Could not save the skill order.",
    "open": "Open"
  },
```

and `"skills": "Skills"` under the existing `editor.tabs` block.

- [ ] **Step 5: Write the failing SkillsTab test**

```tsx
describe("SkillsTab", () => {
  it("counts linked skills and pre-checks them", async () => {
    stubSkillsAndLinks();
    renderWithIntl(<SkillsTab agent={AGENT} />);
    expect(await screen.findByText("1 of 3 enabled")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /pr-quality-rubric/ })).toBeChecked();
  });

  it("posts the full ordered id list when a skill is linked", async () => {
    const post = stubSkillsAndLinks();
    renderWithIntl(<SkillsTab agent={AGENT} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /no-then-chains/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toEqual({ skill_ids: ["sk1", "sk2"] });
  });

  it("posts the shortened list when a skill is unlinked", async () => {
    const post = stubSkillsAndLinks();
    renderWithIntl(<SkillsTab agent={AGENT} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /pr-quality-rubric/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toEqual({ skill_ids: [] });
  });
});
```

`stubSkillsAndLinks` mocks `fetch` for `GET /skills` (three skills: `sk1`
`pr-quality-rubric`, `sk2` `no-then-chains`, `sk3` `secret-leakage-gate`),
`GET /agents/ag1/skills` (`[{agent_id: "ag1", skill_id: "sk1", order: 0}]`), and
records `POST /agents/ag1/skills` bodies.

> Drag-and-drop is **not** covered by these tests: `@dnd-kit` needs pointer
> events jsdom does not deliver. `moveLinked` is tested directly instead — do not
> sink time into simulating a drag.

- [ ] **Step 6: Write SkillsTab and SkillRow**

`SkillsTab` derives `linkedIds` from `useAgentSkills` (sorted by `order`), builds
rows with `orderRows`, and renders: the heading, `skillsTab.counter`, the hint,
a filter `TextInput`, and the rows. Linked rows are wrapped in `@dnd-kit`'s
`SortableContext` with `verticalListSortingStrategy`; `onDragEnd` computes the
new order with `moveLinked` and calls `useSetAgentSkills`. A checkbox change
recomputes the id list (append on check, filter out on uncheck) and posts it.
Optimistic local state is reverted and `skillsTab.saveFailed` shown if the
mutation rejects. `SkillRow` is presentational: drag handle (only for linked
rows), `Checkbox`, name, type `Badge`, and an `Open` link to `/skills/${id}`.

- [ ] **Step 7: Register the tab**

Add `{ key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" }` to
`AgentEditor/constants.ts`, render `<SkillsTab agent={agent} />` for that key in
`AgentEditor.tsx`, and extend `VALID_TABS` in `app/agents/[id]/page.tsx` to
`["config", "skills"]`. Update the stale comment at the top of `AgentEditor.tsx`
— Skills is no longer "a later lesson".

- [ ] **Step 8: Run everything**

Run: `cd client && pnpm test && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 9: Commit**

```bash
git add client/src/app/agents client/messages/en/agents.json
git commit -m "feat(client): attach and reorder skills from the agent editor"
```

---

### Task 13: Specs, docs and the end-to-end check

The feature is only done once the loop is verified in the running app and the
package docs describe it.

**Files:**
- Create: `server/specs/skills.md`
- Create: `client/specs/skills-library.md`
- Modify: `server/README.md` (API map)
- Modify: `client/README.md` (route map)
- Modify: `README.md` (the review flow mentions skills)

- [ ] **Step 1: Write the server spec**

`server/specs/skills.md`, following the shape of the neighbouring specs
(contract, behaviour, degradation, acceptance): the endpoint table from the
design, the "only a body change versions a skill" rule, the append-only restore,
workspace scoping as 404, the field limits, and the prompt-injection contract
(order, disabled skills excluded, not best-effort).

- [ ] **Step 2: Write the client spec**

`client/specs/skills-library.md`: the journey (create → edit → attach → review),
every state per screen (loading / empty / error / saved / unsaved), the data
sources per tab, the ordering model of the agent editor's Skills tab, and the
acceptance checklist. Behaviour only — no class names, no markup.

- [ ] **Step 3: Update the READMEs**

Add the seven `/skills` routes to the API map in `server/README.md`; add
`/skills` and `/skills/:id` to the route map in `client/README.md`; in the root
`README.md`, note in the review flow that an agent's linked skills are prepended
to the prompt as `## Skills / rules`.

- [ ] **Step 4: Run the whole verification set**

```bash
cd server && pnpm typecheck && pnpm arch:check && pnpm exec vitest run --exclude '**/*.it.test.ts'
cd ../server && pnpm test          # DB-backed lane; needs Docker
cd ../client && pnpm typecheck && pnpm test
```

Expected: all green. Report any failure verbatim; do not describe the feature as
working on a red suite.

- [ ] **Step 5: Verify end to end in the running app**

With Postgres up (`docker compose up -d`, never `down -v`), `cd server &&
pnpm db:migrate && pnpm db:seed`, then run the API and the client:

1. Create a skill at `/skills` with a body containing a unique marker sentence.
2. Attach it to an agent from the agent editor's Skills tab; confirm the agent's
   version incremented.
3. Run a review on any imported PR.
4. Open the run trace drawer and confirm the prompt assembly's skills section
   contains the marker sentence.
5. Disable the skill from its card, re-run, and confirm the marker is gone.

- [ ] **Step 6: Record what the work taught**

Invoke the `engineering-insights` skill for anything non-obvious, durable and
actionable that surfaced — append to `server/INSIGHTS.md` and/or
`client/INSIGHTS.md`. Nothing the code or a `CLAUDE.md` already says.

- [ ] **Step 7: Commit and open the PR**

```bash
git add server/specs client/specs server/README.md client/README.md README.md
git commit -m "docs(skills): specs and route/API maps for the skill library"
```

Then run the `pr-self-review` skill before `gh pr create` — the PreToolUse gate
requires it.
