# Spec — Skills: a reusable rule library shared across agents

**Status:** DRAFT (2026-08-02)
**Owner:** server · **Consumer:** client ([`client/specs/skills-library.md`](../../client/specs/skills-library.md))
**Design:** [`docs/superpowers/specs/2026-08-02-skills-design.md`](../../docs/superpowers/specs/2026-08-02-skills-design.md)
**Plan:** [`docs/superpowers/plans/2026-08-02-skills-library.md`](../../docs/superpowers/plans/2026-08-02-skills-library.md)
**Related:** `contracts/knowledge.ts` (`Skill`, `SkillVersion`, `SkillStats`, `SkillWithUsage`), [`modules/agents/`](../src/modules/agents/) (owns the agent side of `agent_skills`)

An agent's only lever was its `system_prompt`: every rubric, house convention
and security gate had to be pasted into each agent that needed it, and re-pasted
into the next one. A **skill** is that text, stored once, versioned, and linked
to many agents in an explicit order.

A skill is **text and nothing else** — no tools, no code, no execution, no
fetching. Its whole contract is "these characters end up in the prompt, in this
position".

## 1. Scope

**In scope**

- A `skills` module owning `skills`, `skill_versions`, and the *skill* side of
  `agent_skills` (which agents use this skill).
- Seven endpoints: CRUD, version history, restore, usage stats.
- One column: `skill_versions.summary`.
- Linked-skill changes become agent config changes (version bump + snapshot).
- Injection of the linked bodies into the review prompt.

**Out of scope**

- Import from URL, community skill search, sharing across workspaces,
  export/import bundles. `source` is always `'manual'`.
- Per-skill attribution of findings, and therefore every accuracy metric
  (pull frequency, accept rate, findings counts). Nothing records which skill
  produced which finding.
- Evals. The `eval_*` tables are empty.
- Any change to `reviewer-core` — its `ReviewInput.skills` and the
  `## Skills / rules` rendering already existed and are untouched.

## 2. Contract

The Zod definitions in `src/vendor/shared/contracts/knowledge.ts` are the source
of truth, and `@devdigest/shared` is **two physical copies** — every edit lands
in the client's copy too.

| Contract | Change |
|---|---|
| `SkillVersion` (new) | `skill_id`, `version` (int), `summary` (nullable), `body`, `created_at` |
| `SkillAgentRef` (new) | `id`, `name`, `enabled` |
| `SkillStats` (new) | `agent_count` (int), `agents: SkillAgentRef[]` |
| `SkillWithUsage` (new) | `Skill` + `agent_count` (int) — the list-row shape |
| `Skill` | unchanged |

Schema: one nullable column, `skill_versions.summary text` (migration `0012`).
Both tables were empty, so there is no backfill.

### Endpoints

