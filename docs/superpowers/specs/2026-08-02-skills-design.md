# Design — Skills: a reusable rule library shared across agents

Date: 2026-08-02
Status: approved, not yet implemented

## Problem

An agent's only lever today is its `system_prompt`. Everything a reviewer should
know — the PR quality rubric, the house conventions, the security gates — has to
be pasted into every agent that needs it, and re-pasted into the next one. There
is no way to change a rule once and have three agents pick it up.

The scaffolding for the answer is already in the repo, unfinished:

- **The tables exist and are empty.** `skills`, `skill_versions`, and
  `agent_skills` (with an `order` column) are defined in
  [`server/src/db/schema/skills.ts`](../../../server/src/db/schema/skills.ts) and
  [`agents.ts`](../../../server/src/db/schema/agents.ts).
- **Half the server is written.** `AgentsRepository` already implements the
  *agent side* of the link table — `linkedSkills`, `setSkills`, `linkSkill`,
  `unlinkSkill` — and `agent_versions.configJson` already snapshots the ordered
  `skills` array. `GET`/`POST /agents/:id/skills` are live.
- **The prompt slot is wired end to end.** `ReviewInput.skills?: string[]` →
  `PromptParts.skills` → a `## Skills / rules` section →
  `PromptAssembly.skills` in the run trace
  ([`reviewer-core/src/prompt.ts`](../../../reviewer-core/src/prompt.ts)).
- **The contracts exist.** `Skill`, `SkillType`, `SkillSource`, `AgentSkillLink`
  in `@devdigest/shared`.
- **The UI copy exists.** [`client/messages/en/skills.json`](../../../client/messages/en/skills.json)
  is a complete catalogue for a screen that was never built, and
  `app-shell/helpers.ts` already maps `/skills` to a nav key.

What is missing is the middle: **no `skills` module on the server, no `/skills`
route on the client, no Skills tab in the agent editor, and
[`run-executor.ts:442`](../../../server/src/modules/reviews/run-executor.ts)
passes `skills: null`** — so even a hand-inserted link would change nothing about
a review.

## Goal

One reusable, versioned, user-editable text rule — a *skill* — that can be
attached to many agents in an explicit order and demonstrably changes what the
reviewer sees. A skill is **text and nothing else**: no tools, no code, no
execution, no fetching. Its whole contract is "these characters end up in the
prompt, in this position".

## Decisions

| Question | Decision |
|---|---|
| Scope | Full vertical slice: skills CRUD + agent linking + prompt injection. A skill that does not reach the model is not shipped. |
| Detail tabs | **Config, Preview, Stats, Versions.** No *Evals* tab and no *Run on evals* button — the `eval_*` tables are empty. |
| Stats content | Only what the data supports: `used by N agents` + the list of those agents. **No** pull-frequency, accept-rate, findings-count, or findings-by-category. |
| Creation sources | Manual form + `.md` file upload (read in the browser into the same body field). `source = 'manual'`. URL import and community search stay unbuilt. |
| Versioning | New `skill_versions.summary` column. Every save of a changed `body` snapshots a version. `Restore` writes a **new** version carrying the old body — history is append-only. |
| Prompt trust | Skill bodies are **trusted instructions**, rendered verbatim into `## Skills / rules`. Not delimiter-wrapped. Justified by `source = 'manual'` being the only source in scope. |
| Agent versioning | Changing an agent's skill set or order **is** a config change: it bumps `agents.version` and writes an `agent_versions` snapshot. |
| New client deps | `diff` (version diffing) and `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (reordering). |

## Out of scope

Import from URL; community skill search; the Evals tab and eval runs; per-skill
attribution of findings (and therefore every accuracy metric on the Stats
screen); skill sharing across workspaces; export/import bundles; any change to
`reviewer-core`.

---

## Architecture

### 1. Migration

One migration, generated via `pnpm db:generate` from a schema edit:

```
skill_versions.summary  text  NULL
```

A short, optional note describing the change ("Tightened scope rule; cap at 5
findings"). When absent, the UI shows the creation date instead. Both tables are
empty, so no backfill.

### 2. Server module `skills`

New module at `server/src/modules/skills/` following the standard layering —
`routes.ts` (HTTP + Zod), `service.ts` (logic), `repository.ts` (the only SQL),
`helpers.ts` (row → DTO), `constants.ts` (limits).

**Onion compliance:** `SkillsService` takes its `SkillsRepository` (constructed
in the container), **not** the `Container`. `arch:check` must stay green without
touching `.dependency-cruiser-known-violations.json`.

**Ownership.** The new repository owns `skills`, `skill_versions`, and the
*skill side* of `agent_skills` — the reverse lookup "which agents use this
skill". The *agent side* (`linkedSkills` / `setSkills` for one agent) stays in
`AgentsRepository`, exactly as its header comment already states. Cross-module
access goes through a new `container.skillsRepo` getter, mirroring `agentsRepo`;
no module imports another module's `repository.ts`.

**Endpoints** (all workspace-scoped via `getContext`; a skill from another
workspace is a 404, never a 403):

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/skills` | List for the workspace, each row carrying `agent_count`. |
| `GET` | `/skills/:id` | One skill. |
| `POST` | `/skills` | `{name, description, type, body, enabled?}` → creates the skill at `version = 1` **and** its `skill_versions` row. `source` is always `'manual'`. 201. |
| `PUT` | `/skills/:id` | Partial patch of `name`, `description`, `type`, `body`, `enabled`, plus an optional `summary` that applies to the version this save creates. |
| `DELETE` | `/skills/:id` | Deletes the skill; `skill_versions` and `agent_skills` rows cascade. Agents that used it silently lose it from their prompt. |
| `GET` | `/skills/:id/versions` | History, newest version first: `{version, summary, created_at, body}`. |
| `POST` | `/skills/:id/versions/:version/restore` | Appends a new version whose body is that of `:version`; returns the updated skill. 404 when the version was never recorded. |
| `GET` | `/skills/:id/stats` | `{agent_count, agents: [{id, name, enabled}]}`. |

