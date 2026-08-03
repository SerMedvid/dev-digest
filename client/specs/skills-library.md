# Spec — Skills library (`/skills`) and the agent editor's Skills tab

**Status:** DRAFT (2026-08-02)
**Owner:** client · **Producer:** server ([`server/specs/skills.md`](../../server/specs/skills.md))
**Design:** [`docs/superpowers/specs/2026-08-02-skills-design.md`](../../docs/superpowers/specs/2026-08-02-skills-design.md)
**Plan:** [`docs/superpowers/plans/2026-08-02-skills-library.md`](../../docs/superpowers/plans/2026-08-02-skills-library.md)

Two surfaces over one idea — a reusable block of prompt text:

1. **`/skills`** — a master-detail library: create, edit, preview, diff,
   restore, and see who uses each rule.
2. **The agent editor's Skills tab** — attach, detach and order the rules one
   agent reviews with.

## 1. The journey

**Create → edit → attach → review.** From `/skills`, *Add Skill* offers the two
sources that exist: type it, or pick a local `.md` file (read in the browser —
it is never uploaded — which also fills the name from the file's basename when
the name is blank). Saving lands on the new skill's Config tab.

Editing the body and saving creates a version; the optional change note beside
the body describes it. The Versions tab diffs any older version against the
current body and can restore it, which **appends** a new version rather than
rewinding. Preview shows the body as Markdown, framed as what the reviewing
agent receives. Stats answers "is this rule actually in use, and where".

From an agent's Skills tab, checking a skill links it; dragging reorders the
linked block. Each change saves immediately and bumps the agent's version. The
next review on that agent carries the rules, in that order.

## 2. Screens and states

### `/skills` — the list (a layout, not a page)

The list lives in `app/skills/layout.tsx` so it stays mounted — keeping its
scroll position and search text — while a skill is open beside it. Selecting a
skill preserves the current `?tab=`.

| State | Behaviour |
|---|---|
| Loading | three card skeletons in the left column |
| Error | `ErrorState` with a retry that refetches |
| Empty | `EmptyState` whose CTA opens the create modal |
| Search matches nothing | the card area is simply empty; the search box stays |
| Nothing selected | right pane shows the "Select a skill" prompt |
| Card toggle | flips `enabled` immediately; a disabled card dims but stays listed |
| Card delete | `window.confirm` naming the skill and warning that agents lose the rule |

Each card carries the name, description (or a placeholder), a type chip, a
source badge, and either `N agents` or `Not used yet`.

### `/skills/[id]` — the detail pane

Four tabs, active tab in `?tab=`, invalid values falling back to `config`.
There is deliberately **no Evals tab** — the `eval_*` tables are empty.

| Tab | Content and states |
|---|---|
| **Config** | Name, description, type, enabled, body, change note. An `unsaved` marker appears the moment any field differs from the loaded skill. A character counter turns critical past 20 000 and disables Save. The change note is disabled until the body differs — it is the only save it can describe. Save errors render inline with the `ApiError` message. |
| **Preview** | The body through the vendored `Markdown` primitive inside a bordered surface. An empty body shows an empty state. |
| **Stats** | One tile (`Used by N agents`) and a list of those agents, each linking to `/agents/:id`, disabled ones badged. Zero agents → empty state, not a spinner or an error. |
| **Versions** | One row per version: `v#`, the change note or `No change note`, the date. The **newest is marked *Current* and has neither Diff nor Restore** — nothing to compare it against, nothing to restore. Diff toggles a unified diff of that body against the current one; it scrolls horizontally inside its own frame so a long line cannot widen the pane. Restore confirms, stating that a new version will be added. |

A skill that 404s (including one from another workspace) shows the "not found"
empty state, not an error.

### The agent editor's Skills tab

| State | Behaviour |
|---|---|
| Loading | one skeleton |
| Error | `ErrorState` with retry |
| No skills in the workspace | empty state pointing at the Skills library |
| Normal | counter (`N of M enabled`), an ordering hint, a filter box, then the rows |
| Save fails | the optimistic order rolls back and an inline message appears |

**Ordering model — a deliberate deviation from the mock,** which interleaves
linked and unlinked rows. Here: **linked skills sit at the top in their
persisted order and are the only draggable rows; unlinked skills sit below them,
alphabetically.** Checking a box appends to the bottom of the linked block;
unchecking returns the row to the alphabetical group. What is on screen is
therefore always exactly what is stored — an interleaved list would have to
invent an order for rows that have none, and lose it on reload.

There is **no Save button**. Every check, uncheck and drop posts the full
ordered id list optimistically.

## 3. Data

One path only: component → hook in `src/lib/hooks/` → `api`.

| Surface | Hook | Query key |
|---|---|---|
| List | `useSkills` | `["skills"]` |
| Detail | `useSkill(id)` | `["skill", id]` |
| Versions | `useSkillVersions(id)` | `["skill-versions", id]` |
| Stats | `useSkillStats(id)` | `["skill-stats", id]` |
| Agent's links | `useAgentSkills(agentId)` | `["agent-skills", agentId]` |

Mutations: `useCreateSkill`, `useUpdateSkill`, `useDeleteSkill`,
`useRestoreSkillVersion`, `useSetAgentSkills`.

**Cache truth.** Updating a skill invalidates `["skills"]` and its version
history and writes the fresh skill into `["skill", id]`. Restoring does the
same. Setting an agent's skills invalidates `["agent-skills", id]`,
`["agent", id]` and `["agents"]` — the server treats it as a config change, so
the agent's version really has moved — plus `["skills"]`, whose `agent_count`
has changed.

## 4. Navigation and copy

A `SKILLS LAB` nav section holds Skills (`Sparkles`, `g s`) and Agents.
All user-facing strings come from `messages/en/skills.json` and
`messages/en/agents.json`. The catalogue's `url.*` and `community.*` blocks stay
in place, unused, for the lesson that builds them.

## 5. Acceptance

1. `/skills` lists the workspace's skills; a skill can be created manually or from a `.md` file.
2. Editing a body and saving produces a new version; Versions diffs it against the previous one and can restore it, appending rather than rewriting.
3. Preview renders the body as Markdown.
4. Stats reports how many agents use the skill and which ones.
5. An agent's Skills tab links, unlinks and reorders skills, and each change bumps the agent's version.
6. End to end: create a skill → link it to an agent → run a review → the trace's `## Skills / rules` section contains that body; disabling the skill removes it.

Covered by `SkillCard`, `CreateSkillModal`, `ConfigTab`, `VersionsTab`
(+ `toDiffRows`), `StatsTab`, and `SkillsTab` (+ `orderRows` / `moveLinked`)
tests. Drag-and-drop itself is **not** unit-tested: `@dnd-kit` needs pointer
events jsdom does not deliver, so `moveLinked` is covered directly instead.
