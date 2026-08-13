# Project Context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user attach `.md` documents from a repository clone to an agent or a skill, inject their text into the existing `## Project context` prompt slot at run time as untrusted data, and make every read and every non-read auditable in the run trace and the Live Log.

**Architecture:** One new server module `server/src/modules/project-context/` layered per the Onion rules — pure `domain.ts`/`constants.ts`/`helpers.ts`, a `service.ts` taking a `ProjectContextDeps` port bundle, and driven adapters `walk.ts` (filesystem discovery) and `repository.ts` (Drizzle, owns one new `context_attachments` table). The path-confinement reader moves to `platform/clone-reader.ts` so the `intent` module and this one share one security control. `ReviewRunExecutor` consumes the resolved documents off a container getter and passes them to `reviewPullRequest` as `specs: string[]`. `reviewer-core` is not touched. On the client, one read-only page, one agent-editor tab, one skill-editor section, and a one-string trace-label change.

**Tech Stack:** Fastify 5 + `fastify-type-provider-zod`, Drizzle ORM 0.38 over Postgres, Zod 3 contracts from `@devdigest/shared` (two physical copies), Next.js 15 App Router + TanStack Query + `next-intl`, vitest (hermetic + testcontainers), `@dnd-kit` for reorder.

**Spec:** [`docs/superpowers/specs/SPEC-2026-08-13-project-context.md`](../specs/SPEC-2026-08-13-project-context.md) — 77 acceptance criteria including the `### Amendment 2026-08-13` block (AC-73…AC-77). The spec wins over this plan wherever they disagree. Expected later halves `server/specs/project-context.md` and `client/specs/project-context.md` are **not** this plan's to write (see Follow-up).
**Execution mode:** single-pass — decided by the caller. One implementer context runs Task 1 → Task 14 in order; later tasks may rely on context established by earlier ones, but every task still names its files, its governing skills and its verification commands.
**Packages in scope:** `server`, `client`. (`reviewer-core` unchanged by design; `e2e` deliberately not extended — see Out of scope.)
**Skills the implementer will be bound by:** `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `zod`, `security`, `typescript-expert`, `frontend-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`.
**Insights consulted:** `server/INSIGHTS.md` — 2026-08-10 (POSIX-vs-native separators silently zeroed the depgraph; the reason every stored path here is POSIX), 2026-08-03 (seeded demo repo has `clone_path: null`, so a naive clone-reading it-test green-passes on the degradation early return), 2026-08-03 ×2 (unlocked read-modify-write around a version bump loses snapshots; a single-ordering race test passes by luck), 2026-08-03 (`pnpm db:generate` blocks on an interactive prompt when one migration drops **and** adds columns in the same table), 2026-08-02 (a **type-only** cross-module import trips `no-cross-module-internals` because `tsPreCompilationDeps: true`; the `move the helper to platform/` escape route), 2026-08-06 (the hermetic/integration lane splits by **filename**), 2026-08-05 (assert run log lines against the replay-first SSE buffer, never `GET /runs/:id/trace`). `client/INSIGHTS.md` — 2026-08-10 (a bare specifier resolves in CI only if it is in `client/package.json`), 2026-08-03 (`mutate` re-points the single mutation observer, which is what makes `SkillsTab`'s optimistic revert safe), 2026-08-03 (`EmptyState` takes no children; `body` is the only `ReactNode` slot), 2026-08-03 (an error-state query test needs `retry: false`), 2026-08-02 (`Textarea`/`FormField` give no accessible name), 2026-07-29 (no `user-event`; drive with `fireEvent`, and `fireEvent.click` dispatches no `mousedown`).

---

## Requirements review

The spec is complete enough to plan against: 71 of 77 criteria are directly executable, and the six gaps below are all narrow. Nothing contradicts a `CLAUDE.md` rule or an `INSIGHTS.md` entry, and every piece of scaffolding this feature lands on was grepped for a caller before being relied on.

| # | Requirement (as given) | Status | Note |
|---|---|---|---|
| AC-1…AC-8 | Discovery: `.md` under configured roots, POSIX-normalised, exclusions, no symlink traversal, `no_clone`, 500 cap | clear | — |
| AC-9, AC-57, AC-73 | Usage count = distinct agents, direct or via an **enabled** linked skill, disabled agents included | clear | The single-aggregate requirement in the NFR §Performance row is load-bearing; T6's it-test asserts the **query count**, not just the numbers |
| AC-10…AC-15 | Attachment persistence, version bump + snapshot, one transaction with the agent row locked, 404 across workspaces, cascade on repo delete | clear | The precedent `AgentsRepository.setSkills` does **not** lock and does **not** transact; this feature must be better than its precedent, per `server/INSIGHTS.md` 2026-08-03 |
| AC-16…AC-23, AC-25, AC-29, AC-30 | Run-time resolution, order, dedupe, repo match, disabled skills, byte-identical prompt when empty, `wrapUntrusted` | clear | — |
| AC-24, AC-26 | Over-size document truncated + **one Live Log `warn` line**; unreadable document named + **one Live Log `warn` line** | **assumed** | **`RunEventKind` has no `warn` member.** It is `z.enum(['info','tool','result','error'])` (`contracts/trace.ts:9`), `LiveLogStream`'s `LogLine["k"]` mirrors it, and `LOG_COLOR` has four entries — an unmapped kind renders with `color: undefined`. Adding `warn` is a `trace.ts` edit in both vendor copies plus a vendored-UI edit, which contradicts the spec's own constraint that "`trace.ts` needs **no** change, by design (AC-33)". A grep settles the house pattern: **every** best-effort degradation in `run-executor.ts` is `runLog.info` (`:413`, `:446`, `:448` — including "repoIntel failed"), and `error` is reserved for a run that failed. **Reading taken:** emit these as `info` events whose text names the document as not read / truncated. Open question 1 below; a one-line change to `warn` later if the spec author prefers the enum widening |
| AC-27, AC-28 | Lexical confinement against the unresolved root, then `realpath` against the `realpath`'d root | clear | Placement decided below — this was the spec's Open question 1 and it is now closed |
| AC-31…AC-34 | `specs_read` string formats, `RunTrace` structurally frozen, `prompt_assembly.specs` non-null | clear | `prompt.ts:145` already sets `specs: specsBlock ?? null`, so AC-34 needs no new code — only a test |
| AC-35 | Trace drawer renders the specs block under a label naming it attached and untrusted | clear | One string in `runs.json:53`; `TraceBody` already renders the block conditionally |
| AC-36…AC-41, AC-55, AC-56, AC-58 | Read-only page, footer, rescan, two empty states, sidebar item, detail panel, usage count on the row | clear | AC-55 forces an edit to `client/src/vendor/ui/nav.ts` — see Risks |
| AC-42…AC-48, AC-51…AC-53, AC-59, AC-61…AC-68 | Editor tabs, immediate save, optimistic revert, ordering, filter, token footer, map-reduce note, inheritance rows, badges | clear | — |
| AC-49 | Serialisation preview renders the block exactly as `assemblePrompt` would, **verified by comparing the preview against `assemblePrompt`'s own output** | **assumed** | That comparison **cannot run in the client package**: `client/tsconfig.json` aliases only `@devdigest/shared` and `@devdigest/ui`, and `client/INSIGHTS.md` (2026-08-10) records that an import not in `client/package.json` fails in CI even when it resolves locally. **Reading taken:** the block is assembled **server-side** by the new module (`GET /skills/:id/context/preview`), so the AC-49 comparison is a server hermetic test against the real `assemblePrompt`, and the client renders the returned string. This also makes the preview show the real truncation markers |
| AC-50 | A row whose attachment repository differs from "the repository currently selected in the editor" is inactive and labelled | **assumed** | Neither editor has a repository selector today. **Reading taken:** the editors scope discovery to the shell's active repository (`useActiveRepo()`), and rows whose `repo_id` differs are rendered inactive with that repository's `full_name` resolved from `useRepos()`. No new picker |
| AC-54, AC-60, AC-69 | Three criteria whose stated verification is an **e2e flow** | **open** | Not plannable against the hermetic e2e stack as it exists: `scripts/e2e.sh` brings up an **ephemeral, freshly-seeded** Postgres where the only repository is `acme/payments-api` with `clone_path: null` (`server/src/db/seed.ts:232`), so discovery returns `no_clone` and no document can be attached; and AC-54/AC-69 additionally need a **completed review run**, which e2e runs without a model key (`e2e/specs/08-pr-intent.flow.json` says so explicitly and refuses to click "Derive intent" for the same reason). Deferred with the behaviour covered elsewhere — see Out of scope and Open question 2 |
| AC-74…AC-77 | `context_roots` typed in both copies, 422 at the write boundary, re-parsed at the read boundary, degrade to defaults | clear | The 422 is free once the key is typed: `SettingsUpdate = Settings.partial()` is the route body schema and `app.ts:121` maps a zod validation failure to 422 |

**The spec's Open question 1 — where the confinement reader lives — is closed here: move it to `platform/`.**

`CloneDocReader` (`server/src/modules/intent/docs.ts`) already implements the exact two-check pattern AC-27/AC-28 require, including the asymmetric-roots subtlety its own header comment explains at length. It cannot be imported from a new module: `no-cross-module-internals` forbids `^src/modules/(a)/` → `^src/modules/(b)/`, and `server/INSIGHTS.md` (2026-08-02) records that a **type-only** import trips it too because `tsPreCompilationDeps: true`. The choice is move or duplicate, and the move wins on three counts:

1. **It is a security control.** Duplicating one guarantees the two copies drift, and the failure mode is silent in both directions — the asymmetric-comparison variant rejects *every* document in the clone when an ancestor of the clone directory is a link (the normal case on macOS), and the missing-`realpath` variant leaks a symlinked target's bytes into a prompt. Neither shows up as an error.
2. **`platform/` is where this repo already puts exactly this.** `server/CLAUDE.md` scopes `platform/` to "cross-cutting: config, container, jobs, sse, errors", and `server/INSIGHTS.md` (2026-08-03) names "move the helper to `platform/` and retype it to take `Db` instead of `Container`" as one of the two sanctioned escapes from this precise rule. Nothing in `.dependency-cruiser.cjs` forbids `modules/*` → `platform/*` except `core-no-container`, and `skills/service.ts` already imports `platform/errors.js`.
3. **The caps and the message strings differ between the two callers**, so a literal file move would not fit anyway. `intent` reads at most 3 documents of 8 000 bytes and labels them `doc:<path>`; this feature reads at most 20 of 65 536 bytes and needs its own reasons. The move is therefore a *parameterised extraction*: `platform/clone-reader.ts` owns resolve-confine-realpath-read and takes its caps as arguments, while `modules/intent/docs.ts` keeps its own `IntentDoc` shape, its own `MAX_DOCS`/`MAX_DOC_BYTES` and its own exact message strings on top of it.

The move is Task 1, and its regression gate is that **`server/test/intent-docs.test.ts` passes unchanged** — that file already covers the escape, the clean-path-dirty-target symlink, the linked-clone-root case and the "never leak the resolved target" assertion, on all three platforms.

**The spec's other five open questions.** None blocks a task. (2) The 500 discovery cap is untested against a large repository — it changes no task's shape; T5 returns the omitted count so the symptom is visible. (3) The `no_clone` signal's field name is fixed by this plan in T2 (`status: 'ok' | 'no_clone'`) rather than waiting for `server/specs/project-context.md`; if the spec half later names it differently, that is a rename in T2's contract plus T7 and T11. (4) Inherited rows stay non-detachable — T12 as written. (5) The `@dnd-kit` keyboard gap: `SkillsTab` uses `PointerSensor` only, so T12 **inherits** the gap rather than introducing one; adding `KeyboardSensor` to the new tab alone would be an inconsistency, and fixing both is a separate change. (6) `context_roots`' per-user storage is described, not fixed; T6 reads by `workspaceId` alone exactly as `GET /settings` does, so the behaviour matches the rest of the endpoint.

**Liveness checks run.** `PromptParts.specs` / `ReviewInput.specs` are wired end to end and fed by nobody (`reviewer-core/src/prompt.ts:48,101-103,121,145`, `review/run.ts:61,140`) — used as-is. `RunTrace.specs_read` is hardcoded `[]` at `run-executor.ts:351` and `:510`. `PromptAssembly.specs` is always null in production. `useContextFiles` / `useReindexContext` (`client/src/lib/hooks/core.ts:122,131`) have **zero callers** and hit two endpoints the server does not implement — T10 deletes them rather than leaving them dangling. `code_chunks` and `IndexStatus.chunks_indexed` have no producer — not used. `client/messages/en/context.json` is an unused catalogue for this exact screen, and its `empty.body` instructs the user to use `.devdigest/specs/`, which AC-3 contradicts — T11 rewrites it. `shell.json`'s `nav.context` label and `activeKeyFor`'s `/context` mapping both exist already; the `NAV` entry does not.

---

## Recommendations

| # | Recommendation | Why it is better | Cost | Status |
|---|---|---|---|---|
| 1 | Extract the confinement reader to `platform/clone-reader.ts` and reduce `CloneDocReader` to a thin adapter over it, instead of duplicating it into the new module | One security control instead of two; both known failure modes of this code are silent, so drift here is not self-announcing. The existing `intent-docs` suite becomes the regression gate for both callers | One edit to a shipped module's adapter, and its test file must pass **unchanged** — which is also the proof the edit is behaviour-preserving | **applied** (Task 1) |
| 2 | Assemble the AC-49 serialisation preview **server-side** and return it as a string | The client cannot import `assemblePrompt` (no alias, and `client/INSIGHTS.md` 2026-08-10 makes a bare cross-package specifier a CI failure), so a client-side reimplementation could not be compared against the real thing — which is the entire point of the panel. Server-side, the comparison is an exact hermetic test, and the preview shows the real truncation markers and the real unread list | One extra endpoint; the preview does up to 20 confined file reads on demand | **applied** (Tasks 7, 13) |
| 3 | Emit the AC-24/AC-26 degradation lines as `info` events with explicit wording, not as a new `warn` event kind | Adding `warn` to `RunEventKind` is a `trace.ts` edit in both vendor copies plus a vendored-UI `LOG_COLOR` edit, and the spec's own constraint list says `trace.ts` needs no change. Every existing best-effort degradation in `run-executor.ts` is already an `info` line | The Live Log shows these in the `info` colour, so "3 attached, 0 read" is the operator's tell rather than an amber row | **applied** (Task 9) — ratify or reverse via Open question 1 |
| 4 | Two nullable owner FKs (`agent_id`, `skill_id`) with **partial** unique indexes, not one polymorphic `owner_id` | A polymorphic id cannot carry `ON DELETE CASCADE`, which AC-15's sibling (a deleted skill's attachments cascading away) needs. Partial indexes also dodge the NULL-distinctness trap the spec records as edge case 34: a plain unique index over a nullable column does not dedupe, because Postgres treats NULLs as distinct unless the index is `NULLS NOT DISTINCT` | One `CHECK` constraint (first in this repo — contingency in Risks) and slightly wordier queries | **applied** (Task 3) |
| 5 | Fold the usage count, the effective-set count and the token sum into **one** repository aggregate consumed by both the page and the editor tab | The NFR §Performance row calls this out as the feature's N+1 risk: AC-57 over a 500-row list is two queries per document done naively. One aggregate also makes AC-64/AC-66/AC-67 arithmetically consistent with AC-18 by construction rather than by two implementations agreeing | The query is a three-way join with a `UNION`-shaped read; it needs its own it-test asserting the query count | **applied** (Task 6) |
| 6 | Defer AC-54/AC-60/AC-69's e2e flows and cover their behaviour with `*.it.test.ts` | The hermetic e2e stack cannot reach the state those flows assert (seeded `clone_path: null`, no model key). Writing them would mean seeding a clone fixture and giving e2e a mock provider — a change to the e2e harness, not to this feature | The demo walkthrough is proven by server it-tests and client unit tests rather than by a browser flow | **proposed** — the alternative is a separate piece of work on `scripts/e2e.sh` + `seed.ts` |
| 7 | Later, unify `agent_versions.configJson` construction between `modules/agents` and this module | This module must write an `agent_versions` snapshot (AC-12) and therefore mirrors the agents module's `configJson` field list. A field added there will silently be missing from a context-triggered snapshot | A pure helper in `modules/_shared/` plus a one-line change in `agents/repository.ts` — a shipped module edited for a benefit this feature does not need | **proposed** (recorded as a Risk instead) |

---

## Global Constraints

- **Package manager is `pnpm`** in both `server/` and `client/`. Never `npm install` in either — it writes a second lockfile. A new client dependency is not needed: `@dnd-kit/*`, `react-markdown` and `@tanstack/react-query` are already in `client/package.json`.
- **`@devdigest/shared` is two physical copies.** Every contract edit lands in **both** `server/src/vendor/shared/contracts/platform.ts` and `client/src/vendor/shared/contracts/platform.ts`, and **both** packages must typecheck. The files have drifted elsewhere — sync only the blocks this plan names.
- **`contracts/trace.ts` is not edited.** `RunTrace` stays structurally frozen (AC-33): `specs_read` remains `string[]`, and `getRunTrace` reads `row.trace as RunTrace` unvalidated at `server/src/modules/reviews/repository/run.repo.ts:227`, so an element-shape change would mistype every historical trace.
- **`reviewer-core/` is not edited.** The `specs` slot, `wrapUntrusted` and the `## Project context` heading exist and are used as-is (`reviewer-core/src/prompt.ts:48,101-103,121,145`).
- **Onion law 1:** `service.ts`, `domain.ts`, `helpers.ts`, `ports.ts` may not import `drizzle-orm`, `db/schema.js`, `fastify`, `openai`, `@anthropic-ai/sdk`, `simple-git`, `js-tiktoken` or `@ast-grep/*`. Importing `platform/errors.js` **is** allowed; importing `platform/container.js` is not.
- **Onion law 2:** `service.ts` takes `constructor(private deps: ProjectContextDeps)`. Never `Container`.
- **Onion law 3:** no Drizzle `$inferSelect` row type in a service signature — `repository.ts` maps rows to `domain.ts` types.
- **Onion law 4:** never import another module's `repository.ts` or any other internal, **including type-only** (`tsPreCompilationDeps: true`). Cross-*table* SQL inside your own repository is fine and is what this module does for `agents`, `agent_skills`, `skills`, `repos` and `settings` — the precedent is `ConventionsRepository.featureModelChoice` and `SkillsRepository.usage`.
- **`ReviewRunExecutor` reaches this module only through a container getter** (`this.container.projectContext.…`), the way it already reaches `intentService` and `repoIntel`. It must not import anything from `modules/project-context/`.
- **`no-circular` avoidance:** shared types live in `domain.ts`; `helpers.ts` imports `domain.ts`; `repository.ts` and `service.ts` import both. Never type-import from `repository.ts` into `helpers.ts`.
- **Every route calls `getContext(container, req)`** and scopes by `workspaceId`. Another workspace's agent, skill or repository is a **404, never a 403** (AC-14). A non-uuid id is a 422 from the route schema.
- **Test suffix rule:** any test importing `test/helpers/pg.ts` **must** be named `*.it.test.ts`, and a hermetic case must not live inside an `*.it.test.ts` file — the lane split is by filename only (`server/INSIGHTS.md`, 2026-08-06).
- **A clone-reading it-test needs a real clone.** The seeded demo repo has `clone_path: null` (`server/src/db/seed.ts:232`), so a naive test green-passes on the `no_clone` early return. Every it-test that must reach real files does `mkdtemp` → write nested fixture files → `db.update(t.repos).set({ clonePath: dir })` in `beforeAll`, and asserts a **non-empty** document list before asserting anything else. One outer `describe` owns the testcontainer (`server/INSIGHTS.md`, 2026-08-10).
- **Paths are POSIX everywhere they are stored, returned or compared; reads rejoin with `path.join`.** Normalise with `.split(path.sep).join('/')` at the walker's boundary, never `relative()`'s native output, and never `lastIndexOf('/')`. This exact class of bug silently zeroed the depgraph on Windows (`server/INSIGHTS.md`, 2026-08-10) and left two path-arithmetic bugs in test helpers (2026-08-02). Fixture files in tests must be **nested**, or a separator bug cannot surface (AC-2).
- **Never edit an applied migration.** Change `src/db/schema/*.ts`, run `pnpm db:generate`, commit the generated SQL. This feature **adds a table and changes no column**, so `pnpm db:generate` will not hit the interactive drop-plus-add prompt (`server/INSIGHTS.md`, 2026-08-03).
- **Exact values, all in `modules/project-context/constants.ts`:** `DEFAULT_CONTEXT_ROOTS = ['specs', 'docs', 'insights']`, `EXCLUDED_DIRS = ['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', 'out', 'vendor']`, `MAX_LIST_DOCS = 500`, `MAX_DOCS_PER_RUN = 20`, `MAX_DOC_BYTES = 65_536`, `MAX_PATH_CHARS = 1024`, `SETTINGS_ROOTS_KEY = 'context_roots'`.
- **Exact strings (bytes matter — these are asserted):**
  - read trace entry: `` `${path} (~${tokens} tokens)` ``
  - unread trace entry: `` `${path} — not read: ${reason}` `` (U+2014 em dash, spaces either side)
  - reasons: `path resolves outside the repository` · `not found in the repository clone` · `no repository clone on disk` · `only 20 documents are read per run`
  - truncation marker, appended after a newline: `` `[truncated: 65536 of ${totalBytes} bytes]` ``
  - Live Log summary: `` `Project context: ${attached} attached, ${read} read` ``
  - Live Log per-document lines: `` `Project context: ${path} not read — ${reason}` `` and `` `Project context: ${path} truncated to 65536 bytes` ``
  - serialised block: `` `## Project context\n` `` followed by each document wrapped as `wrapUntrusted('spec-<i>', text)` and joined by `\n\n` — i.e. exactly what `assemblePrompt` emits at `reviewer-core/src/prompt.ts:101-103,121`, with `<i>` **zero-based**.
- **Untrusted input, twice over.** Document text is author-controlled and reaches the model only through the `specs` slot, which wraps it as `<untrusted source="spec-N">`; `INJECTION_GUARD` is already on every system message. A client-supplied path is untrusted and is confined lexically **before** any filesystem call and again by `realpath`, and is length-bounded at the route. Never log document content, and never log the clone's absolute path.
- **Verification is batched per task.** Run the focused failing test in the red phase; run the wide gates (`typecheck`, `arch:check`, package suites) **once at the end of the task**, not between steps.
- **Gates before "done":** `cd server && pnpm typecheck` · `cd server && pnpm arch:check` (paste its output) · `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` · `cd server && pnpm test` (needs Docker; for the tasks with an `*.it.test.ts`) · `cd client && pnpm typecheck` · `cd client && pnpm test`.
- **Commits are the caller's.** The implementer stops at a verified, complete task and reports; it never runs `git commit`, `git push`, or `superpowers:finishing-a-development-branch`.

### Pre-flight — already verified against the repo (2026-08-13)

These were checked while writing the plan, so no task needs to rediscover them.

| Fact | Where |
|---|---|
| `RunEventKind` is `['info','tool','result','error']` — **no `warn`** | `server/src/vendor/shared/contracts/trace.ts:9`; `LogLine["k"]` + `LOG_COLOR` mirror it at `client/src/vendor/ui/LiveLogStream.tsx:7-18` |
| `run-executor` reaches every collaborator off `this.container`, so no cross-module import is needed | `run-executor.ts:120,213,240,410` |
| `specs_read: []` is hardcoded on both trace paths | `run-executor.ts:351` and `:510` (`traceFromBuffer`) |
| `prompt_assembly.specs` is already `specsBlock ?? null` | `reviewer-core/src/prompt.ts:145` |
| Zod body-validation failures become **422** with `code: 'validation_error'` | `server/src/app.ts:119-128` |
| `SettingsUpdate = Settings.partial()` is the `PUT /settings` body schema; `Settings = SettingsKnown.passthrough()` | `contracts/platform.ts:112-128`, `settings/routes.ts:49` |
| `rowsToSettings` returns `out as Settings` with no parse; the feeding select filters `workspaceId` only, no `ORDER BY` | `settings/helpers.ts:10-14`, `settings/routes.ts:31-34` |
| `container.tokenizer` exists with `count(text)`, overridable via `ContainerOverrides.tokenizer`; the port-shaped form `tokenCount: (text) => this.tokenizer.count(text)` is already used | `platform/container.ts:221,329-333` |
| `AgentsRepository.bumpForSkillChange` bumps in SQL and snapshots `.returning()`'s version — but `setSkills` is **not** transactional and does not lock | `modules/agents/repository.ts:212-218,248-256` |
| `agents.enabled`, `skills.enabled`, `agent_skills(agent_id, skill_id, order)`, `agent_versions(agent_id, version, config_json)` all exist | `db/schema/agents.ts:32,51-63,38-49`, `db/schema/skills.ts:17` |
| `settings` is `(workspace_id, user_id, key, value)` with `settings_ws_user_key_uq` **not** `NULLS NOT DISTINCT` | `db/schema/core.ts:34-48` |
| `repos.clonePath` is `text('clone_path')`, nullable | `db/schema/repos.ts:16` |
| `NAV` has no `context` item; `shell.json`'s `nav.context` label and `activeKeyFor`'s `/context` branch both already exist; free `gKey`s exclude `p/s/a/c` | `client/src/vendor/ui/nav.ts:21-36`, `client/messages/en/shell.json`, `client/src/components/app-shell/helpers.ts:30` |
| `client/tsconfig.json` aliases only `@/*`, `@devdigest/shared`, `@devdigest/ui` — the client cannot import `reviewer-core` | `client/tsconfig.json` |
| `EmptyState` takes no children (`body` is a `ReactNode`); `Markdown` takes `children?: string` | `client/src/vendor/ui/primitives/EmptyState.tsx`, `primitives/Markdown.tsx` |
| `useActiveRepo()` returns `{ activeRepo, repoId }`; `useRepoNotFound(repoId)` + `RepoNotFound` are the page's guard | `client/src/lib/repo-context.tsx:58`, `conventions/page.tsx` |
| The agent editor's tab list is `TABS` in `AgentEditor/constants.ts`; `agents.json`'s `editor.tabs` already has `config`/`skills`/`evals`/`stats`/`ci` | `AgentEditor/constants.ts:11-14` |
| The skill editor's tab list is `TABS` in `SkillDetail/constants.ts`; `ConfigTab` is where a new section belongs | `SkillDetail/constants.ts:8-13` |
| drizzle-orm 0.38.3 / drizzle-kit 0.30.1; no `check()` used anywhere in the schema yet | `server/package.json`, `src/db/schema/*.ts` |
| `e2e` runs against an ephemeral freshly-seeded DB with `clone_path: null` and no model key | `scripts/e2e.sh`, `e2e/specs/08-pr-intent.flow.json` |

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `server/src/platform/clone-reader.ts` | Cross-cutting confined reader: resolve → lexical confine → `realpath` confine → byte-capped read. Parameterised caps. The only place either module opens a file inside a clone. |
| `server/src/modules/project-context/domain.ts` | `ContextDocRecord`, `AttachmentRecord`, `OwnerKind`, `ResolvedDoc`, `UnreadDoc`, `UnreadReason`, `DiscoveryStatus`, `RepoRef`. Zero imports. |
| `server/src/modules/project-context/constants.ts` | Every numeric cap, the default roots, the excluded directories, the settings key, and the exact message formats. |
| `server/src/modules/project-context/helpers.ts` | Pure: `isUnderRoots`, `toPosix`, `parseRoots`, `capList`, `orderAndDedupe`, `applyReadCap`, `truncateForPrompt`, `formatSpecRead`, `formatSpecUnread`, `sumTokens`, `effectiveSet`. |
| `server/src/modules/project-context/ports.ts` | `ProjectContextDeps` and the ports it bundles (`store`, `walker`, `reader`, `tokenCount`, optional `logger`). |
| `server/src/modules/project-context/walk.ts` | Driven adapter: the recursive `.md` walk over the clone. Symlink-safe, exclusion-aware, POSIX-normalising, cap-aware. |
| `server/src/modules/project-context/repository.ts` | The only Drizzle in the module. Owns `context_attachments`; cross-table reads of `repos`, `settings`, `agents`, `agent_skills`, `skills`; the one usage/effective-set aggregate; the locked replace transaction. |
| `server/src/modules/project-context/service.ts` | Use-cases: `listDocuments`, `readDocument`, `attachmentsForAgent`, `attachmentsForSkill`, `setAttachments`, `resolveForRun`, `previewForSkill`. |
| `server/src/modules/project-context/routes.ts` | Fastify plugin, route zod schemas, deps assembly. |
| `server/test/clone-reader.test.ts` | Hermetic: confinement, symlink escape, linked clone root, byte cap + marker, non-`.md`. |
| `server/test/project-context-helpers.test.ts` | Hermetic: every pure helper, including the roots parse degradation and the exact string formats. |
| `server/test/project-context-walk.test.ts` | Hermetic: nested roots at depth, exclusions, symlink non-traversal, 500 cap + omitted, POSIX separators. |
| `server/test/project-context-service.test.ts` | Hermetic: resolution order, dedupe, disabled skills, repo mismatch, caps, degradations, `specs` omitted when empty, serialisation vs `assemblePrompt`. |
| `server/test/project-context.it.test.ts` | DB-backed: attachment CRUD, version bump + snapshot, both-orderings race, cross-workspace 404s, cascade, usage counts + query count, discovery with a real clone fixture, `PUT /settings` 422. |
| `server/test/project-context-review.it.test.ts` | DB-backed: a review run with a real clone fixture — `specs_read`, `prompt_assembly.specs`, the SSE Live Log lines, and the `no_clone` degradation. |
| `client/src/lib/hooks/project-context.ts` | `useContextDocs`, `useContextDoc`, `useAgentContext`, `useSkillContext`, `useSetContextAttachments`, `useSkillContextPreview` + the query keys. |
| `client/src/app/repos/[repoId]/context/page.tsx` | Route `/repos/:repoId/context`. Thin: guard + `ProjectContextView`. |
| `client/src/app/repos/[repoId]/context/_components/ProjectContextView/**` | The read-only page: list, detail panel, footer, rescan, both empty states. |
| `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/**` | The agent `Context` tab: rows, inheritance, filter, drag reorder, token footer. |
| `client/src/app/skills/[id]/_components/SkillDetail/_components/ConfigTab/_components/ProjectContextSection/**` | The skill editor's `Project context to use` section + `SERIALIZES AS` panel. |
| `client/src/components/context-doc-preview/**` | The shared read-only preview modal (used by both editors and the page). |

**Modified**

| File | Change |
|---|---|
| `server/src/modules/intent/docs.ts` | `CloneDocReader` becomes a thin adapter over `platform/clone-reader.ts`; its caps, labels and message strings are unchanged. |
| `server/src/vendor/shared/contracts/platform.ts` | New `// ---- Project context ----` block; `context_roots` added to `SettingsKnown`. |
| `client/src/vendor/shared/contracts/platform.ts` | The identical edit. |
| `server/src/db/schema/context.ts` | New `contextAttachments` table. |
| `server/src/db/schema.ts` | Export `contextAttachments` from the barrel. |
| `server/src/platform/container.ts` | `+ get projectContextRepo()` and `+ get projectContext()` (the service, with its deps bundle). |
| `server/src/modules/index.ts` | Register the `projectContext` plugin. |
| `server/src/modules/reviews/run-executor.ts` | Resolve project context per agent run; pass `specs`; populate `specs_read`; emit the Live Log lines. |
| `server/README.md` | Project Context in the API map. |
| `client/src/lib/hooks/core.ts` | Delete `useContextFiles` and `useReindexContext` (zero callers, endpoints never existed). |
| `client/src/lib/hooks/index.ts` | Re-export the new hooks module if it re-exports the others. |
| `client/src/vendor/ui/nav.ts` | `Project Context` item in the `WORKSPACE` group + its `SHORTCUTS` entry. |
| `client/messages/en/context.json` | Rewritten for this screen; `empty.body`'s `.devdigest/specs/` instruction removed. |
| `client/messages/en/agents.json` | `editor.tabs.context` + a `contextTab.*` block. |
| `client/messages/en/skills.json` | A `projectContext.*` block. |
| `client/messages/en/runs.json` | `trace.prompt.specs` → the attached-and-untrusted label. |
| `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` + `AgentEditor.tsx` | Register and render the `context` tab. |
| `client/src/app/skills/[id]/_components/SkillDetail/_components/ConfigTab/ConfigTab.tsx` | Render `ProjectContextSection`. |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx` | No logic change expected — the label comes from the catalogue; touch only if the assertion needs the block wired differently. |

---

## Task 1: `platform/clone-reader.ts` — one confined reader, two callers

**Files:**
- Create: `server/src/platform/clone-reader.ts`
- Modify: `server/src/modules/intent/docs.ts` (whole file — the class keeps its name, shape and messages)
- Test: `server/test/clone-reader.test.ts` (new); `server/test/intent-docs.test.ts` (**must pass unchanged — do not edit it**)

**Interfaces:**
- Consumes: nothing but `node:fs/promises` and `node:path`.
- Produces:
  ```ts
  export type CloneReadFailure = 'outside' | 'not_markdown' | 'not_found';
  export type CloneReadResult =
    | { ok: true; text: string; bytes: number; truncated: boolean }
    | { ok: false; reason: CloneReadFailure };

  export class CloneReader {
    /** Resolves both roots once. A `clonePath` that cannot be resolved falls back to the lexical root. */
    static async open(clonePath: string): Promise<CloneReader>;
    /** Confine lexically, then by realpath, then read at most `maxBytes` bytes. */
    read(relPath: string, maxBytes: number): Promise<CloneReadResult>;
  }
  ```
  `modules/intent/docs.ts` keeps exporting `class CloneDocReader implements DocsPort` with the same `read(clonePath, relPaths)` signature and the same four message strings.

**Constraints that bind this task:**
- **The order of checks is load-bearing and is preserved:** lexical confinement against the **unresolved** root first (so an escaping path is never reported as "not a markdown file"), then the `.md` extension check, then `realpath` compared against the **`realpath`'d** root. The two comparisons use different roots on purpose; the header comment in the current `docs.ts` explains why and must survive the move.
- A path that does not exist fails `realpath` with ENOENT — that is **not** an escape; fall through to the read and report `not_found`.
- Truncation is by **bytes, not characters**: read into a `Buffer`, compare `byteLength`, and decode `buf.subarray(0, maxBytes)` with `new TextDecoder('utf-8')`. A multi-byte sequence split at the boundary becomes U+FFFD; that is accepted and stated here.
- `truncated` is returned to the caller; the marker text is the **caller's** business, not the reader's (`intent` truncates silently today and must keep doing so).
- No message string, no absolute path and no file content may appear in a failure result.

**Skills:** `onion-architecture`, `security`, `typescript-expert`
**Verify:** `cd server && pnpm exec vitest run test/clone-reader.test.ts test/intent-docs.test.ts` · then, once: `cd server && pnpm typecheck` · `cd server && pnpm arch:check`
**Satisfies:** AC-27, AC-28

- [ ] **Step 1: Write the failing test** — `server/test/clone-reader.test.ts`. Mirror the fixture strategy of `test/intent-docs.test.ts` (probe `symlink` and junction support and `it.skip` when unavailable; `mkdtemp` a clone with **nested** files). Cases: reads a nested `.md`; `not_found` for an absent path; `outside` for `../../../etc/passwd` **and** `docs/../../outside.md`; `not_markdown` for `package.json`; `outside` for a symlink whose in-clone path is clean and whose target is outside, with assertions that neither the resolved target nor its content appears anywhere in the result; reads correctly when the clone root itself is reached through a junction/symlink; `truncated: true` with `text` shorter than the file and `bytes` equal to the file's real byte length when `maxBytes` is exceeded; a file of exactly `maxBytes` bytes is **not** truncated.
- [ ] **Step 2: Run it and see it fail** — `cd server && pnpm exec vitest run test/clone-reader.test.ts`. Expected: cannot resolve `../src/platform/clone-reader.js`.
- [ ] **Step 3: Write `platform/clone-reader.ts`** — move the confinement logic and its explanatory comment out of `modules/intent/docs.ts`, parameterising the byte cap.
- [ ] **Step 4: Rewrite `modules/intent/docs.ts` over it** — `CloneDocReader.read` now opens a `CloneReader` once per call, slices `relPaths` at `MAX_DOCS`, maps each `CloneReadResult` to its existing message (`outside` → `path resolves outside the repository`, `not_markdown` → `not a markdown file`, `not_found` → `not found in the repository clone`, all prefixed `${rel} was not read: `), keeps the `doc:${rel}` label, and keeps the surplus-references loop. Behaviour must be byte-identical.
- [ ] **Step 5: Run both suites and the wide gates once** — the commands in **Verify**. `intent-docs.test.ts` must pass **without being edited**; if it needs an edit, the extraction changed behaviour and is wrong.
- [ ] **Step 6: Commit** — `refactor(platform): extract the confined clone reader from the intent module` / body: why duplication was rejected, and that `intent-docs.test.ts` is unchanged and is the regression gate.

---

## Task 2: Contracts in both `vendor/shared` copies

**Files:**
- Modify: `server/src/vendor/shared/contracts/platform.ts` — a new `// ---- Project context ----` block placed after the existing `// ---- Project Context ----` `SpecFile`/`IndexStatus` pair (leave those two alone; they are dead and stay dead), and `context_roots` added to `SettingsKnown` (`:112-120`)
- Modify: `client/src/vendor/shared/contracts/platform.ts` — the identical edit, and nothing else
- Test: `server/test/project-context-contracts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, all exported from `@devdigest/shared`:
  - `ContextRootSegment` — `z.string().min(1)` refined to reject any value containing `/` or `\`, and to reject `.` and `..`.
  - `SettingsKnown.context_roots` — `z.array(ContextRootSegment).default(['specs','docs','insights'])`.
  - `ContextDoc` — `{ path, root, size_bytes, token_estimate, used_by_agents }` (path is repo-relative POSIX; `root` is the matched root segment).
  - `ContextDocList` — `{ status: z.enum(['ok','no_clone']), roots: string[], docs: ContextDoc[], omitted: number, scanned_at: string }`.
  - `ContextDocContent` — `{ path, content, size_bytes, truncated }`.
  - `ContextAttachmentRow` — `{ path, root, size_bytes, token_estimate, repo_id, source: z.enum(['direct','inherited']), skill_id: nullable, skill_name: nullable, missing: boolean }`.
  - `ContextAttachmentsView` — `{ direct_count, effective_count, discovered_count, token_estimate, rows: ContextAttachmentRow[] }`.
  - `ContextAttachmentsUpdate` — `{ repo_id: uuid, paths: z.array(z.string().min(1).max(1024)) }`.
  - `ContextPreview` — `{ block: string, unread: string[] }`.

**Constraints:**
- `Settings` is `.passthrough()`, so an untyped row would also *work* — the typed entry exists precisely so `../..` is rejected at the write boundary (AC-74). Do not weaken it to `z.array(z.string())`.
- Snake_case wire fields, matching every neighbour in `platform.ts`.

**Skills:** `zod`, `typescript-expert`
**Verify:** `cd server && pnpm exec vitest run test/project-context-contracts.test.ts` · then once: `cd server && pnpm typecheck` · `cd client && pnpm typecheck`
**Satisfies:** AC-74 (and the wire half of AC-6, AC-7, AC-9, AC-42, AC-49, AC-64, AC-65)

- [ ] **Step 1: Write the failing test** — parse a well-formed `ContextDocList` and a `no_clone` one; assert `SettingsKnown` **rejects** `context_roots: ['../x']`, `['a/b']`, `['a\\b']`, `['.']`, `['..']`, `['']` and **accepts** `['specs','adr']`; assert `SettingsUpdate.safeParse({ context_roots: ['../..'] }).success === false` (this is what makes AC-75 a 422); assert `ContextAttachmentsUpdate` rejects a 1025-character path.
- [ ] **Step 2: Run it and see it fail** — the exports do not exist.
- [ ] **Step 3: Edit the server copy.**
- [ ] **Step 4: Apply the identical block to the client copy** — sync only the new block and the `SettingsKnown` line; the two files have drifted elsewhere.
- [ ] **Step 5: Run the test and both typechecks once.**
- [ ] **Step 6: Commit** — `feat(shared): project-context contracts and a typed context_roots key`.

---

## Task 3: `context_attachments` table + migration

**Files:**
- Modify: `server/src/db/schema/context.ts` (append; the file already holds `code_chunks`, `symbols`, `references`, `onboarding`)
- Modify: `server/src/db/schema.ts` (barrel export)
- Create: `server/src/db/migrations/00NN_*.sql` — **generated**, never hand-written
- Test: none of its own — the table is exercised by Task 6's `project-context.it.test.ts`; this task's proof is the generated SQL, a successful migrate, and a successful re-seed

**Interfaces:**
- Produces `t.contextAttachments` with columns: `id` uuid pk default random · `workspaceId` uuid not null → `workspaces` cascade · `ownerKind` text enum `['agent','skill']` not null · `agentId` uuid → `agents` cascade (nullable) · `skillId` uuid → `skills` cascade (nullable) · `repoId` uuid not null → `repos` cascade · `path` text not null · `order` integer not null default 0 · `createdAt` `now()`.
- Indexes: `context_attachments_agent_uq` — unique on `(agentId, repoId, path)` **partial**, `WHERE agent_id IS NOT NULL`; `context_attachments_skill_uq` — unique on `(skillId, repoId, path)` **partial**, `WHERE skill_id IS NOT NULL`; plus a plain index on `(repoId)` for the usage aggregate.

**Constraints:**
- **Partial unique indexes, not plain ones.** `settings_ws_user_key_uq` is the cautionary tale the spec records as edge case 34: Postgres treats NULLs as distinct unless an index is `NULLS NOT DISTINCT`, so a plain unique index over a nullable owner column would not dedupe at all.
- Two nullable owner FKs rather than one polymorphic `owner_id`, because AC-15's sibling needs `ON DELETE CASCADE` from **both** `agents` and `skills`, and a polymorphic column cannot carry one.
- Add `check('context_attachments_one_owner', sql\`(agent_id IS NOT NULL) <> (skill_id IS NOT NULL)\`)`. This is the first `check()` in this schema; if `pnpm db:generate` (drizzle-kit 0.30.1) omits it from the SQL, **remove it from the schema file** and rely on the repository being the table's only writer — do **not** hand-write it into the generated migration. Record which happened in the commit body.
- Document text is never stored here (AC-10) — there is no content column and there must not be one.

**Skills:** `drizzle-orm-patterns`, `postgresql-table-design`
**Verify:** `cd server && pnpm db:generate` (read the SQL: one `CREATE TABLE`, two partial unique indexes, three FKs with `ON DELETE CASCADE`) · `cd server && pnpm db:migrate` · `cd server && pnpm db:seed` (must still succeed) · `cd server && pnpm typecheck`
**Satisfies:** AC-10 (storage shape), AC-15

- [ ] **Step 1: Add the table to `schema/context.ts`** with a header comment stating why the owner is two nullable FKs and why the unique indexes are partial.
- [ ] **Step 2: Export it from the barrel** `src/db/schema.ts`.
- [ ] **Step 3: Generate the migration** — `pnpm db:generate`. Adding a table alongside no column drops means no interactive prompt.
- [ ] **Step 4: Apply, re-seed and typecheck** — the commands in **Verify**, once.
- [ ] **Step 5: Commit** — `feat(db): context_attachments — paths only, cascaded from agent, skill and repo`.

---

## Task 4: Module core — `domain.ts`, `constants.ts`, `helpers.ts`

**Files:**
- Create: `server/src/modules/project-context/domain.ts`, `constants.ts`, `helpers.ts`
- Test: `server/test/project-context-helpers.test.ts`

**Interfaces:**
- Consumes: `ContextDoc`, `ContextRootSegment` from `@devdigest/shared` (Task 2).
- Produces (`helpers.ts`, all pure, no fs and no clock):
  ```ts
  toPosix(nativeRelPath: string): string                              // .split(path.sep).join('/')
  isUnderRoots(posixRelPath: string, roots: string[]): string | null  // → matched root segment, or null
  parseRoots(stored: unknown): string[]                               // Zod-parse; on failure → DEFAULT_CONTEXT_ROOTS
  capList<T extends { path: string }>(docs: T[], max: number): { docs: T[]; omitted: number }
  orderAndDedupe(input: OrderInput): OrderedDoc[]                     // agent-direct first, then enabled skills in link order
  applyReadCap(docs: OrderedDoc[], max: number): { read: OrderedDoc[]; dropped: OrderedDoc[] }
  truncateForPrompt(text: string, totalBytes: number, max: number): string
  formatSpecRead(path: string, tokens: number): string
  formatSpecUnread(path: string, reason: UnreadReason): string
  sumTokens(rows: { path: string; token_estimate: number }[]): number // deduped by path
  effectiveSet(direct: string[], inherited: { path: string; skillId: string; skillName: string }[]): EffectiveRow[]
  logSummaryLine(attached: number, read: number): string
  ```
  `OrderInput = { direct: AttachmentRecord[]; skills: { id: string; name: string; enabled: boolean; attachments: AttachmentRecord[] }[] }`.

**Constraints:**
- `isUnderRoots` matches a root as a **path segment at any depth** and compares it **case-sensitively** against the configured names, while the `.md` extension check (in `walk.ts`) is case-**insensitive** — edge case 4 turns on exactly that asymmetry.
- `orderAndDedupe`: agent-attached documents in stored order, then skill-inherited in linked-skill order and within a skill in its stored order; **first occurrence wins**; a skill with `enabled: false` contributes nothing (AC-20). The dedupe key is the normalised POSIX path.
- `sumTokens` and `effectiveSet` must be built from the **same** deduped set that `orderAndDedupe` produces, so AC-64, AC-66 and AC-67 cannot disagree with AC-18.
- `parseRoots` never throws and never widens the walk: any unparseable stored value yields exactly `DEFAULT_CONTEXT_ROOTS` (AC-77).
- The four exact string formats from Global Constraints are produced **here** and nowhere else, so the trace, the log and the tests share one source.
- Nothing in this file may import `drizzle-orm`, `db/schema.js` or `node:fs`.

**Skills:** `onion-architecture`, `typescript-expert`, `zod`
**Verify:** `cd server && pnpm exec vitest run test/project-context-helpers.test.ts` · then once: `cd server && pnpm typecheck` · `cd server && pnpm arch:check`
**Satisfies:** AC-1 (predicate), AC-2 (normalisation), AC-3 (defaults), AC-8, AC-17, AC-18, AC-20, AC-24 (marker), AC-25, AC-31, AC-32, AC-66, AC-67, AC-72 (line text), AC-76, AC-77

- [ ] **Step 1: Write the failing test.** Table-driven, one `describe` per helper. The cases that must be present because a plausible implementation gets them wrong:
  - `isUnderRoots('server/src/modules/x/docs/y.md', DEFAULT)` → `'docs'` (root at depth, AC-1); `isUnderRoots('Specs/a.md', DEFAULT)` → `null` (case-sensitive roots, edge case 4); a root name appearing as a *filename* substring (`mydocs/a.md`) → `null` (segment, not substring).
  - `toPosix` on a **nested** native path produces exactly one form of separator (AC-2).
  - `parseRoots` for: absent (`undefined`) → defaults; `['adr']` → `['adr']`; `['../..']`, `['a/b']`, `'specs'`, `42`, `[]` → defaults, and never a throw (AC-76, AC-77). Assert the returned array is not the module constant by identity, so a caller cannot mutate the default.
  - `orderAndDedupe`: agent-then-skill order; two skills carrying the same path → kept once in the earlier-linked skill's position (edge case 17); a path attached both directly and by a skill → kept once in the **agent's** position (edge case 16); a disabled skill contributes nothing (edge case 18).
  - `applyReadCap` with 25 documents → 20 read, 5 dropped in order (AC-25).
  - `truncateForPrompt` produces exactly `<first 65536 bytes>\n[truncated: 65536 of 3145728 bytes]`, and returns the input unchanged at exactly 65 536 bytes.
  - `formatSpecRead('specs/a.md', 412)` → `'specs/a.md (~412 tokens)'`; `formatSpecUnread('specs/a.md', 'no repository clone on disk')` → `'specs/a.md — not read: no repository clone on disk'` (assert the em dash by codepoint).
  - `sumTokens` counts a duplicated path once (AC-67); `logSummaryLine(0, 0)` → `'Project context: 0 attached, 0 read'` (AC-72).
- [ ] **Step 2: Run it and see it fail** — cannot resolve `helpers.js`.
- [ ] **Step 3: Write `domain.ts`, then `constants.ts`, then `helpers.ts`** — `helpers.ts` imports downward from `domain.ts` and `constants.ts` only.
- [ ] **Step 4: Run the focused test, then the wide gates once.**
- [ ] **Step 5: Commit** — `feat(project-context): domain, caps and the pure ordering/format helpers`.

---

## Task 5: `walk.ts` — discovery over the clone

**Files:**
- Create: `server/src/modules/project-context/walk.ts`
- Test: `server/test/project-context-walk.test.ts`

**Interfaces:**
- Consumes: `EXCLUDED_DIRS`, `MAX_LIST_DOCS` from `constants.ts`; `isUnderRoots`, `toPosix`, `capList` from `helpers.ts`.
- Produces:
  ```ts
  export interface WalkedDoc { path: string; root: string; sizeBytes: number }
  export class CloneWalker {
    /** Never throws. A clone path that is absent or unreadable yields []. */
    walk(clonePath: string, roots: string[]): Promise<{ docs: WalkedDoc[]; omitted: number }>;
  }
  ```
  Results are sorted by ascending `path` **before** the cap is applied (AC-8).

**Constraints:**
- One recursive walk with `readdir(dir, { withFileTypes: true })`; **never follow a symlink** — `dirent.isSymbolicLink()` is skipped outright, for both files and directories (AC-5).
- Skip any directory whose name is in `EXCLUDED_DIRS`, at any depth (AC-4).
- `.md` matching is case-insensitive; the root-segment match is case-sensitive (AC-1, edge case 4).
- Every returned path is repo-relative and POSIX (AC-2). Build native paths with `path.join`; normalise once, at this boundary. Never `relative()`'s raw output — that is the 2026-08-10 depgraph bug.
- An unreadable subdirectory is skipped and the walk continues (the NFR degradation row).
- Size comes from `stat().size`, i.e. **bytes** (AC-6).

**Skills:** `onion-architecture`, `security`, `typescript-expert`
**Verify:** `cd server && pnpm exec vitest run test/project-context-walk.test.ts` · then once: `cd server && pnpm typecheck` · `cd server && pnpm arch:check`
**Satisfies:** AC-1, AC-2, AC-4, AC-5, AC-8

- [ ] **Step 1: Write the failing test.** `mkdtemp` a clone containing: `specs/a.md`; `server/src/modules/x/docs/y.md` (root at depth — and **nested**, so a separator bug can surface); `insights/deep/nested/z.MD` (case-insensitive extension); `docs/notes.txt` (ignored); `node_modules/pkg/docs/dep.md` and `.git/docs/g.md` (excluded); a directory symlink into a sibling tree holding `docs/linked.md` (must not be traversed — probe support and `it.skip` like `intent-docs.test.ts` does); 520 files under `specs/` in a second fixture for the cap. Assertions: every returned path contains `/` and no `\`; the depth-2 path is present with `root === 'docs'`; the excluded trees contribute nothing; the symlinked tree contributes nothing; `docs.length === 500` with `omitted === 20` and the 500 are the lexicographically first; a non-existent clone path yields `{ docs: [], omitted: 0 }` and does not throw.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Write `walk.ts`.**
- [ ] **Step 4: Run the focused test, then the wide gates once.**
- [ ] **Step 5: Commit** — `feat(project-context): symlink-safe .md discovery under the configured roots`.

---

## Task 6: `repository.ts` — attachments, the locked replace, and one usage aggregate

**Files:**
- Create: `server/src/modules/project-context/repository.ts`
- Test: `server/test/project-context.it.test.ts` (DB-backed; **repository-level cases only in this task** — Task 8 adds the route cases to the same file, nested under the same outer `describe`)

**Interfaces:**
- Consumes: `t.contextAttachments`, `t.agents`, `t.agentVersions`, `t.agentSkills`, `t.skills`, `t.repos`, `t.settings`; `domain.ts` types.
- Produces `class ProjectContextRepository`:
  ```ts
  constructor(private db: Db)
  getRepo(workspaceId, repoId): Promise<RepoRef | undefined>            // { id, fullName, clonePath }
  roots(workspaceId): Promise<string[]>                                  // parseRoots over the settings row
  usageCounts(workspaceId, repoId): Promise<Map<string, number>>         // ONE query — see constraints
  attachmentsFor(ownerKind, ownerId, repoId | null): Promise<AttachmentRecord[]>
  agentBundle(workspaceId, agentId, repoId): Promise<AgentBundle | undefined>
      // { direct: AttachmentRecord[]; skills: { id, name, enabled, attachments }[] } — link order preserved
  skillOwner(workspaceId, skillId): Promise<{ id: string; name: string } | undefined>
  replaceAgentAttachments(workspaceId, agentId, repoId, paths: string[]): Promise<number>   // → new agent version
  replaceSkillAttachments(workspaceId, skillId, repoId, paths: string[]): Promise<void>
  resolveForRun(agentId, repoId): Promise<OrderInput>                    // repo-matched only
  ```

**Constraints:**
- **`replaceAgentAttachments` is one `db.transaction`**, and inside it, in this order: `select … from agents where id and workspaceId` **`.for('update')`** (undefined → return without writing, so the route 404s) → delete this `(agent, repo)`'s rows → insert the new rows with `order = index` → `update agents set version = sql\`version + 1\`` `.returning()` → insert one `agent_versions` row using **the returned version**. Every statement uses the `tx` handle; a snapshot written on `this.db` escapes the transaction. This is the shape `server/INSIGHTS.md` (2026-08-03, twice) prescribes, and it is deliberately **better than** `AgentsRepository.setSkills`, which neither locks nor transacts — do not copy that precedent.
- The snapshot's `configJson` mirrors `AgentsRepository.snapshotVersion`'s fields (`provider`, `model`, `system_prompt`, `output_schema`, `strategy`, `ci_fail_on`, `repo_intel`, `skills`) **plus** `context_paths: string[]` for this repo. Never `.onConflictDoNothing()` on the version number — a swallowed snapshot insert is the exact history loss the insight describes.
- **`usageCounts` is one round trip.** `context_attachments` joined to `agent_skills` (for `skill`-owned rows) and to `agents`, grouped by `path`, counting `DISTINCT agents.id`. A row reaches an agent when `agent_id = agents.id` **or** when `skill_id` is linked to that agent through `agent_skills` **and** `skills.enabled` is true. `agents.enabled` is **not** filtered (AC-57); `skills.enabled = false` **is** filtered (AC-73). Scope by `workspaceId` and `repoId`. Two queries per document over a 500-row list is the defect the NFR §Performance row names, and the it-test asserts the count.
- Every method takes and filters on `workspaceId` (AC-14). Nothing here throws `NotFound` — the service/route decides.
- `roots(workspaceId)` selects `settings` by `workspaceId` and `key = 'context_roots'` only, exactly as `GET /settings` does, then hands the raw `value` to `parseRoots` (AC-3, AC-76). No `ORDER BY` is added; edge cases 33/34 are recorded, not fixed here.
- Cross-table reads and writes stay **inside this repository**; never import `modules/agents/repository.ts`.

**Skills:** `drizzle-orm-patterns`, `postgresql-table-design`, `onion-architecture`, `security`
**Verify:** `cd server && pnpm exec vitest run test/project-context.it.test.ts` · then once: `cd server && pnpm typecheck` · `cd server && pnpm arch:check` · `cd server && pnpm test`
**Satisfies:** AC-3, AC-7 (row read), AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-19, AC-57, AC-68, AC-73

- [ ] **Step 1: Write the failing it-test.** **One** outer `describe` owns `startPg()` in `beforeAll` and closes it in `afterAll` (`server/INSIGHTS.md`, 2026-08-10 — sibling top-level blocks hand the second a closed pool). Fixture: seed, then `mkdtemp` a clone with `specs/a.md`, `docs/b.md`, `insights/c.md` and `db.update(t.repos).set({ clonePath: dir })` — **and assert the discovery-backed cases see a non-empty list**, because the seeded repo's `clone_path` is `null` and every clone-reading assertion would otherwise pass on the early return (`server/INSIGHTS.md`, 2026-08-03). Cases:
  - a 3 MB document attaches successfully (AC-11 — the cap binds at read time, not attach time);
  - replace writes `order = index`, and re-reading returns the stored order; assert the `[path, order]` **pairs sorted by path**, never the paths sorted by order — a stable sort makes the latter unfalsifiable (`server/INSIGHTS.md`, 2026-08-03);
  - one replace bumps `agents.version` by exactly 1 and writes exactly one `agent_versions` row whose `configJson.context_paths` is the ordered list (AC-12);
  - **the race** (AC-13): two concurrent replaces, run as **both orderings** (`[a(),b()]` and `[b(),a()]`) repeated 3× each inside one `it`, with the ordering and iteration in the assertion message. Each call must produce a distinct version and its own snapshot; the final row's version must be `start + 2`. A single-ordering, single-shot race test passes against the broken code ~3 in 8 times (`server/INSIGHTS.md`, 2026-08-03);
  - an agent/skill/repo in another workspace yields `undefined` (AC-14);
  - deleting the repo removes its attachments; deleting a skill removes its attachments (AC-15);
  - usage counts: one skill carrying two documents linked to three agents → each document counts **3**, not 6 (edge case 19); a **disabled agent** with a direct attachment still counts (AC-57, edge case 35); a document reachable only through a **disabled skill** counts 0 for that agent (AC-73, edge case 36); a path attached both directly and via a skill to the same agent counts **1** (edge case 20); and the whole map for 3 documents is produced in **one** query — assert the query count with a spy on the db handle, not merely the numbers;
  - `roots()` returns the defaults with no row, the stored value with a valid row, and the defaults for a row holding `['../..']` (AC-3, AC-77);
  - `resolveForRun` omits attachments whose `repo_id` differs from the PR's repo (AC-19).
- [ ] **Step 2: Run it and see it fail** — cannot resolve `repository.js`. (If Docker is unavailable the file self-skips; say so in the report rather than proceeding as if it passed.)
- [ ] **Step 3: Write `repository.ts`.** Write `usageCounts` and the transaction first — they are the two places a plausible implementation is wrong.
- [ ] **Step 4: Run the it-test, then the wide gates once.**
- [ ] **Step 5: Commit** — `feat(project-context): attachment persistence with a locked replace and one usage aggregate`.

---

## Task 7: `ports.ts` + `service.ts` — the use-cases

**Files:**
- Create: `server/src/modules/project-context/ports.ts`, `server/src/modules/project-context/service.ts`
- Test: `server/test/project-context-service.test.ts` (hermetic — fake ports, no DB, no fs)

**Interfaces:**
- Consumes: `helpers.ts`, `domain.ts`, `constants.ts`; `wrapUntrusted` from `@devdigest/reviewer-core`.
- Produces:
  ```ts
  export interface ProjectContextDeps {
    store: {                                   // implemented by repository.ts
      getRepo; roots; usageCounts; attachmentsFor; agentBundle; skillOwner;
      replaceAgentAttachments; replaceSkillAttachments; resolveForRun;
    };
    walker: { walk(clonePath: string, roots: string[]): Promise<{ docs: WalkedDoc[]; omitted: number }> };
    reader: { open(clonePath: string): Promise<{ read(rel: string, maxBytes: number): Promise<CloneReadResult> }> };
    tokenCount: (text: string) => number;
    logger?: PinoLike;
  }

  export class ProjectContextService {
    constructor(private deps: ProjectContextDeps)
    listDocuments(workspaceId, repoId): Promise<ContextDocList>
    readDocument(workspaceId, repoId, path): Promise<ContextDocContent>          // NotFoundError when unread
    attachmentsForAgent(workspaceId, agentId, repoId): Promise<ContextAttachmentsView>
    attachmentsForSkill(workspaceId, skillId, repoId): Promise<ContextAttachmentsView>
    setAttachments(workspaceId, owner: { kind; id }, repoId, paths): Promise<ContextAttachmentsView>
    previewForSkill(workspaceId, skillId, repoId): Promise<ContextPreview>
    resolveForRun(agentId, repoId, clonePath: string | null):
      Promise<{ specs: string[]; readEntries: string[]; unreadEntries: string[]; attached: number; notes: RunNote[] }>
  }
  ```
  `RunNote = { kind: 'truncated' | 'unread'; path: string; reason?: UnreadReason }` — the executor turns these into Live Log lines, so the service never touches the run bus.

**Constraints:**
- `listDocuments`: no `clonePath` → `{ status: 'no_clone', docs: [], omitted: 0, roots, scanned_at }` and **HTTP 200** (AC-7). Otherwise walk, then attach `token_estimate` per document via `deps.tokenCount` over the document's **text** — which means the list endpoint reads the files it lists, bounded by the 500 cap. `used_by_agents` comes from the single `usageCounts` map (AC-6, AC-9).
- `resolveForRun` is the run path and the security-critical one:
  - resolve the owner bundle, `orderAndDedupe`, `applyReadCap(…, 20)` — dropped documents become unread entries reading `only 20 documents are read per run` (AC-25);
  - open **one** `CloneReader` per run and read each path with `MAX_DOC_BYTES`; map `outside` → `path resolves outside the repository` (AC-27, AC-28), `not_found` → `not found in the repository clone` (AC-26), `truncated: true` → `truncateForPrompt` plus a `truncated` note (AC-24);
  - `clonePath === null` → **every** attached path becomes an unread entry reading `no repository clone on disk`, and `specs` is empty (AC-30);
  - cross-repo attachments are excluded upstream by `store.resolveForRun` and appear **nowhere** in the entries (AC-19);
  - the method must be safe to call for an agent with `repo_intel: false` — nothing here reads that flag (AC-21).
- `previewForSkill` runs the same document resolution for a skill owner and returns `block = '## Project context\n' + specs.map((s, i) => wrapUntrusted(\`spec-${i}\`, s)).join('\n\n')`, plus the unread entries. It must produce the **byte-identical** section `assemblePrompt` produces for the same `specs` array — the test proves it against the real function (AC-49).
- `readDocument` re-confines the client-supplied path through `deps.reader` (never trusts it because it appeared in a discovery result) and caps at `MAX_DOC_BYTES`.
- Nothing in `service.ts` imports `drizzle-orm`, `db/schema.js`, `fastify` or `node:fs`. Importing `@devdigest/reviewer-core` is fine — it is a pure package and `core-no-sdk` does not list it.
- `setAttachments` returns the fresh view so the client's optimistic state reconciles in one round trip.

**Skills:** `onion-architecture`, `security`, `typescript-expert`, `zod`
**Verify:** `cd server && pnpm exec vitest run test/project-context-service.test.ts` · then once: `cd server && pnpm typecheck` · `cd server && pnpm arch:check` · `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
**Satisfies:** AC-6, AC-7, AC-16 (resolution half), AC-19, AC-20, AC-21, AC-22, AC-25, AC-26, AC-27, AC-28, AC-29, AC-30, AC-49, AC-64, AC-65, AC-66

- [ ] **Step 1: Write the failing test.** Fake ports throughout; `tokenCount: (t) => Math.ceil(t.length / 4)`. Cases: `no_clone` → status and empty list, never a throw (AC-7); order and dedupe end-to-end through the service (AC-17, AC-18); a disabled linked skill contributes nothing (AC-20); 25 resolved documents → 20 read, 5 unread with the exact reason (AC-25); a reader returning `outside` / `not_found` → the exact reasons, with the readable documents still in `specs` (AC-26…AC-28); `truncated` → the marker present and one `truncated` note (AC-24); `clonePath: null` with 3 attachments → `specs: []` and 3 unread entries reading `no repository clone on disk` (AC-30); a store that **throws** → `resolveForRun` rejects, so Task 9's catch has something to catch (AC-29); zero resolved documents → `specs: []`, which is what lets the executor omit the key (AC-22); **AC-49's lock**: two fixture documents through `previewForSkill`, asserting its `block` equals the `## Project context` section extracted from `assemblePrompt({ system: 's', diff: 'd', task: 't', specs: [a, b] })`'s user message — imported from `@devdigest/reviewer-core`, so a change to `wrapUntrusted` fails **this** suite (CI runs the server workflows on `reviewer-core/**`).
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Write `ports.ts`, then `service.ts`.**
- [ ] **Step 4: Run the focused test, then the wide gates once.**
- [ ] **Step 5: Invoke the `security` skill and review this task's diff against the threat model** — document text and document paths are attacker-controlled by anyone who can open a PR against the reviewed repository. Confirm on paper: every path reaching the filesystem passes both confinement checks; every document reaching a prompt goes through the `specs` slot; both caps bind at read time; no failure message carries a resolved path or file content. Record the verdict in the task report. This is the early pass — do not leave the security review to the end.
- [ ] **Step 6: Commit** — `feat(project-context): discovery, attachment and run-resolution use-cases`.

---

## Task 8: Routes, container wiring, registration

**Files:**
- Create: `server/src/modules/project-context/routes.ts`
- Modify: `server/src/platform/container.ts` (two getters), `server/src/modules/index.ts` (one import + one entry), `server/README.md` (API map)
- Test: extend `server/test/project-context.it.test.ts` with a nested `describe('routes')` inside the existing outer block

**Interfaces:**
- Produces these endpoints, all `getContext`-scoped:

  | Method + path | Body / query | Returns |
  |---|---|---|
  | `GET /repos/:repoId/context` | — | `ContextDocList` |
  | `GET /repos/:repoId/context/doc` | `?path=` (≤ 1024 chars) | `ContextDocContent` |
  | `GET /agents/:agentId/context` | `?repoId=uuid` | `ContextAttachmentsView` |
  | `PUT /agents/:agentId/context` | `ContextAttachmentsUpdate` | `ContextAttachmentsView` |
  | `GET /skills/:skillId/context` | `?repoId=uuid` | `ContextAttachmentsView` |
  | `PUT /skills/:skillId/context` | `ContextAttachmentsUpdate` | `ContextAttachmentsView` |
  | `GET /skills/:skillId/context/preview` | `?repoId=uuid` | `ContextPreview` |

- Produces `container.projectContextRepo` (lazy, cached, `new ProjectContextRepository(this.db)`) and `container.projectContext` (the service, deps assembled here: `store: this.projectContextRepo`, `walker: new CloneWalker()`, `reader: { open: CloneReader.open }`, `tokenCount: (t) => this.tokenizer.count(t)`, `...(this.logger ? { logger: this.logger } : {})`).

**Constraints:**
- Route ids are `z.string().uuid()` — a non-uuid is a **422**, not a 404 (the spec's Inputs table). A well-formed id belonging to another workspace is a **404, never a 403** (AC-14).
- No Drizzle and no `db/schema` import in `routes.ts` (`routes-no-persistence`).
- Registration is static in `modules/index.ts`; do not switch anything to dynamic `import()`.
- AC-75 needs **no new code**: `PUT /settings` already validates `SettingsUpdate`, and Task 2's typed key makes `context_roots: ['../..']` a 422 via `app.ts:121`. It still needs a **test**, and that test belongs here.
- `GET /repos/:repoId/context` must return 200 with `status: 'no_clone'` for the seeded repo — never a 5xx (AC-7).

**Skills:** `fastify-best-practices`, `onion-architecture`, `zod`, `security`
**Verify:** `cd server && pnpm exec vitest run test/project-context.it.test.ts` · then once: `cd server && pnpm typecheck` · `cd server && pnpm arch:check` · `cd server && pnpm test`
**Satisfies:** AC-14, AC-75 (and the HTTP surface for AC-6…AC-9, AC-42, AC-49)

- [ ] **Step 1: Write the failing route cases** (nested in the existing outer `describe`): the seeded repo returns 200 + `no_clone`; with the `mkdtemp` clone attached, the list is non-empty and every path is POSIX; `?path=../../etc/passwd` on the doc endpoint is refused with the "outside the repository" reason and no file content in the body; a `PUT` for another workspace's agent is 404; a non-uuid agent id is 422; `PUT /settings { context_roots: ['../..'] }` is **422** and no row is written; `PUT /settings { context_roots: ['adr'] }` is 200 and the next discovery searches `adr`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Write `routes.ts`; add the two container getters; register the module; update the README API map.**
- [ ] **Step 4: Run the it-test, then the wide gates once.**
- [ ] **Step 5: Commit** — `feat(project-context): HTTP surface, container wiring and module registration`.

---

## Task 9: Inject into the review run

**Files:**
- Modify: `server/src/modules/reviews/run-executor.ts` — the per-agent path around `:236-250` (beside the linked-skill resolution) and both trace constructions (`:351`, `:510`)
- Test: `server/test/project-context-review.it.test.ts` (new, DB-backed); plus hermetic cases added to `server/test/project-context-service.test.ts` for the byte-identical prompt and the archived-trace parse

**Interfaces:**
- Consumes: `this.container.projectContext.resolveForRun(agent.id, pull.repoId, repo.clonePath)` — **off the container**, with no import from `modules/project-context/` (that would trip `no-cross-module-internals`, type-only or not).
- Produces: `specs` passed to `reviewPullRequest` with the same omit-when-empty spread the neighbours use — `...(specs.length > 0 ? { specs } : {})`; `specs_read: [...readEntries, ...unreadEntries]` on the success trace; the Live Log lines.

**Constraints:**
- **Best-effort, like repo-intel and unlike skills:** wrap the resolve in `try/catch`; on failure log one line and continue with no `## Project context` section (AC-29). The run must never fail on project context.
- `specs_read` order is: read entries in the AC-17 order, then unread entries. Each path appears **once** across the two lists (AC-18, AC-67).
- The Live Log summary line is emitted **always**, including for zero attachments (AC-70, AC-72), and **before** the model call so it is visible in flight (AC-71). Per-document lines follow it.
- These are `runLog.info(...)` calls, not a new event kind — see Requirements review and Recommendation 3. Every existing best-effort degradation in this file is an `info` line.
- `traceFromBuffer` (the failure/cancel path) keeps `specs_read: []`; a cancelled run's trace is unchanged (edge case 29).
- `RunTrace` gains no field and no element-shape change (AC-33).
- Do not touch `service.ts:93-156`, the ad-hoc review path — it has no repository and no pull request (non-goal).

**Skills:** `onion-architecture`, `security`, `typescript-expert`
**Verify:** `cd server && pnpm exec vitest run test/project-context-review.it.test.ts` · then once: `cd server && pnpm typecheck` · `cd server && pnpm arch:check` · `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` · `cd server && pnpm test`
**Satisfies:** AC-16, AC-21, AC-22, AC-23, AC-24 (log line), AC-26 (log line), AC-29, AC-30, AC-31, AC-32, AC-33, AC-34, AC-70, AC-71, AC-72

- [ ] **Step 1: Write the failing tests.**
  - Hermetic, in `project-context-service.test.ts`: **AC-22 byte comparison** — `assemblePrompt(base)`, `assemblePrompt({ ...base, specs: [] })` and `assemblePrompt(base)` with the key absent must produce byte-identical user messages, which is what proves an agent with zero attachments is indistinguishable from the pre-feature state (edge case 25). **AC-23** — with one document the user message contains `## Project context` and `<untrusted source="spec-0">`, and a document containing the literal `</untrusted>` comes out neutralised as `<\/untrusted>` (edge case 14). **AC-33** — parse an archived trace fixture (`specs_read: []`, no new keys) against `RunTrace` and assert it still validates.
  - DB-backed, in `project-context-review.it.test.ts`: one outer `describe` owning the container; `mkdtemp` a clone with `specs/rate-limit.md` carrying a known string, and `db.update(t.repos).set({ clonePath: dir })`; attach it to the seeded agent; run `POST /pulls/:id/review` with the mock LLM provider. Assert: `prompt_assembly.specs` is **non-null** and contains the document's text (AC-34); `specs_read` has exactly one entry matching `/^specs\/rate-limit\.md \(~\d+ tokens\)$/` (AC-31); the **SSE buffer** from `GET /runs/:id/events` — not `GET /runs/:id/trace` — contains `Project context: 1 attached, 1 read` (AC-70, AC-71; `server/INSIGHTS.md`, 2026-08-05 records that reading the trace after a terminal status races and 404s); an agent with `repo_intel: false` still gets the section (AC-21); one direct document plus a linked skill carrying two more yields exactly **three** `specs_read` entries (this is AC-69's behaviour, covered here instead of by the deferred e2e flow); a second repo whose `clone_path` stays `null` with one attachment yields one `— not read: no repository clone on disk` entry and no specs block (AC-30); an attached-then-deleted file yields the `not found in the repository clone` entry plus a Live Log line, and the run still completes `done` (AC-26).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Wire the executor.** Resolve once per agent run, next to the linked-skill resolution; spread `specs`; build `specs_read`; emit the summary line then the per-document lines.
- [ ] **Step 4: Run both suites, then the wide gates once.**
- [ ] **Step 5: Commit** — `feat(reviews): inject attached project-context documents into the review prompt`.

---

## Task 10: Client hooks and query keys

**Files:**
- Create: `client/src/lib/hooks/project-context.ts`
- Modify: `client/src/lib/hooks/core.ts` (delete `useContextFiles` at `:122` and `useReindexContext` at `:131`, and the now-unused `SpecFile`/`IndexStatus` imports if nothing else uses them), `client/src/lib/hooks/index.ts` if it re-exports
- Test: `client/src/lib/hooks/project-context.test.ts`

**Interfaces:**
- Produces: `useContextDocs(repoId)` → key `["context-docs", repoId]`; `useContextDoc(repoId, path)` → `["context-doc", repoId, path]`, `enabled` only when both are set; `useAgentContext(agentId, repoId)` → `["agent-context", agentId, repoId]`; `useSkillContext(skillId, repoId)` → `["skill-context", skillId, repoId]`; `useSkillContextPreview(skillId, repoId)` → `["skill-context-preview", skillId, repoId]`; `useSetContextAttachments()` — one mutation taking `{ ownerKind, ownerId, repoId, paths }`.
- On success the mutation invalidates, in this order: the owner's own key, `["context-docs", repoId]` (**this is AC-59 — the usage counter moves without a reload**), `["skill-context-preview", …]` when the owner is a skill, and `["agent", ownerId]` + `["agents"]` when it is an agent (the version bumped).

**Constraints:**
- One path only: component → hook → `api` from `src/lib/api.ts`. Never `fetch` in a component.
- **One** `useMutation` instance shared by every row, not one per row: `mutate` re-points the single mutation observer, which is what makes the optimistic revert in Tasks 12/13 safe under rapid toggling (`client/INSIGHTS.md`, 2026-08-03). Splitting it would need explicit ordering.
- The two deleted hooks have zero callers and target endpoints the server never implemented — delete them rather than repointing them, so nothing dangles.

**Skills:** `react-best-practices`, `frontend-architecture`, `typescript-expert`
**Verify:** `cd client && pnpm exec vitest run src/lib/hooks/project-context.test.ts` · then once: `cd client && pnpm typecheck` · `cd client && pnpm test`
**Satisfies:** AC-59 (the invalidation half)

- [ ] **Step 1: Write the failing test** — render the mutation through a `QueryClient` built with `defaultOptions: { queries: { retry: false } }` (a bare `new QueryClient()` retries 3× with backoff and makes an error-state assertion read as broken — `client/INSIGHTS.md`, 2026-08-03), stub `fetch`, fire the mutation, and assert the **invalidated query keys** include `["context-docs", repoId]`. Stub a failure as `{ ok: false, status, json: async () => ({ error: { message } }) }` so `ApiError` carries real text.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Write the hooks; delete the two dead ones.**
- [ ] **Step 4: Run the focused test, then both wide gates once.**
- [ ] **Step 5: Commit** — `feat(client): project-context hooks; drop the two never-wired context hooks`.

---

## Task 11: The Project Context page

**Files:**
- Create: `client/src/app/repos/[repoId]/context/page.tsx`; `…/context/_components/ProjectContextView/{ProjectContextView.tsx,ProjectContextView.test.tsx,helpers.ts,helpers.test.ts,styles.ts,index.ts}`; `…/ProjectContextView/_components/DocRow/**`; `client/src/components/context-doc-preview/**` (the shared read-only modal)
- Modify: `client/messages/en/context.json` (rewritten), `client/src/vendor/ui/nav.ts` (one `NAV` item + one `SHORTCUTS` entry)
- Test: `ProjectContextView.test.tsx` (covers `DocRow` through it), `helpers.test.ts`

**Interfaces:**
- Consumes: `useContextDocs`, `useContextDoc` (Task 10); `useActiveRepo`, `useRepoNotFound`, `RepoNotFound`, `AppShell`.
- Produces: the route `/repos/:repoId/context`; `ContextDocPreview` — a modal taking `{ repoId, path, onClose }`, rendering content through the vendored `Markdown` primitive.

**Constraints:**
- **Read-only. There is no edit or save affordance anywhere on this page** (AC-37), no chunk count and no coverage figure (AC-38). The `mode.edit` and `editor.save` keys leave `context.json` with this task.
- The footer states the document count and the scan time, and nothing else (AC-38). Message key shape: `footer: "{count} documents · scanned {time}"`.
- `status === 'no_clone'` → an explanatory empty state naming the repository as not cloned, **not** an error state (AC-40). Zero documents with a clone → an empty state **naming the roots that were searched** (AC-41). `EmptyState` takes no children — put the roots list in `body`, which is a `ReactNode` (`client/INSIGHTS.md`, 2026-08-03).
- `empty.body`'s current text instructs the user to drop files under `.devdigest/specs/` and directly contradicts AC-3. Rewriting it is required, not optional (AC-52).
- Every string resolves through `next-intl`; no literal UI copy in the new components (AC-52).
- The rescan control re-runs discovery (invalidate + refetch `["context-docs", repoId]`) and the footer timestamp moves (AC-39).
- The nav item goes in the **`WORKSPACE`** group (AC-55): `{ key: "context", label: "Project Context", icon: "FileText", href: "/repos/:repoId/context", gKey: "x" }`, plus `{ keys: "g x", label: "Go to Project Context", group: "Navigation" }` in `SHORTCUTS`. `shell.json`'s `nav.context` and `activeKeyFor`'s `/context` branch already exist — do not add either. This is the one edit to `vendor/ui/`; it is a data entry in a registry, not a refactor of a primitive.
- Match the neighbours' styling tier: `ConventionsView` uses a `styles.ts` of Tailwind class strings, while the `pulls/[number]` tier uses an `s` object of `CSSProperties`. This page sits beside `conventions`, so follow `ConventionsView` (`client/INSIGHTS.md`, 2026-08-06).

**Skills:** `next-best-practices`, `frontend-architecture`, `react-best-practices`, `react-testing-library`
**Verify:** `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/context` · then once: `cd client && pnpm typecheck` · `cd client && pnpm test`
**Satisfies:** AC-36, AC-37, AC-38, AC-39, AC-40, AC-41, AC-52, AC-55, AC-56, AC-58

- [ ] **Step 1: Write the failing test.** Stub `fetch` per case. Assert: one row per document with its path, its root label as **text** (never colour alone, AC-53) and its `Used by N agents` count (AC-58); selecting a row renders that document's content in the detail panel (AC-56); the footer states the count and the scan time and contains **neither** "chunks" **nor** "coverage" (AC-38); `queryAllByRole('button', { name: /edit|save/i })` is empty (AC-37); the rescan control triggers a refetch and the footer timestamp changes (AC-39); a `no_clone` payload renders the not-cloned empty state and **not** an error state (AC-40); an `ok` payload with `docs: []` renders an empty state whose text names `specs`, `docs`, `insights` (AC-41).
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Rewrite `context.json`, add the nav entries, then build `page.tsx`, `ProjectContextView`, `DocRow` and `ContextDocPreview`.**
- [ ] **Step 4: Run the focused tests, then both wide gates once.**
- [ ] **Step 5: Commit** — `feat(client): read-only Project Context page and its sidebar entry`.

---

## Task 12: The agent editor's `Context` tab

**Files:**
- Create: `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/{ContextTab.tsx,ContextTab.test.tsx,helpers.ts,helpers.test.ts,styles.ts,index.ts}` and `…/ContextTab/_components/ContextRow/**`
- Modify: `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` (a third `TABS` entry, `labelKey: "editor.tabs.context"`, icon `FileText`), `AgentEditor.tsx` (render it), `client/messages/en/agents.json` (`editor.tabs.context` + a `contextTab.*` block)
- Test: `ContextTab.test.tsx`, `helpers.test.ts`

**Interfaces:**
- Consumes: `useContextDocs`, `useAgentContext`, `useSetContextAttachments` (Task 10); `useActiveRepo`, `useRepos`; `SkillsTab`'s `@dnd-kit` setup as the reference.
- Produces: `orderRows(docs, view)` → attached-then-unattached rows; `moveAttached(paths, from, to)`; the tab itself.

**Constraints:**
- **Attached rows on top and draggable; unattached below, ordered by root segment then path** (AC-45) — the same deliberate deviation from the comp that `SkillsTab` documents in its own header, for the same reason.
- **No save control.** Every toggle and every reorder posts the complete ordered list immediately (AC-43), with `previous`-snapshot revert plus an error message on failure (AC-44). Use **one** mutation instance; the revert is safe only because `mutate` re-points the single observer (`client/INSIGHTS.md`, 2026-08-03) — do not add a sequence guard, and do not split into one mutation per row.
- **Inherited rows** render alongside direct ones, visually distinguished, and **name their source skill as queryable text** (AC-61, AC-62). An inherited row has **no detach control** and links to the owning skill instead (AC-63).
- The tab badge counts the **effective** set — direct plus inherited after dedupe — against the discovered count, with the direct-only count still readable beside it (AC-64, AC-65). Both numbers come from `ContextAttachmentsView`; do not recompute them per row in the client (that is the same N+1 defect moved).
- The token footer sums the **effective** set (AC-47, AC-66), prefixed with `≈` to mark it approximate. Where the agent's strategy can select map-reduce (`strategy === 'map-reduce' || strategy === 'auto'`), the footer also states that the block is re-sent once per changed file (AC-48).
- A row whose `repo_id` differs from the active repository renders **inactive** and is labelled with that repository's name (AC-50), resolved from `useRepos()`.
- An attached path absent from the latest discovery keeps its row, is marked as missing from the clone, and keeps its removal control (AC-51).
- Every checkbox is a real `<input type="checkbox">` with an accessible name naming its document (AC-53); the root segment is conveyed by its text label, not by chip colour.
- Filtering is a case-insensitive substring over the **full repo-relative path**, so typing `specs/` narrows by folder (AC-46).
- The drag affordance inherits `SkillsTab`'s `PointerSensor`-only configuration. Do **not** add a `KeyboardSensor` here alone — the gap, if it is one, belongs to both tabs (spec Open question 5).
- `fireEvent`, not `user-event` — the package has no `@testing-library/user-event`, and `fireEvent.click` dispatches no `mousedown` (`client/INSIGHTS.md`, 2026-07-29).

**Skills:** `react-best-practices`, `frontend-architecture`, `react-testing-library`, `typescript-expert`
**Verify:** `cd client && pnpm exec vitest run src/app/agents` · then once: `cd client && pnpm typecheck` · `cd client && pnpm test`
**Satisfies:** AC-42, AC-43, AC-44, AC-45, AC-46, AC-47, AC-48, AC-50, AC-51, AC-53, AC-59, AC-61, AC-62, AC-63, AC-64, AC-65, AC-66, AC-67

- [ ] **Step 1: Write the failing test.** Query every control **by accessible name** (AC-53). Cases: a checkbox toggle posts the full ordered list with no save control present (AC-43); a failed post restores the previous order and shows an error (AC-44); attached rows precede unattached ones and only attached rows expose a drag handle (AC-45); the filter narrows on a path substring, case-insensitively (AC-46); the footer shows `≈` and, for a map-reduce agent, the per-file re-send sentence — and not for a single-pass one (AC-47, AC-48); an inherited row shows its skill's **name as text**, exposes **no** detach control, and does expose a link to the skill (AC-61…AC-63); the badge reads the effective count against the discovered count with the direct count also present (AC-64, AC-65); a path attached both directly and via a skill appears **once** and is counted once in the badge and the footer (AC-67); a cross-repo row is inactive and names its repository (AC-50); a stored path absent from discovery is marked missing and still removable (AC-51); a successful toggle invalidates `["context-docs", repoId]` (AC-59).
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Add the catalogue block and the tab entry, then build `helpers.ts`, `ContextRow` and `ContextTab`.**
- [ ] **Step 4: Run the focused tests, then both wide gates once.**
- [ ] **Step 5: Commit** — `feat(client): agent Context tab with inherited documents and a token footer`.

---

## Task 13: The skill editor's `Project context to use` section

**Files:**
- Create: `client/src/app/skills/[id]/_components/SkillDetail/_components/ConfigTab/_components/ProjectContextSection/{ProjectContextSection.tsx,ProjectContextSection.test.tsx,styles.ts,index.ts}`
- Modify: `client/src/app/skills/[id]/_components/SkillDetail/_components/ConfigTab/ConfigTab.tsx` (render the section), `client/messages/en/skills.json` (a `projectContext.*` block)
- Test: `ProjectContextSection.test.tsx`

**Interfaces:**
- Consumes: `useContextDocs`, `useSkillContext`, `useSetContextAttachments`, `useSkillContextPreview` (Task 10); `ContextDocPreview` (Task 11); Task 12's row component if it generalises cleanly — otherwise a local row, but **not** a fork of `ContextRow`'s styling.
- Produces: the section, including a `SERIALIZES AS` panel rendering `ContextPreview.block` verbatim in a monospace surface, plus the unread list when non-empty.

**Constraints:**
- The panel renders the **server-assembled** block — the real `## Project context` heading and each document wrapped as `<untrusted source="spec-N">` around its full text (AC-49). It must **not** render the comp's `## Project specifications` heading or a bare path list; a "this is what will be sent" panel showing a heading that is never sent is worse than no panel.
- Same immediate-save, optimistic-revert and no-save-button rules as Task 12 (AC-43, AC-44), and the same `missing` marking (AC-51).
- Rows carry a checkbox with an accessible name, the repo-relative path, the root segment as text, a kind chip and a preview control (AC-42).
- The section explains that every agent using this skill inherits these documents — through the catalogue, not a literal.
- `Modal` gives its body **zero** padding and `Tabs` defaults to `pad="0 28px"`; if the preview modal is composed here, restate the 24px gutter (`client/INSIGHTS.md`, 2026-08-03).

**Skills:** `react-best-practices`, `frontend-architecture`, `react-testing-library`
**Verify:** `cd client && pnpm exec vitest run src/app/skills` · then once: `cd client && pnpm typecheck` · `cd client && pnpm test`
**Satisfies:** AC-42, AC-43, AC-44, AC-49, AC-51

- [ ] **Step 1: Write the failing test.** Cases: rows render with checkbox, path, root text, chip and preview control (AC-42); a toggle posts the full ordered list immediately and a failure reverts with a message (AC-43, AC-44); the `SERIALIZES AS` panel renders the returned block including `## Project context` and `<untrusted source="spec-0">`, and asserts the absence of `## Project specifications` (AC-49); a stored path missing from discovery is marked and still removable (AC-51).
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Add the catalogue block, build the section, render it from `ConfigTab`.**
- [ ] **Step 4: Run the focused tests, then both wide gates once.**
- [ ] **Step 5: Commit** — `feat(client): attach project-context documents to a skill, with a real serialisation preview`.

---

## Task 14: The trace drawer label

**Files:**
- Modify: `client/messages/en/runs.json:53` — `trace.prompt.specs` from `"Project context (dynamic)"` to `"Project context — attached specs (untrusted)"`
- Modify (only if the assertion needs it): `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx`
- Test: extend the existing `RunTraceDrawer` test

**Interfaces:** consumes the persisted `prompt_assembly.specs`, which Task 9 makes non-null. `TraceBody` already renders that block behind a `prompt_assembly.specs != null` guard — no logic change is expected.

**Constraints:**
- `(dynamic)` becomes actively false once the slot is fed from stored configuration, which is why the comp wins here (AC-35). The label must name the block as **attached specs** and as **untrusted**.
- `specs_read` continues to render "none" for an archived trace with an empty array — no new required field exists to be missing (AC-33).

**Skills:** `react-testing-library`, `next-best-practices`
**Verify:** `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls` · then once: `cd client && pnpm typecheck` · `cd client && pnpm test`
**Satisfies:** AC-35

- [ ] **Step 1: Write the failing assertion** — render the drawer with a trace whose `prompt_assembly.specs` is a non-null block; assert the new label text is present and `"Project context (dynamic)"` is absent.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Change the string.**
- [ ] **Step 4: Run the focused test, then both wide gates once.**
- [ ] **Step 5: Commit** — `feat(client): name the trace's project-context block as attached, untrusted specs`.

---

## AC coverage

74 of the 77 criteria are claimed by a task's `Satisfies:` line above: AC-1…AC-53, AC-55…AC-59, AC-61…AC-68 and AC-70…AC-77. **AC-54, AC-60 and AC-69 are deferred** with reasons in Out of scope. 74 + 3 = 77.

Several criteria are split across two tasks on purpose, and both halves must land for the criterion to be met: AC-24 (marker in T4, log line in T9) · AC-26 (reason in T7, log line in T9) · AC-31/AC-32 (format in T4, trace entry in T9) · AC-49 (assembly in T7, rendering in T13) · AC-66/AC-67 (sum in T4, display in T12) · AC-1/AC-2/AC-8 (predicate in T4, walk in T5) · AC-59 (invalidation in T10, trigger in T12) · AC-14 (scoping in T6, status code in T8).

---

## Risks / edge cases

| Risk | Handling |
|---|---|
| An `*.it.test.ts` for anything reading the clone **green-passes on the `no_clone` early return**, because `seed.ts:232` writes `clone_path: null` | Every such test `mkdtemp`s a clone, writes **nested** fixture files, updates the repo row in `beforeAll`, and **asserts a non-empty document list before asserting anything else**. Called out again in Tasks 6, 8 and 9 |
| A native path separator reaches a stored or compared path, and the feature silently finds nothing on Windows | One normalisation boundary (`toPosix` in Task 4, applied in Task 5), fixture files nested so a separator bug can surface (AC-2), and an assertion that returned paths contain `/` and no `\`. This exact bug zeroed the depgraph and blast radius once already (`server/INSIGHTS.md`, 2026-08-10) |
| The AC-13 race test passes by luck | Both orderings, 3 iterations each, ordering and iteration in the assertion message (`server/INSIGHTS.md`, 2026-08-03). Two `app.inject` PUTs in one `Promise.all` reproduce it; two direct repository calls do not — test at the layer that has the race |
| `usageCounts` degenerates into two queries per document over a 500-row list | One aggregate, and the it-test asserts the **query count**, not just the numbers (NFR §Performance) |
| drizzle-kit 0.30.1 omits the `check()` constraint from the generated SQL (first use in this repo) | Read the generated SQL. If the CHECK is absent, remove it from the schema file and rely on the repository being the table's only writer; **never** hand-write it into the migration. Record which happened in the commit body |
| `agent_versions.configJson` written by this module mirrors the agents module's field list and will drift when a field is added there | Accepted for v1 and recorded; Recommendation 7 is the unification, deliberately not done here so a shipped module is not edited for a benefit this feature does not need |
| AC-24/AC-26 ask for a `warn` Live Log line and `RunEventKind` has none | Planned as `info` lines with explicit wording, matching every existing degradation in `run-executor.ts`. Open question 1 — a one-line change if the spec author prefers widening the enum, which is then a `trace.ts` edit in both copies plus `LOG_COLOR` |
| Editing `client/src/vendor/ui/nav.ts` cuts against "treat `vendor/ui` as third-party" | AC-55 requires a sidebar item and `NAV` is the only registry; the edit is a data entry beside four existing ones, not a change to a primitive. `shell.json`'s label and `activeKeyFor`'s branch already exist, so nothing else in the shell moves |
| The list endpoint reads up to 500 files to produce token estimates | The read is on explicit page load or rescan and never inside the review path (NFR §Performance). If it proves slow against a real repository, the estimate can fall back to `ceil(size/4)` from the `stat` — a change confined to Task 7 |
| A document containing a secret becomes a stored, screen-readable artifact in `run_traces.prompt_assembly.specs` | A property of what the user attaches, stated in the spec's Data-retention row rather than mitigated. Logs carry paths and counts only — never content, never the clone's absolute path |
| A run in flight has its attachments changed | Attachments are resolved once, at run start (NFR §Concurrency). Nothing re-reads them mid-run |

---

## Out of scope

Deliberately not done, so the implementer does not widen the change:

- **The three e2e flows (AC-54, AC-60, AC-69).** The hermetic e2e stack cannot reach the states they assert: `scripts/e2e.sh` seeds an ephemeral database whose only repository has `clone_path: null`, so discovery returns `no_clone` and nothing can be attached; and AC-54/AC-69 additionally need a finished review, which e2e runs without a model key (`e2e/specs/08-pr-intent.flow.json` refuses to trigger a live classification for exactly that reason). Making them runnable means seeding a clone fixture and giving the e2e stack a mock provider — a change to the harness, not to this feature. **The behaviour is still proven**: AC-69's "one direct plus two inherited = three `specs_read` entries" and AC-54's trace content are asserted in `project-context-review.it.test.ts` (Task 9); AC-60's 0 → 1 → 2 counter is asserted as the usage aggregate in Task 6 and as the query invalidation in Tasks 10 and 12. What is deferred is the browser-level proof, not the behaviour.
- **The two spec halves** `server/specs/project-context.md` and `client/specs/project-context.md`. Neither this plan's nor the implementer's — see Follow-up.
- **Any `reviewer-core` change.** The `specs` slot, `wrapUntrusted` and the `## Project context` heading are used as-is.
- **Any `contracts/trace.ts` change.** `RunTrace` stays structurally frozen (AC-33).
- **Automatic, PR-content-driven document selection**; **editing documents in the app**; **chunking and embedding** (`code_chunks` stays dead); **the coverage metric**; **the ad-hoc review path** (`POST /reviews/adhoc`); **a Settings panel control for `context_roots`** (the key is typed and validated; v1 changes it through `PUT /settings`). All six are the spec's own non-goals.
- **Fixing the `settings` endpoint's per-user/workspace-wide confusion** (spec edge cases 33, 34) and **adding a `KeyboardSensor` to the reorder affordance** (spec Open question 5). Both are pre-existing and shared with `SkillsTab`; fixing either here would leave the two tabs inconsistent.
- **Proposals 1–6** in the spec, including attach-from-the-document and the per-document "used by" drill-down.

---

## Follow-up

- **`pr-self-review`** before opening the PR — it routes the branch diff to the skills that govern each changed file and blocks on a critical finding.
- **A second `security` pass over the whole branch**, in addition to the early pass inside Task 7. The threat model to state to the reviewer: document text, document filenames and directory names are chosen by anyone with commit access to a branch that reaches the clone; a `context_roots` value and an attachment path both arrive from a client. What the pass must confirm: both confinement checks on every filesystem path, `wrapUntrusted` on every document reaching a prompt, both caps binding at read time, no resolved path or file content in any message or log, and 404-not-403 on every cross-workspace route.
- **The architecture review agent** for the new module's layering and the container wiring, with `pnpm arch:check` output attached.
- **`engineering-insights`** if the work surfaces something durable — two candidates are already visible: `RunEventKind` having no `warn` member (and what that costs a feature that wants one), and the client's inability to import `reviewer-core`, which is what forced serialisation server-side.
- **The spec author / `doc-writer`** for `server/specs/project-context.md` and `client/specs/project-context.md`, which the spec names as expected halves. They should pin the `no_clone` field name this plan chose (Task 2), the four unread reason strings, and the `info`-instead-of-`warn` decision.
- **`specreator`** if Open question 1 is answered in favour of widening `RunEventKind` — that is a spec amendment, not an implementation detail.

---

## Open questions

1. **AC-24 and AC-26 specify a Live Log `warn` line, and `RunEventKind` has no `warn` member.** Adding one is an edit to `contracts/trace.ts` in **both** `vendor/shared` copies plus `LogLine`/`LOG_COLOR` in the vendored `LiveLogStream.tsx` — which contradicts the spec's own constraint that `trace.ts` needs no change (AC-33's rationale). The plan emits `info` lines with explicit wording, matching every existing degradation in `run-executor.ts`. **Closed by:** the spec author either ratifying `info` or amending the spec to widen the enum. Cost of the reversal: one line in Task 9 plus a four-file contract edit.
2. **AC-54, AC-60 and AC-69 name an e2e flow as their verification, and the hermetic e2e stack cannot reach those states.** Deferred with the behaviour covered by it-tests (see Out of scope). **Closed by:** a decision on whether to extend the e2e harness — a seeded clone fixture in `seed.ts` plus a mock provider for the e2e stack — as separate work.
3. **AC-50 says "the repository currently selected in the editor", and neither editor has a repository selector.** The plan uses the shell's active repository. **Closed by:** confirming that reading, or asking for a per-editor repository picker, which would be additional UI in Tasks 12 and 13.
4. **The `no_clone` signal's field name and enum** are fixed here as `status: 'ok' | 'no_clone'` because a task cannot be written without them; the spec leaves them to `server/specs/project-context.md` (its Open question 3). **Closed by:** that document either adopting this name or renaming it, which is a change in Task 2's contract plus Tasks 7 and 11.