**Versioning rule — one rule, no exceptions.** A version is created **only** when
`body` changes. Editing `name`, `description`, or `type`, and toggling `enabled`,
do not bump `version` and do not write a `skill_versions` row. This mirrors
`isConfigChange` on the agents side and matches what `skill_versions` actually
stores. A `summary` sent on a patch that does not change `body` is ignored —
there is no version for it to describe.

**Validation** (rejected at the route with a 400, never truncated later):

- `body`: 1–20 000 characters.
- `name`: 1–80 characters, unique within the workspace (case-insensitive).
- `description`: ≤ 300 characters.
- `summary`: ≤ 120 characters.
- `type`: one of `rubric | convention | security | custom`.

### 3. Agents module change

`setSkills` and `linkSkill` become config-changing operations: each bumps
`agents.version` and writes an `agent_versions` snapshot whose `configJson.skills`
holds the new ordered ids. `AgentsRepository.snapshotVersion` is already private
and already reads the linked skills, so this is an extraction, not a rewrite.

Rationale: without it, "agent v3" means different things before and after someone
drags a skill, and the version history stops being reproducible — which is the
only reason it exists.

### 4. Prompt injection

In [`run-executor.ts`](../../../server/src/modules/reviews/run-executor.ts),
immediately before `reviewPullRequest`:

```ts
const linked = await this.container.agentsRepo.linkedSkills(agent.id);
const skills = linked.filter((l) => l.skill.enabled).map((l) => l.skill.body);
// …
...(skills.length ? { skills } : {}),
```

- Order is `agent_skills.order` ascending — the repository already sorts.
- A globally disabled skill (`skills.enabled = false`) drops out of **every**
  agent's prompt.
- An empty set omits the section entirely; the prompt is byte-identical to
  today's.
- This is **not** best-effort. Unlike repo-intel, a failure here fails the run:
  it is an ordinary database read, and silently reviewing without the user's
  rules is worse than an error.
- The run always uses the **current** skill bodies, not the bodies as of the
  agent's snapshot. `agent_versions` records which skills were linked, not what
  they said.
- `run_traces.prompt_assembly.skills` stops being `null`. The trace drawer
  already renders that field; no client change is needed there.
- `reviewer-core` is not modified.

### 5. Shared contracts