All are workspace-scoped through `getContext`. A skill belonging to another
workspace is a **404, never a 403** — the caller learns nothing about its
existence.

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/skills` | List for the workspace, alphabetical, each row carrying `agent_count`. |
| `GET` | `/skills/:id` | One skill. |
| `POST` | `/skills` | Creates at `version = 1` **and** writes its `skill_versions` row. `source` is always `'manual'`. **201**. |
| `PUT` | `/skills/:id` | Partial patch of `name`, `description`, `type`, `body`, `enabled`, plus an optional `summary` describing the version this save creates. |
| `DELETE` | `/skills/:id` | Deletes; `skill_versions` and `agent_skills` cascade. |
| `GET` | `/skills/:id/versions` | History, newest version first. |
| `POST` | `/skills/:id/versions/:version/restore` | Appends a new version carrying that body; returns the updated skill. |
| `GET` | `/skills/:id/stats` | `{agent_count, agents}`. |

### Validation

Rejected at the route with a **422**, never truncated later:

| Field | Rule |
|---|---|
| `body` | 1–20 000 characters |
| `name` | 1–80 characters, unique per workspace, **case-insensitive** |
| `description` | ≤ 300 characters (optional; defaults to `''`) |
| `summary` | ≤ 120 characters |
| `type` | `rubric \| convention \| security \| custom` |
| `:id` | uuid (a non-uuid is a 422, not a 404) |

## 3. Behaviour

### 3.1 Only a changed body creates a version — no exceptions

`skill_versions` stores bodies. Editing `name`, `description` or `type`, and
toggling `enabled`, do **not** bump `version` and do **not** write a snapshot: a
version with a body identical to the one before it carries no information.
Saving a body byte-identical to the current one is likewise not a change.

A `summary` sent on a patch that does not change the body is **ignored** —
there is no version for it to describe.

This mirrors `isConfigChange` on the agents side.

### 3.2 Restore appends, it does not rewind

`POST /skills/:id/versions/1/restore` on a skill at v2 produces **v3**, whose
body is v1's, with the summary `Restored from v1`. History is append-only:
nothing is rewritten, and the restore itself is auditable. Restoring a version
that was never recorded is a 404.

### 3.3 Linking a skill versions the agent

`AgentsRepository.setSkills` and `.linkSkill` bump `agents.version` and write an
`agent_versions` snapshot whose `configJson.skills` holds the new ordered ids.
An agent's behaviour depends on its skills, so "agent v3" has to mean one fixed
set of them; without this the version history stops being reproducible, which is
the only reason it exists.

### 3.4 Prompt injection

Immediately before `reviewPullRequest`, the executor reads
`agentsRepo.linkedSkills(agent.id)` and passes the enabled bodies as
`skills: string[]`.

- **Order** is `agent_skills.order` ascending — the repository sorts.
- A globally disabled skill (`skills.enabled = false`) is excluded from
  **every** agent's prompt while staying visible and linked in the UI.
- An empty set omits the `skills` key entirely; the prompt is byte-identical to
  one assembled before this feature existed.
- Bodies are **trusted instructions**, rendered verbatim into
  `## Skills / rules` — *not* delimiter-wrapped. This is justified solely by
  `source = 'manual'` being the only source in scope. **If URL or community
  import is ever added, this decision must be revisited before that code
  merges.**
- **`source: 'extracted'` now exists, and this is that revisit.** The conventions
  extractor ([`specs/conventions.md`](conventions.md)) writes skills whose bodies
  derive from repository content, including code snippets. A repo file can contain
  "ignore previous instructions", a model can surface it as a convention, and it
  would then enter every review prompt as a trusted instruction. The verbatim
  rendering is **kept**, because the trust boundary here is a person: no candidate
  reaches a skill without an explicit accept, the full merged body is visible and
  editable before saving, and evidence snippets are capped at ten fenced lines so
  whole files never reach a body. That is a procedural guarantee, not a technical
  one. A source that removes the human step — URL import, community search — must
  not reuse it.
- The run uses the **current** bodies, not the bodies as of the agent's
  snapshot: `agent_versions` records which skills were linked, not what they
  said.
- `run_traces.prompt_assembly.skills` stops being `null`.

### 3.5 Not best-effort

Unlike repo-intel enrichment, a failure here **fails the run**. It is an
ordinary database read, and silently reviewing without the rules the user
configured is worse than an error.

## 4. Degradation

| Situation | Behaviour |
|---|---|
| No skills in the workspace | `GET /skills` returns `[]`. |
| Skill disabled globally | Stays listed and linked; excluded from every prompt. |
| Skill deleted while linked | Links cascade away. Affected agents keep working with one fewer rule; existing `agent_versions` snapshots keep the now-dangling id, which is correct history. |
| Body at the character limit | 422 on save. Nothing is truncated silently at review time. |
| Duplicate name | 422 with the clashing name in the message. |
| Restore of an unknown version | 404. |
| Skill from another workspace | 404 on every route. |

## 5. Acceptance

1. `POST /skills` → `version: 1`, `source: 'manual'`, and one `skill_versions` row.
2. Patching `name` only leaves `version` at 1 and writes no snapshot.
3. Patching `body` with a `summary` bumps to 2 and records the summary; the list is newest-first.
4. Restoring v1 over v2 yields v3 carrying v1's body and the summary `Restored from v1`.
5. Deleting a skill cascades its versions and links.
6. Every route 404s for a skill in another workspace.
7. `POST /agents/:id/skills` bumps the agent's version and snapshots the ordered ids.
8. A review run puts the enabled linked bodies into `## Skills / rules` in link order, and a disabled skill is absent.

Covered by [`test/skills.it.test.ts`](../test/skills.it.test.ts) (13 DB-backed
cases), [`test/agents-versions.it.test.ts`](../test/agents-versions.it.test.ts)
(the link-bump case) and [`test/skills-prompt.test.ts`](../test/skills-prompt.test.ts)
(hermetic: the selector and the assembled section).