Added to `@devdigest/shared` — **both physical copies**
(`server/src/vendor/shared/contracts/knowledge.ts` and the client's), applied as
identical edits and type-checked on both sides:

- `SkillVersion` — `{version, summary: string | null, created_at, body}`
- `SkillStats` — `{agent_count, agents: {id, name, enabled}[]}`
- `SkillWithUsage` — `Skill` + `agent_count`

### 6. Client — `/skills`

The list stays visible while a skill is open, so the detail pane is a child
segment rather than a separate page:

```
app/skills/layout.tsx     left column (SkillsListView) + {children}
app/skills/page.tsx       "Select a skill" empty state
app/skills/[id]/page.tsx  detail pane; active tab in ?tab=
```

Components follow the folder convention (one folder per component, Tailwind in
`styles.ts`, `_components/` for local children):

- `SkillsListView` — search box, `Add Skill` menu, cards.
  - `SkillCard` — name, description, `type` + `source` badges, enabled toggle,
    `N agents`.
  - `CreateSkillModal` — name, description, type, body, and a `.md` file picker
    that reads the file in the browser into the body field.
- `SkillDetail` — header (name, type chip, `v{n}` chip) + tabs.
  - `ConfigTab` — the editable form and body editor, with an unsaved-changes
    marker and a character counter, plus an optional change-note field.
  - `PreviewTab` — the body through `react-markdown` + `remark-gfm`, framed as
    "rendered as the reviewing agent receives it".
  - `StatsTab` — `Used by N agents` and the list of those agents, each linking
    to its editor. Empty state when nothing uses it.
  - `VersionsTab` — `VersionRow` per version (`v#`, summary or date, `Diff` /
    `Restore`; the newest is marked *Current* and has neither button) and a
    `DiffView` rendering a unified diff against the current body.

Data goes through a new `lib/hooks/skills.ts` (`useSkills`, `useSkill`,
`useSkillVersions`, `useSkillStats`, `useCreateSkill`, `useUpdateSkill`,
`useDeleteSkill`, `useRestoreSkillVersion`) built on `api` from `lib/api.ts`,
with the same `queryKey` shape and explicit `invalidateQueries` as
`hooks/agents.ts`. No `fetch` in a component.

**Navigation.** `@devdigest/ui/nav.ts` gains a `SKILLS LAB` section holding
Skills (icon `Sparkles`, shortcut `g s`); Agents moves into that section, as on
the design. `app-shell/helpers.ts` already maps the route.

**i18n.** `messages/en/skills.json` is reused as-is where it fits (`page.*`,
`detail.*`, `listItem.*`, `preview.*`, `file.*`). Keys for Config/Stats/Versions
are added. The `url.*` and `community.*` blocks stay in place, unused, for the
lesson that builds them.

### 7. Client — the agent editor's Skills tab

A second entry in the editor's `TABS` plus a `SkillsTab` component: a header
counter (`3 of 6 enabled`), a filter box, and the workspace's skills as rows with
a checkbox, a drag handle, a type badge, and a link to `/skills/[id]`.

**Ordering model** — a deliberate deviation from the mock, which shows linked and
unlinked rows interleaved: **linked skills sit at the top in their persisted
order and are the only draggable rows; unlinked skills sit below them,
alphabetically.** Checking a box appends the skill to the bottom of the linked
block; unchecking returns it to the alphabetical group. What is on screen is
therefore always exactly what is stored — an interleaved list would have to
invent an order for rows that have none, and lose it on reload.

Every change (check, uncheck, drop) immediately `POST`s the full ordered id list
to `/agents/:id/skills` with an optimistic update; there is no Save button on
this tab. On failure the list rolls back and surfaces the error.

---

## States and degradation

| Situation | Behaviour |
|---|---|
| No skills in the workspace | List shows the existing empty state; the agent editor's Skills tab shows an empty state pointing at `/skills`. |
| Skill disabled globally | Stays visible and linked everywhere; excluded from every prompt. |
| Skill deleted while linked | Links cascade away. Affected agents keep working with one fewer rule; their existing `agent_versions` snapshots keep the now-dangling id, which is correct history. |
| Body at the 20 000-char limit | Rejected on save with a field error. Nothing is truncated silently at review time. |
| Version list of length 1 | Versions tab shows the single *Current* row, no Diff/Restore. |
| Stats for an unused skill | `Used by 0 agents` + empty list, not a spinner or an error. |

## Testing

**Server**

- `test/skills.it.test.ts` (DB-backed): create → v1 recorded; patch `name` only → no version bump; patch `body` → version bumped and snapshot written with the `summary`; restore v1 over v3 → v4 with v1's body; delete cascades links; a skill in another workspace is a 404 on every route.
- Hermetic run-executor test: linked skill bodies reach `reviewPullRequest` in `order`; a disabled skill does not; zero linked skills produces no `skills` key at all.
- Agents test: `setSkills` bumps `agents.version` and the new `agent_versions` row's `configJson.skills` matches the ids sent.

**Client**

- `SkillCard` — badges, agent count, toggle calls the mutation.
- `CreateSkillModal` — validation errors, `.md` upload fills the body field.
- `VersionsTab` — rows render, `Current` has no Restore, Diff shows added/removed lines.
- `SkillsTab` — checking, unchecking, and reordering each POST the expected ordered id list.

**Gates:** `pnpm typecheck` in `server` and `client`; `pnpm arch:check` in
`server`; the server's hermetic unit lane; `pnpm test` in `client`.

## Acceptance

1. `/skills` lists the workspace's skills, and a skill can be created manually or from a `.md` file.
2. Editing a body and saving produces a new version; the Versions tab diffs it against the previous one and can restore it, appending rather than rewriting history.
3. The Preview tab renders the body as Markdown.
4. The Stats tab reports how many agents use the skill and which ones.
5. An agent's Skills tab links, unlinks, and reorders skills, and each change bumps the agent's version with a matching `agent_versions` snapshot.
6. **End to end:** create a skill → link it to two agents → run a review → the run trace's `## Skills / rules` section contains that body in the configured order, and a globally disabled skill is absent from it.
