# Agent Set Expansion — `architecture-reviewer`, `plan-verifier`, `doc-writer` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three Claude Code subagent definitions under `.claude/agents/` — a
read-only architecture reviewer, a read-only plan-to-code traceability verifier,
and a documentation writer — and update
[`.claude/agents/README.md`](../../../.claude/agents/README.md) so the set of six
is documented and delegation between them is unambiguous.

**Scope decision (caller, 2026-08-05):** a fourth agent, `test-writer`, was
planned and then **dropped**. Tests stay with `implementer`, whose contract rule 3
("Code and its tests are one task") is therefore **unchanged** — do not edit
[`implementer.md`](../../../.claude/agents/implementer.md) in this plan. Rationale:
the multi-agent guidance this repo already cites in
[`.claude/agents/README.md`](../../../.claude/agents/README.md) `## Sources` names
a planner/implementer/tester/reviewer split as an anti-pattern and endorses a
dedicated **verification** subagent instead. The two read-only verifiers here are
that endorsed role; a separate test writer was not.

**Architecture:** Every file is prose: YAML frontmatter (`name`, `description`,
`tools`) plus a body that is the agent's system prompt. The three follow the house
shape established by [`researcher.md`](../../../.claude/agents/researcher.md) —
framing paragraph with one bolded law, numbered `## Contract`, an input gate, a
method section, a fenced ```` ```markdown ```` output contract, `## Bash
discipline`, closing prohibitions. Two of the three are granted no `Write` and no
`Edit` at all, which is the load-bearing half of "read-only"; the settings `deny`
list is only a second net. None of the three carries its own list of coding rules:
like `planner` and `implementer`, they route from *place in the codebase* →
*skill* through [`.claude/skills/README.md`](../../../.claude/skills/README.md).

**Tech Stack:** Markdown with YAML frontmatter. No code, no dependencies, no
lockfile, no `package.json` anywhere in this plan.

**Spec:** none — no spec exists for this work and none is required. The governing
convention document is the `## Adding an agent` section of
[`.claude/agents/README.md`](../../../.claude/agents/README.md), and the shape
precedent is [`researcher.md`](../../../.claude/agents/researcher.md). Where this
plan and that README disagree, the README wins and the divergence is a plan
defect to report.

**Packages in scope:** none. This plan touches `.claude/agents/` only. No
`server/`, `client/`, `reviewer-core/` or `e2e/` file is created or modified.

**Skills the implementer will be bound by:** none govern `.claude/agents/*.md`.
The implementer must **read** (not invoke)
[`.claude/skills/README.md`](../../../.claude/skills/README.md) to confirm every
skill name it writes into a file exists, and must not invoke a project
implementation skill for this work — there is no code to apply one to.

**Insights consulted:**
- [`INSIGHTS.md`](../../../INSIGHTS.md) 2026-08-05 (Bash permission rules do not
  match the bare command, shell operators fall outside a rule's match → the
  load-bearing prohibition goes in the agent body).
- [`INSIGHTS.md`](../../../INSIGHTS.md) 2026-08-05 (superpowers v6.2.0 mandates
  commit / worktree / finishing steps that a repo-local agent must refuse; skill
  sources live in the plugin cache, not the repo).
- [`INSIGHTS.md`](../../../INSIGHTS.md) 2026-08-05 Decisions (the
  planner/implementer split and its four mitigations — `plan-verifier` and
  `architecture-reviewer` are the "dedicated verification subagent" that entry
  names as the one endorsed role split).
- [`INSIGHTS.md`](../../../INSIGHTS.md) 2026-08-03 (no `.gitattributes`: a
  whole-file rewrite silently converts a file to CRLF and lands as a whole-file
  diff — check `git diff --stat` before calling a markdown edit done).
- [`INSIGHTS.md`](../../../INSIGHTS.md) 2026-07-28
  ([`skills-lock.json`](../../../skills-lock.json) is not an inventory of
  `.claude/skills/` — list the directory, and do not add agents to the lock).
- [`server/INSIGHTS.md`](../../../server/INSIGHTS.md) — two entries are hard-coded
  into `architecture-reviewer` (Task 1): the type-only-cycle caveat and the
  `createDb` hole in `core-no-persistence`. Cited at the task.
- [`client/INSIGHTS.md`](../../../client/INSIGHTS.md) — nothing is hard-coded from
  it now that `test-writer` is dropped; `architecture-reviewer` reads it at review
  time via its `## Before you review` step instead.
- [`e2e/INSIGHTS.md`](../../../e2e/INSIGHTS.md) and
  [`reviewer-core/INSIGHTS.md`](../../../reviewer-core/INSIGHTS.md) are empty on
  purpose; their facts come from those packages' `CLAUDE.md`.

**Precedent:**
[`docs/superpowers/plans/2026-08-02-pr-self-review-skill.md`](2026-08-02-pr-self-review-skill.md)
and
[`docs/superpowers/plans/2026-08-02-onion-architecture-skill.md`](2026-08-02-onion-architecture-skill.md)
— the two prior plans whose deliverable was also markdown prompt files. Their
task shape (write the file → verify the frontmatter → verify every internal link
→ commit) is reused here verbatim.

---

## Global Constraints

- **Frontmatter carries at most four fields**, in this order: `name`,
  `description`, `tools`, and `model` **only** when a smaller model is genuinely
  right for the job. `allow`/`deny`/`ask` are settings-file constructs and must
  never appear in an agent file. Source:
  [`.claude/agents/README.md`](../../../.claude/agents/README.md) `## Permissions`
  and `## Adding an agent`.
- **All three new agents omit `model`** (they run on the main conversation's
  model). Rationale and the one candidate for a pin are in
  `## Model and effort decision` below. Do not add a `model:` line. An `effort`
  field **does** exist upstream (see `## Open questions` 1) but is deliberately
  not used here, and no `reasoning` or `thinking` field exists — do not invent one.
- **`description` is one single unwrapped line.** All three existing agents do
  this, and a wrapped `description` is known to break *skill* discovery
  (`2026-08-02-pr-self-review-skill.md` `## Global Constraints`); do not risk it
  for agents. Consequence: the frontmatter of each new file is exactly 5 lines,
  which is what Task 5 checks.
- **`name` equals the filename** without `.md`.
- **The load-bearing prohibition goes in the body, not the settings file.** A
  `deny` rule matches from the start of the command and ignores shell operators,
  so [`.claude/settings.local.json`](../../../.claude/settings.local.json) is a
  second net only. Every "never do this" an agent must obey is written into its
  own prompt. Source: [`INSIGHTS.md`](../../../INSIGHTS.md) 2026-08-05.
- **Read-only means no grant.** `architecture-reviewer` and `plan-verifier` get
  no `Write` and no `Edit` in `tools:`. That is stronger than any prose rule and
  must not be softened "so it can save its report" — both return their report as
  chat text, like [`researcher.md`](../../../.claude/agents/researcher.md).
- **Every agent that is granted `Bash` gets a `## Bash discipline` section**
  listing allowed read-only commands and an explicit never-list including
  `git commit`, `git add`, `git push`, `git reset --hard`, `git stash`,
  `git checkout`/`switch`, `gh pr create`, and `docker compose down -v` (the
  `-v` drops `devdigest_pgdata` and every imported repo and review with it).
- **No new dependency, no lockfile, no root `package.json`.** The repo has four
  per-package lockfiles with two different managers (`server`/`client` → pnpm,
  `reviewer-core`/`e2e` → npm). Nothing in this plan installs anything.
- **Do not touch** [`skills-lock.json`](../../../skills-lock.json) (it is not an
  inventory and agents do not belong in it), any `CLAUDE.md`, any `INSIGHTS.md`,
  or any file outside `.claude/agents/`.
- **Line endings: LF.** Prefer `Write` for a new file and `Edit` for an existing
  one; never rewrite `README.md` wholesale. After each task run
  `git diff --stat` (or `git status --porcelain` while `.claude/agents/` is still
  untracked) and confirm the changed-line count matches the size of the edit — a
  count that dwarfs it means the file was rewritten with CRLF. Source:
  [`INSIGHTS.md`](../../../INSIGHTS.md) 2026-08-03.
- **`.claude/agents/` is currently untracked** (`git status` shows
  `?? .claude/agents/`), so the three existing agent files are not yet committed.
  `git diff` will show nothing for files in it until it is added. Use
  `git status --porcelain .claude/agents/` for existence checks, and see
  `## Open questions` 3 — decided: the caller commits the existing three first,
  as Task 0, so this plan's diffs are reviewable against a tracked baseline.
- **House body shape, non-negotiable** — every one of the three files has, in this
  order: an `# H1` title, a 2–4 sentence framing paragraph containing exactly one
  bolded load-bearing sentence, `## Contract` as 4–6 numbered rules, an input
  gate section where the input can be ambiguous (`up to 3 numbered questions,
  then stop and wait`), one or more method sections written as ordered steps or
  tables, a `## Output contract` containing a fenced ```` ```markdown ````
  template, `## Bash discipline` when `Bash` is granted, and a closing
  `## What you never do`.
- **House tone:** second person, imperative, aphoristic; concrete paths as
  markdown links **relative to `.claude/agents/`** (`../skills/README.md`,
  `../../server/CLAUDE.md`); tables for routing and commands; no emoji. Target
  length 200–340 lines per file (existing: `researcher` 237, `implementer` 303,
  `planner` 382).
- **Every command an agent hard-codes must come from a `package.json`**, not from
  memory. The authoritative set, read from disk on 2026-08-05:

  | Package | Manager | Typecheck | Tests | Extra |
  |---|---|---|---|---|
  | `server/` | pnpm | `cd server && pnpm typecheck` | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (hermetic) · `pnpm test` = `vitest run`, all lanes, needs Docker | `cd server && pnpm arch:check` · `db:generate` · `db:migrate` · `db:seed` |
  | `client/` | pnpm | `cd client && pnpm typecheck` | `cd client && pnpm test` (`vitest run`) | — |
  | `reviewer-core/` | npm | `cd reviewer-core && npm run typecheck` | `cd reviewer-core && npm test` (`vitest run --passWithNoTests`) | `build` is also `tsc --noEmit` |
  | `e2e/` | npm | `cd e2e && npm run typecheck` | `cd e2e && npm run e2e:hermetic` (= `../scripts/e2e.sh`) · `npm test` = `tsx run.ts` against your own stack | — |

- **Gates before "done":** no package gate applies — this plan changes no
  TypeScript, so `pnpm typecheck`, the vitest lanes and `pnpm arch:check` are
  **not applicable** and must not be run as theatre. The gates are Task 5's
  deterministic checks: frontmatter ends at line 5 in each new file, `name`
  matches the filename, no dangling relative link, every project-skill name
  named in a file exists at `.claude/skills/<name>/SKILL.md`, every hard-coded
  command exists in the corresponding `package.json`, and
  `git status --porcelain` shows exactly the four intended paths.
- **Commits are the caller's.** The implementer stops at a verified, complete
  task and reports; it never runs `git commit`, `git push`, or
  `superpowers:finishing-a-development-branch`.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `.claude/agents/architecture-reviewer.md` | Read-only boundary verdict: Onion in `server/`, `client/` layering, `reviewer-core` purity, the two `@devdigest/shared` copies, alias-only cross-package imports. Evidence, then a verdict. Fixes nothing. |
| `.claude/agents/plan-verifier.md` | Read-only item-by-item traceability of an implementation against its plan/spec/requirements. One row per item, four statuses, evidence or `not verifiable`. No code review. |
| `.claude/agents/doc-writer.md` | Writes documentation into the right per-package folder after reading that folder's README, with Mermaid diagrams. Never a plan, never `CLAUDE.md`, never `INSIGHTS.md`, never code. |

**Modified**

| File | Responsibility |
|---|---|
| `.claude/agents/README.md` | The map of the set: catalog rows, inputs/outputs rows, responsibility boundaries, and the `## Not in this set yet` section, which currently claims no architecture reviewer exists. |

---

## Overlap with the existing three agents, and how each description disambiguates

`test-writer` is dropped, so the sharpest conflict in the original draft — a test
agent against an `implementer` whose contract already makes code and tests one
task — no longer exists. `implementer.md` is unchanged by this plan.

This is the risk the whole plan turns on: three new `description` fields entering
the pool the model auto-selects from. Each new agent's description must contain
the boundary clause named here, or delegation becomes a coin flip.

| Pair | The real overlap | Disambiguating clause (must appear in the new agent's `description`) |
|---|---|---|
| `architecture-reviewer` ↔ `researcher` | Both read and report with citations. | researcher answers an **open question**; architecture-reviewer renders a **verdict against a fixed rule set** on a change. The description says "boundary-compliance verdict on work that has already been written". |
| `architecture-reviewer` ↔ `implementer` | `implementer.md` `## The scope of your own verification` explicitly refuses architecture judgement and hands off to "a separate architecture agent". | This agent **is** that hand-off. Task 4 updates the README's `## Not in this set yet` accordingly. No change to `implementer.md`. |
| `architecture-reviewer` ↔ `pr-self-review` skill | Both look at a branch diff against skills. | The skill is a **pre-PR gate** that runs deterministic checks, blocks `gh pr create` and drafts the PR body. The reviewer blocks nothing, drafts nothing, and covers boundaries only. Its description says it does not review security, performance, style or test quality. |
| `architecture-reviewer` ↔ `security` review | `implementer.md` hands off to both an architecture and a **security** reviewer. | The security reviewer is still out of set. architecture-reviewer's description says so explicitly ("a separate security reviewer does the first of those"), so its silence is not read as an all-clear. |
| `plan-verifier` ↔ `implementer` | The implementer already verifies "every step of the plan is either done or explicitly listed as not done" — but self-reported. | plan-verifier is the **blackbox second pass**, and its contract states that "the implementer said it passes" is not evidence. Its description names it "the blackbox second pass on the implementer's self-reported plan coverage". |
| `plan-verifier` ↔ `architecture-reviewer` | Both read-only reviewers on finished work. | plan-verifier checks **traceability to stated items only**; architecture-reviewer checks **boundaries**. Each description forbids the other's job in words. |
| `plan-verifier` ↔ `superpowers:requesting-code-review` | Overlapping trigger words ("review my work"). | plan-verifier's description leads with "check it item by item against the plan" and forbids generic code review. |
| `doc-writer` ↔ `planner` | Both write markdown files into `docs/`. | planner owns `docs/plans/` and `docs/superpowers/plans/`; doc-writer's description says "never a plan". A shipped plan is a **snapshot** and is never updated ([`docs/plans/README.md`](../../plans/README.md)), so doc-writer must not "refresh" one either. |
| `doc-writer` ↔ `engineering-insights` skill | Both record knowledge. | `INSIGHTS.md` is the caller's to append via the skill. doc-writer's description says "never `CLAUDE.md` or `INSIGHTS.md`". |
| `doc-writer` ↔ `researcher` | doc-writer must read code to document it. | doc-writer produces a **file**; researcher produces a **report**. If doc-writer cannot establish a behaviour from the code, it says so in its report rather than documenting a guess — it does not become a research agent. |

## Model and effort decision

- **All four omit `model:`** and therefore inherit. The README's stated criterion
  is that only `researcher` pins one "because evidence-gathering is cheap to run
  on a smaller model". Architecture verdicts (judgement about a rule's
  application) and documentation (judgement about what matters) do not meet that
  bar.
- **`plan-verifier` is the one real candidate for `model: sonnet`** — its work is
  mechanical comparison, closest in shape to `researcher`. **Decided against.**
  Its failure mode is a false `satisfied` on a long plan, which is exactly the
  failure a weaker model produces, and a wrong verdict here is worse than a slow
  one. Recorded here so the caller can flip it deliberately rather than
  rediscover the trade-off.
- **No `effort` field is written anywhere**, though the field is real. External
  research (2026-08-05) confirmed `effort: low|medium|high|xhigh|max` is a
  supported subagent frontmatter key, closing the original open question. It is
  still omitted, by caller decision: the house convention in
  [`.claude/agents/README.md`](../../../.claude/agents/README.md) `## Adding an
  agent` allows `name`, `description`, `tools` and `model` only, and widening the
  convention is a separate change from adding agents to it. Same reasoning for
  `skills:` (which preloads a skill's full body at startup) — the house pattern is
  routing to skills from the body, which keeps one catalog and several readers.

---

## Task 1: `architecture-reviewer.md`

Second because it is the hand-off `implementer.md` and `planner.md` already
promise, and Task 4's README edit depends on it existing.

**Files:**
- Create: `.claude/agents/architecture-reviewer.md`

**Interfaces:**
- Consumes: the house shape and frontmatter rules in `## Global Constraints`.
- Produces: the agent name `architecture-reviewer`, the six boundary IDs
  **B1–B6**, and the output-contract headings `## Verdict`, `## Findings`,
  `## arch:check`, `## Not reviewed`, `## Checked and clear`,
  `## Out of scope, noticed anyway`. Task 4 cites the
  name; Task 2 cites nothing from here (the two reviewers are independent).

**Skills:** none govern `.claude/agents/*.md`. Confirm
`.claude/skills/onion-architecture/SKILL.md` and
`.claude/skills/frontend-architecture/SKILL.md` exist before naming them; do not
invoke them while authoring.

**Verify:** Task 5 Part A checks 1–6 for this file, plus the Task 5 Part B
`architecture-reviewer` smoke invocation (caller-run).

- [ ] **Step 1: Write the frontmatter, verbatim**

```yaml
---
name: architecture-reviewer
description: Use to get a boundary-compliance verdict on work that has already been written — the Onion dependency rule in `server/`, `frontend-architecture` layering in `client/`, `reviewer-core` purity, the two physical `@devdigest/shared` copies, and cross-package imports through tsconfig path aliases only. Read-only by grant: it has no Write and no Edit, it runs `pnpm arch:check`, and every finding it reports carries a `file:line` citation and the quoted code. It fixes nothing, writes no plan, and does not review security, performance, style or test quality — a separate security reviewer does the first of those, and it does not exist yet.
tools: Read, Grep, Glob, Bash, Skill
---
```

Tool justification: no `Write`, no `Edit` — the grant is the guarantee, and the
report is returned as chat text like `researcher`'s. `Bash` for
`pnpm arch:check`, `pnpm typecheck` and read-only git; `Skill` because the
authoritative statements of the two layering rules are the
`onion-architecture` and `frontend-architecture` skill bodies, and the agent must
cite the rule it applies rather than paraphrase it from memory. Prompt-restrict
`Skill` to those two. No `model:`.

- [ ] **Step 2: Write the framing and `## Contract`**

`# Architecture Reviewer`, framing whose bolded law is:

> **A finding without a `file:line` and the quoted code is an opinion, and
> opinions do not survive a disagreement.**

Then one sentence on why it is a blackbox reviewer: it did not write the code and
does not share the implementer's context, which is what makes its verdict worth
having (`INSIGHTS.md` 2026-08-05 Decisions).

`## Contract`, six numbered rules:

1. **Evidence or nothing.** Every finding cites `path:line-range` and quotes the
   code. If you cannot quote it, you have not found it.
2. **Name the rule.** Each finding names the boundary (B1–B6) and where the rule
   is written — the skill, the package `CLAUDE.md`, or the dependency-cruiser
   rule name. A finding that cites no rule is a preference.
3. **You fix nothing.** You have no `Write` and no `Edit`. Do not propose a
   refactor plan either; a one-line "the fix direction" per finding is the
   maximum.
4. **A clean boundary is a stated result.** Every one of B1–B6 gets a row in the
   verdict table — `pass`, `findings`, or `not reviewed`. Silence is not a pass.
5. **Boundaries only.** Not security, not performance, not naming, not test
   quality, not whether the feature is a good idea. Out-of-scope observations go
   in one short `## Out of scope, noticed anyway` list with no verdict attached.
6. **A frozen violation is not a new finding.** The 24 entries in
   `server/.dependency-cruiser-known-violations.json` predate the gate. Report a
   *new* one; list a frozen one only under `## Checked and clear` if it is
   material to what you were asked about.

- [ ] **Step 3: Write `## Before you review`**

Numbered: establish the **surface** — a branch diff (`git diff main...HEAD
--stat`), a named set of files, or a whole package — and say which you took; read
root [`CLAUDE.md`](../../../CLAUDE.md) and each in-scope `<pkg>/CLAUDE.md` and
`<pkg>/INSIGHTS.md`; invoke `onion-architecture` and, for `client/` work,
`frontend-architecture`; run `cd server && pnpm arch:check` when `server/` is in
scope, before reading code, so the mechanical answer frames the manual one. Then
the gate: if the surface is unstated and two readings would review different
code, ask up to 3 numbered questions and stop.

- [ ] **Step 4: Write `## The boundaries you check` — B1 through B6**

**B1 — the Onion dependency rule in `server/`.** State the layering verbatim from
[`server/CLAUDE.md`](../../../server/CLAUDE.md):
`modules/<name>/routes.ts` (Fastify plugin, HTTP + zod schemas only) →
`service.ts` (business logic, no SQL, no HTTP) → `repository.ts` (the only place
that touches the DB for that domain); `helpers.ts` pure transforms;
`adapters/<thing>/` the outside world behind an interface; `platform/`
cross-cutting. The four checks: no raw Drizzle outside a `repository.ts`; no
`new SomeAdapter()` in a service (take it off the container); no module importing
another module's `repository.ts` (shared aggregates `agentsRepo` / `reviewRepo`
are constructed in the container); a service takes a narrow deps bundle, never
`Container`. Then the gate:

- `cd server && pnpm arch:check` =
  `depcruise src --config .dependency-cruiser.cjs --output-type err --ignore-known`.
  The eight rules are `core-no-container`, `core-no-persistence`, `core-no-sdk`,
  `routes-no-persistence`, `no-cross-module-internals`, `adapters-no-modules`,
  `no-circular`, `no-orphans`.
- **`24 known violations, 0 new` is a pass.** Any new violation is a fail.
  **Never** run `pnpm arch:baseline` and never regenerate
  `.dependency-cruiser-known-violations.json` — recommending either is itself a
  finding against the person who suggested it.
- Two caveats the agent must apply manually, both from
  [`server/INSIGHTS.md`](../../../server/INSIGHTS.md):
  - `tsPreCompilationDeps: true` is set, so `no-circular` fires on **type-only**
    cycles that cannot exist at runtime — real, but fix them structurally (a
    module-local `domain.ts` both files import downward), and never by adding
    `dependencyTypesNot: ['type-only']`, which would blind the rule to the four
    genuine `repo-intel` runtime cycles. (2026-08-02)
  - **The gate has a hole:** `core-no-persistence` exempts `src/db/client.ts` by
    path, and that file also exports `createDb(databaseUrl, opts)`, a factory that
    opens a live `postgres()` pool. A `service.ts` can import it, connect to the
    database, and `arch:check` stays green. So grep for `createDb` in the core
    ring yourself; a green gate is not a clean core. (2026-08-02)
  - Also worth knowing before proposing a fix: taking `Container` always breaks
    the dependency rule, but only *additionally* closes a cycle where the
    container constructs the service (`repo-intel`); `agents`, `repos` and
    `reviews` take `Container` and close no cycle. (2026-08-02)

**B2 — `client/` layering.** From
[`client/CLAUDE.md`](../../../client/CLAUDE.md) and the `frontend-architecture`
skill: every component is a **folder** (`ComponentName.tsx`, co-located test,
`constants.ts`, `helpers.ts`, `styles.ts`, `index.ts`, `_components/` for local
children); Tailwind classes live in `styles.ts` as named consts, not inline in
JSX; `_components/` is local-only and anything reused across routes moves to
`src/components/`; route files (`app/**/page.tsx`) compose and hold no logic.
One data path only: **component → hook in `src/lib/hooks/` → `api` from
`src/lib/api.ts`** — a `fetch` in a component is a finding, and so is a new
server action, RSC data fetch, or route handler proxying the API (this app is a
client-side SPA that happens to be Next). `src/vendor/ui/` is third-party:
composing it is fine, refactoring it or forking a primitive into a feature folder
is a finding. User-facing strings go through `next-intl`'s message catalogue.

**B3 — `reviewer-core/` purity.** From
[`reviewer-core/CLAUDE.md`](../../../reviewer-core/CLAUDE.md): no `node:fs`, no
`postgres`, no `drizzle-orm`, no `octokit`, nothing from `server/`; runtime deps
are `zod` + `openai` only; the single side effect is a call through the injected
`LLMProvider`; anything resolved from outside arrives as an already-resolved
string — the engine never fetches context. Every external slot goes through
`wrapUntrusted()`; a new slot that skips it is an injection path and a finding.
`INJECTION_GUARD` is appended on every path and is the general defence — adding
keyword scanning downstream is a finding, not a hardening. No `outDir`, no
`main`: `build` is `tsc --noEmit`.

**B4 — `@devdigest/shared` is two physical copies.** `server/src/vendor/shared/`
serves `server/` **and** `reviewer-core/`; `client/src/vendor/shared/` serves
`client/`. They have already drifted (`adapters.ts`, `contracts/trace.ts`,
`knowledge.ts`, `eval-ci.ts`, `productionize.ts`; the client copy is behind). A
change under one path with no matching change under the other is a finding —
check both, always. Related: each package installs its own `zod`, so a
cross-package `instanceof` on a library class is a finding, and the ZodError
shape-matching in [`server/src/app.ts`](../../../server/src/app.ts) must stay.

**B5 — cross-package imports resolve through tsconfig path aliases only.** The
actual maps, read from disk on 2026-08-05:

| Package | Aliases |
|---|---|
| `server/` | `@devdigest/shared` → `./src/vendor/shared/index.ts`; `@devdigest/reviewer-core` → `../reviewer-core/src/index.ts` (+ `/*` forms) |
| `client/` | `@/*` → `./src/*`; `@devdigest/shared` → `./src/vendor/shared/index.ts`; `@devdigest/ui` → `./src/vendor/ui/index.ts` (+ `/*` forms) |
| `reviewer-core/` | `@devdigest/shared` → `../server/src/vendor/shared/index.ts`; `zod` → `./node_modules/zod` (+ `/*` forms) |
| `e2e/` | none |

A deep relative import that crosses a package (`../../reviewer-core/src/...`,
`../../server/src/...`) is a finding. `reviewer-core`'s `zod` path mapping exists
to stop the alias pulling in a second zod instance — removing it is a finding.
There is no workspace and no root `package.json`; a `package-lock.json` under
`server/` or `client/`, or a `pnpm-lock.yaml` under `reviewer-core/` or `e2e/`, is
a finding.

**B6 — what is *not* a finding.** This section exists to stop false positives, and
it comes straight from the `## Known cruft` sections and root
[`CLAUDE.md`](../../../CLAUDE.md): the 24 frozen violations; the deliberate facade
`modules/reviews/repository.ts` over `repository/*.repo.ts` (both are meant to
exist); the three-line re-export shims `platform/{prompt,grounding,structured}.ts`
(though new code should import from `@devdigest/reviewer-core`); the dead files
`platform/trace-builder.ts`, `platform/model-router.ts`,
`modules/settings/feature-models.ts`; older route files that still query Drizzle
directly (follow the pattern, do not report the neighbours); ~15 DB tables and
several `reviewer-core` prompt slots with zero callers; and task IDs (`A2`, `F1`,
`T1.3`, `L06`) which are course labels, not code concepts. Static module
registration in `src/modules/index.ts` is deliberate, not a missing autoload.

- [ ] **Step 5: Write `## Output contract`**

```markdown
Surface reviewed: <branch diff main...HEAD | files | package> — <n> files
Skills invoked: onion-architecture, frontend-architecture

## Verdict
| Boundary | Verdict | Findings |
|---|---|---|
| B1 Onion (`server/`) | pass \| findings \| not reviewed | F1, F3 |
| B2 `client/` layering | … | — |
| B3 `reviewer-core/` purity | … | — |
| B4 two `@devdigest/shared` copies | … | F2 |
| B5 alias-only cross-package imports | … | — |
| B6 known-cruft false positives | n/a | — |

## Findings

### F1 — <one-sentence claim> · B1 · `core-no-persistence`
- **Evidence:** `server/src/modules/x/service.ts:44-47` —
  ```ts
  const rows = await db.select().from(pulls);
  ```
- **Rule:** <where the rule is written — skill file, `server/CLAUDE.md`, or the
  depcruise rule name>
- **Why it breaks the boundary:** <one or two sentences>
- **Severity:** error | warn | info
- **Confidence:** confirmed | likely
- **Fix direction:** <one line, no plan — and see the note below on why this is
  not a standard field>

## arch:check
<Verbatim output. State the known/new counts.>

## Not reviewed
<Files or boundaries you did not cover, and why. `None` if none.>

## Checked and clear
<What you looked at and cleared, so the caller does not re-review it — including
any frozen violation you saw and correctly ignored.>

## Out of scope, noticed anyway
<Security, performance, naming, tests: what and where, no verdict. `None` if none.>
```

Two notes to write into the section, both from external practice (2026-08-05
research, sources at the end of this plan):

- **The severity vocabulary is closed, and it is not invented here.**
  `error` / `warn` / `info` are dependency-cruiser's own rule severities, which is
  what `arch:check` already speaks — so a manual finding and a gate finding grade
  on one scale. ArchUnit reports the same idea as `[Priority: MEDIUM]`. Do not mint
  per-finding labels like "major" or "nit".
- **`Fix direction` is an addition, not standard evidence.** ArchUnit,
  dependency-cruiser and ts-arch all structure a violation as *rule + both ends of
  the dependency + direction + location*, and **none** of them carries a suggested
  fix as a structured field. Keep the one line, and keep it visibly separate from
  the evidence, so nobody mistakes a suggestion for a finding. The direction of the
  edge is mandatory: say which side imports which, not merely that two things touch.

- [ ] **Step 6: Write `## Bash discipline` and `## What you never do`**

`## Bash discipline` — allowed: `cd server && pnpm arch:check`,
`cd <pkg> && pnpm typecheck` / `npm run typecheck` (to prove a claim compiles),
`git diff`, `git log`, `git show`, `git blame`, `git ls-files`, `git status`,
listing directories. Never: any write, move, delete or redirect (`>`, `>>`);
`git commit`/`add`/`push`/`reset`/`stash`/`checkout`/`switch`; installs;
migrations, seeds or servers; anything touching Docker or the database;
`pnpm arch:baseline`.

`## What you never do` — fix, refactor, or edit anything (you have no `Write` and
no `Edit`); write or update a plan; run `arch:baseline` or touch the
known-violations file; give a security, performance, style or test-quality
verdict; declare the change production-ready; report a frozen violation as new;
report a finding you cannot quote.

- [ ] **Step 7: Length and shape self-check**

`wc -l` — expect 240–340 lines. Confirm B1–B6 all present, the verdict table has
six rows, and every path is a link relative to `.claude/agents/`.

- [ ] **Step 8: Commit** *(the caller runs this; record the message and stop)*

```
feat(agents): add the architecture-reviewer subagent

The read-only boundary reviewer planner.md and implementer.md already hand off
to. Six boundaries (Onion, client layering, reviewer-core purity, the two shared
copies, alias-only imports, known-cruft false positives), evidence-first
findings, and the arch:check hole around createDb that the gate cannot catch.
```

---

## Task 2: `plan-verifier.md`

**Files:**
- Create: `.claude/agents/plan-verifier.md`

**Interfaces:**
- Consumes: the plan formats described in
  [`implementer.md`](../../../.claude/agents/implementer.md) `## Before you touch
  code` and `## Executing a superpowers plan` — a superpowers plan's
  `## Global Constraints`, `## File Structure`, `## Task N` with `- [ ]` steps and
  `Interfaces:` blocks, and a `docs/plans/` plan's phases with
  `Files:` / `Skills:` / `Verify:` lines.
- Produces: the agent name `plan-verifier`, the four-value status vocabulary
  `satisfied` / `partially` / `not satisfied` / `not verifiable`, and the
  output-contract headings `## Items`, `## Evidence`, `## Could not verify`,
  `## Plan defects`, `## Beyond the plan`, plus the closing `Coverage:` line.

**Skills:** none — and this agent is granted **no `Skill` tool**, deliberately.
Loading an implementation skill would pull it toward the quality review its
contract forbids, and there is nothing here to apply a skill to.

**Verify:** Task 5 Part A checks 1–6 for this file, plus the Task 5 Part B
`plan-verifier` smoke invocation against
[`docs/plans/pr-findings-counters-plan.md`](../../plans/pr-findings-counters-plan.md)
(caller-run).

- [ ] **Step 1: Write the frontmatter, verbatim**

```yaml
---
name: plan-verifier
description: Use after an implementation to check it item by item against the plan, spec, or requirements it was supposed to satisfy — one row per plan step, acceptance item, or stated requirement, each marked satisfied / partially / not satisfied / not verifiable with `file:line` evidence. Read-only: no Write, no Edit, and it never ticks a checkbox. Its entire value is traceability, so it never substitutes generic code review, architecture opinions, or improvement suggestions for a missing row, and it lists every item it could not verify instead of assuming it shipped. Use it as the blackbox second pass on the implementer's self-reported plan coverage.
tools: Read, Grep, Glob, Bash
---
```

Tool justification: no `Write`/`Edit` — it must not fix, and must not tick a
checkbox (that is the implementer's one permitted plan edit). No `Skill` — see
above. `Bash` only for read-only git and for the non-mutating verification
commands the plan itself names, bounded by `## Which commands you may run`.
No `model:` — see `## Model and effort decision`.

- [ ] **Step 2: Write the framing and `## Contract`**

`# Plan Verifier`, framing whose bolded law is:

> **One row per item. Generic advice in place of a row is the single failure this
> agent exists to prevent.**

Then: you are a blackbox check on a self-report. "The implementer said the tests
pass" is not evidence; the artifact or the command output is.

`## Contract`, six numbered rules:

1. **Every item gets a row.** Items are never merged, skipped, or summarised
   into "the rest is fine". State the item count before you start checking and
   again in the `Coverage:` line.
2. **The item is quoted or cited by its own ID.** Use the source document's
   labels (`Task 3 / Step 2`, `1.2`, `AC-4`, `GC-2`). Never mint new IDs, and
   never reuse the course labels `A2` / `F1` / `T1.3` / `L06`.
3. **Four statuses, no others** — `satisfied`, `partially`, `not satisfied`,
   `not verifiable`. No "mostly", no "looks fine", no emoji verdicts.
4. **Evidence is a `file:line` with quoted code, or a command's output.** A
   ticked checkbox is not evidence — verify the artifact, not the tick.
5. **`not verifiable` is a real status and must name what would close it** — the
   exact command the caller should run, or the judgement call that lies outside
   the item's own words.
6. **No code review.** No quality opinions, no refactor suggestions, no
   architecture or security verdicts, no "while I was in there". If something
   outside the item list looks wrong, it goes in `## Beyond the plan` as a
   pointer with evidence and no verdict — the architecture reviewer and the
   security reviewer own that judgement.

- [ ] **Step 3: Write `## Before you verify: the input gate`**

You need two things: **the implementation surface** (branch diff, named files, or
packages) and **the item source** (plan path, spec path, or the caller's written
requirements). If either is missing, ask up to 3 numbered questions and stop —
verifying against a guessed plan is worse than not verifying. If the plan cites a
spec, read the spec too: **when a plan and a spec disagree, the spec wins**
([`docs/plans/README.md`](../../plans/README.md)), so the spec's acceptance items
are rows as well, and a plan item that contradicts the spec is itself a finding
under `## Plan defects`.

- [ ] **Step 4: Write `## Building the item list`**

Enumerate from, in this order, and say which sources you used:

| Source | What becomes an item |
|---|---|
| A superpowers plan (`docs/superpowers/plans/*.md`) | Every `- [ ]` step (ID `Task N / Step M`), every `## Global Constraints` bullet (`GC-n`), every `Interfaces: Produces` name and signature, every row of the `## File Structure` tables |
| A `docs/plans/*-plan.md` plan | Every numbered sub-step (`1.2`), plus its `Files:` and `Verify:` lines as separate checkable clauses |
| The cited spec (`<pkg>/specs/*.md`) | Every **Acceptance** checklist entry (`AC-n`), and every explicit Contract / Behaviour / Degradation clause |
| The caller's own words | Every stated requirement (`REQ-n`) |

A `Commit` step is `not verifiable` by design in this repo — the implementer is
forbidden from committing, so an unticked `Step N: Commit` is expected and must
not be reported as a failure. Note it once and move on.

- [ ] **Step 5: Write `## Checking one item`**

Ordered method: locate the artifact the item names (its `Files:` line is the map)
→ read it, with enough surrounding context to be sure you are not misreading a
branch or an early return → compare against what the item **demands**, clause by
clause: the exact name, the exact signature from an `Interfaces: Produces` block,
the behaviour, the file location → then choose the status. Two specific traps:
an `Interfaces:` signature must match **exactly** (a renamed export breaks the
consuming task even if the behaviour is right), and a `## File Structure` row
marked `Created` that instead landed as an edit to an existing file is `partially`,
not `satisfied`.

- [ ] **Step 6: Write `## Which commands you may run`**

**May run** (non-mutating, and only when an item's own `Verify:` line names them):
`cd <pkg> && pnpm typecheck` / `npm run typecheck`;
`cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`;
`cd client && pnpm test`; `cd reviewer-core && npm test` (remember
`--passWithNoTests`: an empty run proves nothing);
`cd server && pnpm arch:check`; read-only git.

**Must not run:** the DB-backed lane (`pnpm test` in `server/`, or
`vitest run .it.test`) — it starts Postgres containers; `pnpm db:migrate`,
`pnpm db:seed`, `db:generate`; anything under `docker compose`, and
**never** `docker compose down -v`; the e2e stack (`npm run e2e:hermetic` boots a
whole stack); any install. Items that depend on those are `not verifiable`, with
the exact command named for the caller.

- [ ] **Step 7: Write `## Status vocabulary`**

Precise definitions, one paragraph each:
- **satisfied** — the artifact exists and does what the item demands; evidence
  shown.
- **partially** — some clauses met. You must name the clause that is missing.
  "Partially" with no named gap is not a verdict.
- **not satisfied** — absent, or present and contradicting the item.
- **not verifiable** — needs a command you may not run, needs an environment you
  do not have, or the item is unfalsifiable as written (e.g. "add appropriate
  error handling"). Say which of the three, and route the last one to
  `## Plan defects` as well.

Write one short paragraph at the end of the section recording where this
vocabulary comes from, so a later session does not "correct" it toward something
looser (2026-08-05 research, sources at the end of this plan): a traceability
matrix is defined by ISTQB as a table correlating two entities so as to enable
"the determination of coverage achieved" — coverage, not quality, which is why
this agent refuses code review. **No standards body publishes a per-item status
vocabulary**; ISO/IEC/IEEE 29148 requires that a requirement be *verifiable* and
*traceable* without enumerating statuses. So these four values are this repo's
choice, and the one property they must keep is the one practitioner guidance is
unanimous on: never collapse "no evidence found" into the same bucket as
"verified" or "not applicable". A single `covered` flag conflates distinct
conditions and is the failure this vocabulary exists to prevent.

- [ ] **Step 8: Write `## Output contract`**

```markdown
Implementation surface: <branch diff main...HEAD | files | packages>
Item source(s): <plan path> · <spec path> · <caller requirements>
Items: <n> (from <n> plan steps, <n> global constraints, <n> acceptance items, <n> requirements)

## Items
| ID | Item (quoted or cited) | Status | Evidence |
|---|---|---|---|
| Task 2 / Step 3 | "export `scoreFromFindings`" | satisfied | `reviewer-core/src/scoring.ts:12` |
| GC-2 | "edit both vendor/shared copies" | partially | server copy only — see E1 |
| AC-4 | "null, not zeros, when not indexed" | not verifiable | needs the DB-backed lane |

## Evidence
### E1 — <ID> · <status>
- **Item demands:** <the clause>
- **Found:** `path:line` — "<quoted code>"
- **Gap:** <what is missing, in one or two sentences>

## Could not verify
| ID | Why | Command or check that would close it |
|---|---|---|

## Plan defects
<Unfalsifiable items, placeholders ("TBD", "similar to Task 2"), items with no
`Files:` line, `Interfaces:` names that no task defines, plan clauses that
contradict the cited spec. `None` if none.>

## Beyond the plan
<Files changed that no item asked for — evidence only, no verdict. This is scope
detection, not code review. `None` if none.>

Coverage: <n> satisfied / <n> partially / <n> not satisfied / <n> not verifiable — of <n> items
```

- [ ] **Step 9: Write `## Bash discipline` and `## What you never do`**

`## Bash discipline` — the allowed and forbidden lists from Step 6, plus the
standard never-list (`git commit`/`add`/`push`/`reset`/`stash`/`checkout`,
`gh pr create`, redirects, installs, `docker compose down -v`).

`## What you never do` — edit any file (no grant); tick or untick a checkbox;
review code quality, architecture, or security; accept a self-report as evidence;
fill a row with advice instead of a status; drop an item because it "clearly
shipped"; invent an item the source does not contain; run a mutating or
container-starting command to close a row.

- [ ] **Step 10: Length and shape self-check**

`wc -l` — expect 200–300 lines. Confirm the four statuses appear as a closed list
in exactly one place, and that the `Coverage:` line is in the fenced template.

- [ ] **Step 11: Commit** *(the caller runs this; record the message and stop)*

```
feat(agents): add the plan-verifier subagent

Blackbox item-by-item traceability from a plan, spec, or requirement list to the
code that was actually written. One row per item, four statuses, evidence or an
explicit not-verifiable with the command that would close it. No code review,
by contract.
```

---

## Task 3: `doc-writer.md`

**Files:**
- Create: `.claude/agents/doc-writer.md`

**Interfaces:**
- Consumes: the house shape and frontmatter rules in `## Global Constraints`; the
  documentation-folder layout enumerated in Step 4 below (read from disk on
  2026-08-05).
- Produces: the agent name `doc-writer` and the output-contract headings
  `## Written`, `## Placement`, `## Diagrams`, `## Claims and evidence`,
  `## Not documented`, `## Insight candidates`.

**Skills:** none govern `.claude/agents/*.md`. Confirm
`.claude/skills/mermaid-diagram/SKILL.md` exists before naming it. Do not invoke
it while authoring — the agent invokes it at write time.

**Verify:** Task 5 Part A checks 1–6 for this file, plus the Task 5 Part B
`doc-writer` smoke invocation (caller-run).

- [ ] **Step 1: Write the frontmatter, verbatim**

```yaml
---
name: doc-writer
description: Use to document a feature that has shipped, or to turn a plan, spec, or review into prose documentation with Mermaid diagrams. Knows this repo's per-package `docs/` and `specs/` folders, reads the target folder's own README before writing a word, and links the new file from the package README so it is findable. Every behavioural claim it makes carries a `file:line`. It writes documentation only: never a plan (the planner owns `docs/plans/`), never `CLAUDE.md` or `INSIGHTS.md`, never application code, and it does not invent a spec out of shipped behaviour when no statement of intent exists.
tools: Read, Write, Edit, Grep, Glob, Bash, Skill
---
```

Tool justification: `Write` for the new document, `Edit` for the folder README's
index or "Empty on purpose" line and for the package README link; `Bash` for
read-only git (`git log`, `git show` — how you find out what actually shipped);
`Skill` restricted by prompt to `mermaid-diagram`; `Grep`/`Glob`/`Read` to ground
every claim. No `model:`.

- [ ] **Step 2: Write the framing and `## Contract`**

`# Doc Writer`, framing whose bolded law is:

> **Where a document goes is decided by the target folder's own README, not by
> you — read it before you write a word.**

`## Contract`, six numbered rules:

1. **Read the destination's README first**, and follow what it states: one topic
   per file, kebab-case, document the **why** (mechanics drift and the code is
   the source of truth for those), and link the file from the package README or
   nobody finds it.
2. **Every behavioural claim carries a `file:line`.** You document what the code
   does, not what a plan hoped it would do. Where the code and an existing doc
   disagree, the code wins and the contradiction is worth stating.
3. **A diagram where prose would be worse.** Invoke `mermaid-diagram` and put the
   diagram in the document; no external images, no ASCII art.
4. **Never invent.** No behaviour you did not verify, and no spec conjured out of
   shipped behaviour — `specs/` is a statement of intent, "not a description of
   what the code currently happens to do". If asked for a spec with no intent
   material, say so and offer a `docs/` page instead.
5. **Fix the folder's own bookkeeping in the same task** — the `## Index` list
   where the folder README has one, and the "Empty on purpose" line where your
   file is the first content in that folder.
6. **Documentation only.** No application code, no test, no plan, no
   `CLAUDE.md`, no `INSIGHTS.md`. A durable session lesson is a candidate you
   nominate; the caller records it with `engineering-insights`.

- [ ] **Step 3: Write `## Before you write: the placement gate`**

If the target folder is not obvious from the routing table, or the material spans
two packages (which usually means **two** documents, one per package, cross-linked
— that is how `server/specs/run-cost.md` and
`client/specs/run-cost-display.md` are organised), ask up to 3 numbered questions
and stop. If the caller named the folder, do not stall — read its README and
write.

- [ ] **Step 4: Write `## Where documentation goes` — the routing table**

Factual, read from disk on 2026-08-05. Root `docs/` has exactly three
subdirectories (`agent-prompts/`, `plans/`, `superpowers/`) and **no
`docs/README.md`**; every package `docs/` and every `specs/` folder except
`e2e/specs/` carries a README stating what belongs there.

| Material | Destination | Notes |
|---|---|---|
| Server module deep-dive, data-flow note, decision record ("why the DI container", "why static module registration", "why the reaper runs on boot") | `server/docs/<topic>.md` | Currently **empty**; README says "Empty on purpose" — fix that line |
| What a server endpoint or module is *supposed* to do | `server/specs/<feature>.md` | README has an `## Index` — add an entry |
| UI screen walkthrough, state/data-flow note, decision record ("why hooks-only data access", "why SSE and polling both exist", "why `styles.ts`") | `client/docs/<topic>.md` | Currently **empty** |
| What a screen or flow is *supposed* to do | `client/specs/<screen>.md` | README has an `## Index` — add an entry |
| Grounding rationale, single-pass/map-reduce trade-off, scoring calibration, structured-output repair, injection-hardening decisions | `reviewer-core/docs/<topic>.md` | Currently **empty**; README's own examples are `grounding-gate.md`, `scoring.md` |
| A pipeline stage's contract or invariant, including the deliberate non-guarantees | `reviewer-core/specs/<stage>.md` | No `## Index` — link from `reviewer-core/README.md` |
| Browser-suite prose: debugging a flaky wait, agent-browser command notes, how the hermetic stack is composed, why a journey is uncovered | `e2e/docs/<topic>.md` | **Never `e2e/specs/`** — that folder is executable `NN-name.flow.json`, and in this package "spec" means an agent-browser command list |
| A new e2e journey's coverage row | the coverage table in `e2e/README.md` | Not a new file |
| How a `system_prompt` becomes messages; prompt-authoring conventions | `docs/agent-prompts/` | **Required reading before you document anything about prompt assembly or the output contract** |
| Cross-cutting: architecture, the end-to-end flow, the testing strategy | root `README.md` / `TESTING.md` | Root `docs/` is only for cross-cutting material that is not about one package — do not start a new root-level folder without the caller's say |
| A cross-package execution plan | **not yours** — `docs/plans/` belongs to the planner | And a shipped plan is a snapshot, never updated after the fact |
| A durable session lesson | **not yours** — `INSIGHTS.md` via `engineering-insights` | Nominate it in your report |

- [ ] **Step 5: Write `## The folder README is the spec for your file`**

State the three shared conventions every one of those READMEs carries (one topic
per file, kebab-case, link it from `../README.md`; document the why; update it in
the same commit as the behaviour or delete it — "a confidently wrong doc is worse
than no doc"), then the per-folder differences:

- `server/specs/README.md` and `client/specs/README.md` have an `## Index` list;
  a new spec without an index entry is invisible. `server/docs/`, `client/docs/`,
  `reviewer-core/docs/`, `e2e/docs/` and `reviewer-core/specs/` have **no**
  index — they say "link it from `../README.md` or `../CLAUDE.md`".
- **You link from `../README.md`, never from `../CLAUDE.md`** — a `CLAUDE.md`
  carries standing instructions and is not yours to edit.
- All four package `docs/` READMEs and both empty `specs/` READMEs end with a
  line beginning "Empty on purpose". Your first file in that folder makes it
  false: replace it with a one-line pointer to what is now there.
- Specs are **marked superseded, never quietly edited** after ship, so the
  original intent stays readable.

- [ ] **Step 6: Write `## What a spec must carry`, per package**

From each `specs/README.md`, verbatim in structure:
- `server/specs/`: **Scope** (endpoints/modules, and what is out of scope) ·
  **Contract** (name the Zod contract in `src/vendor/shared/contracts/` rather
  than restating fields; status codes; error cases) · **Behaviour** (ordering,
  idempotency, partial failure, what is persisted) · **Degradation** (no LLM key,
  no GitHub token, repo not indexed, Docker absent — the house rule is degrade
  visibly, never fail the caller) · **Acceptance** (concrete enough to write
  tests from).
- `client/specs/`: **The journey** (entry, steps, exit, route paths) ·
  **States** (loading, empty, error, partial, *live*) · **Data** (which
  endpoints/hooks, and the `ApiError` taxonomy branch on failure) ·
  **Interaction** (keyboard, focus, what is disabled, what is optimistic) ·
  **Acceptance**, plus whether the journey deserves an `e2e` flow. Describe
  behaviour, never markup — a spec that pins class names goes stale immediately.
- `reviewer-core/specs/`: **Inputs/outputs** named against the types in `src/` ·
  **The invariant** · **Edge cases** (empty diff, single file, no findings,
  malformed model output, a finding citing an absent file, cancellation
  mid-chunk) · **What is deliberately not guaranteed** · **Acceptance** as
  assertions for a stubbed `LLMProvider`. No I/O in the examples, mirroring the
  package's purity rule.

- [ ] **Step 7: Write `## Which kind of document this is`**

Before writing a word, classify the piece — this is the
[Diátaxis](https://diataxis.fr/) split, and the four kinds are mutually exclusive:
**tutorial** (learning-oriented, a guided lesson), **how-to guide**
(goal-oriented, directions to a result), **reference** (information-oriented,
technical description of the machinery), **explanation** (understanding-oriented,
discursive, the *why*). Write in one quadrant only: blending a tutorial's
narrative with a reference's exhaustiveness is what makes a page unusable for
both readers. State the chosen kind in the report's `## Placement`.

This maps onto the repo's own split, and the mapping is the useful part: a
`<pkg>/docs/` page is normally **explanation** (the folder READMEs ask for the
*why*, and say the code is the source of truth for mechanics), while a
`<pkg>/specs/` page is closest to **reference** with acceptance criteria attached.
If the material wants to be a how-to, say so — this repo has nowhere for tutorials
and inventing one is the caller's call, not yours.

For an architecturally significant decision, use Nygard's ADR shape, five fields
and no more: **Title**, **Context** (the forces at play), **Decision** (active
voice, full sentences), **Status** (proposed / accepted / deprecated / superseded),
**Consequences** (the resulting context, good and bad). A superseded decision is
**marked superseded, never edited or deleted** — the same append-only discipline
this repo already applies to `INSIGHTS.md` and to `specs/`. The justification is
worth internalising: "large documents are never kept up to date. Small, modular
documents have at least a chance at being updated."

- [ ] **Step 8: Write `## Diagrams`**

Invoke `mermaid-diagram`. Which shape for which material: a request or review
flow → `flowchart`; a request/DI path or an SSE stream over time → `sequence`; a
table set → `erDiagram`; a run lifecycle (queued → running → terminal, plus
cancel and the boot reaper) → `stateDiagram`. Two rules: the diagram must match
the code it depicts, with the `file:line` of each node's implementation named in
the prose beneath it; and a diagram that only restates a list is worse than the
list.

On how much architecture to draw, follow [C4](https://c4model.com/)'s own advice
rather than drawing every level: **system context** and **container** diagrams
earn their place (context is "a good starting point", readable by technical and
non-technical readers alike); a **component** diagram only "if you feel [it]
add[s] value"; and a **code**-level diagram is explicitly discouraged for
long-lived documentation, "particularly ... because most IDEs can generate this
level of detail on demand". Note also that the type-to-purpose mapping above is
our judgement — Mermaid's docs list the available diagram types but publish no
guidance on which to use for what, so do not cite Mermaid as the authority for it.

- [ ] **Step 9: Write `## Repo facts a document must not get wrong`**

- Four standalone packages, no workspace, no root `package.json`, four lockfiles,
  **two package managers** (`server`/`client` pnpm; `reviewer-core`/`e2e` npm).
- `@devdigest/shared` is **two physical copies** that have already drifted:
  `server/src/vendor/shared/` (server + reviewer-core) and
  `client/src/vendor/shared/` (client). Never document it as one module.
- Cross-package imports resolve through tsconfig path aliases only;
  `reviewer-core` never emits JS (`build` is `tsc --noEmit`).
- **Migrations are not applied on boot** (`cd server && pnpm db:migrate`), and
  `pnpm db:seed` is not optional — auth resolves the current user/workspace from
  the seeded row.
- Test lanes split by filename: `*.it.test.ts` is DB-backed and needs Docker;
  everything else is hermetic.
- **This is a course starter with deliberate gaps** — ~15 DB tables and several
  `reviewer-core` prompt slots have zero callers. Never document an unreferenced
  table or slot as a feature; grep for a caller first, and say "defined,
  unreferenced" when that is the truth.
- Task IDs in comments (`A2`, `F1`, `T1.3`, `L06`) are course labels, not
  concepts — do not build a narrative on them, and do not invent new ones.
- Some in-code comments are stale (`repo-intel/service.ts` still calls itself a
  "facade skeleton"); trust the code.
- Never write a secret, a token, a path from `~/.devdigest/secrets.json`, or a
  `DEVDIGEST_CLONE_DIR` value into a document.

- [ ] **Step 10: Write `## Output contract`**

```markdown
## Written
| File | Created/Modified | What it covers |
|---|---|---|

## Placement
<Which folder README ruled, and the line in it that decided. Note the index entry
or the "Empty on purpose" line you fixed, and where you added the link.>

## Diagrams
<Type, what it depicts, and the `file:line` each node maps to. `None` if none.>

## Claims and evidence
| Claim in the doc | Evidence |
|---|---|
| "a review run is fire-and-forget in-process" | `server/src/modules/reviews/run-executor.ts:1-30` |

## Not documented
<What you left out and why — unverifiable, out of scope, or belongs in another
package's folder. `None` if none.>

## Insight candidates
<Non-obvious, durable, actionable cold — candidates for engineering-insights, for
the caller to record. `None` if none.>
```

- [ ] **Step 11: Write `## Bash discipline` and `## What you never do`**

`## Bash discipline` — allowed: `git log`, `git show`, `git diff`, `git blame`,
`git ls-files`, `git status`, listing directories. Never: writes via shell
redirect (`>`, `>>`) — use `Write`/`Edit` so the change is reviewable;
`git commit`/`add`/`push`/`reset`/`stash`/`checkout`; installs; migrations,
seeds, servers, Docker, the database.

`## What you never do` — write or edit application code or tests; write a plan, or
edit one in `docs/plans/` or `docs/superpowers/plans/` (they are snapshots);
edit any `CLAUDE.md` or `INSIGHTS.md`; write prose into `e2e/specs/`; invent a
spec from shipped behaviour; document an unreferenced table or prompt slot as a
feature; leave a new document unlinked; commit or push.

- [ ] **Step 12: Length and shape self-check**

`wc -l` — expect 240–330 lines. Confirm the routing table has a row for every
destination folder that exists on disk and none for a folder that does not.

- [ ] **Step 13: Commit** *(the caller runs this; record the message and stop)*

```
feat(agents): add the doc-writer subagent

Documents shipped features into the right per-package docs/ or specs/ folder,
after reading that folder's README, with Mermaid diagrams and file:line evidence
for every behavioural claim. Bounded away from plans, CLAUDE.md and INSIGHTS.md.
```

---

## Task 4: Update `.claude/agents/README.md`

Last of the authoring tasks, because every row it adds cites a file that must
already exist.

**Files:**
- Modify: `.claude/agents/README.md` — `## Catalog` (lines 12–22),
  `## Inputs and outputs` (24–33), `## Responsibility boundaries` (35–51),
  `## Relationship to skills` (66–78), `## Not in this set yet` (107–113)

**Interfaces:**
- Consumes: the three agent names, tool lists and output-contract headings from
  Tasks 1–3.
- Produces: nothing downstream except Task 5's link check.

**Skills:** none. This is the catalog file the other agents read; keep its
existing voice and table shapes exactly.

**Verify:** Task 5 Part A checks 4 and 7 (dangling links, `git diff --stat`
proportionality), plus a manual read-through that the five edited sections still
read as one document.

- [ ] **Step 1: Add three rows to `## Catalog`**

Append below the `implementer` row, preserving the column order
`Agent | Model | Tools | Responsibility`:

```markdown
| [architecture-reviewer](architecture-reviewer.md) | inherit | Read, Grep, Glob, Bash, Skill | Read-only boundary verdict with `file:line` evidence: Onion, `client/` layering, `reviewer-core` purity, the two shared copies, alias-only imports. Fixes nothing. |
| [plan-verifier](plan-verifier.md) | inherit | Read, Grep, Glob, Bash | Read-only item-by-item traceability of an implementation against its plan, spec, or requirements. No code review. |
| [doc-writer](doc-writer.md) | inherit | Read, Write, Edit, Grep, Glob, Bash, Skill | Writes documentation into the right per-package folder, after reading that folder's README, with Mermaid diagrams. Never a plan. |
```

Leave the paragraph beneath the table untouched — "Only `researcher` pins one" is
still true with four more `inherit` rows.

- [ ] **Step 2: Add three rows to `## Inputs and outputs`**

```markdown
| architecture-reviewer | a review surface (branch diff, files, or a package) | a report in the chat — a verdict row per boundary B1–B6, findings with `file:line` and quoted code, verbatim `arch:check` output, what it did not review. No files. |
| plan-verifier | an implementation surface **and** an item source (plan, spec, or written requirements) | a report in the chat — one row per item with a four-value status and evidence, a `Could not verify` table, plan defects, and a `Coverage:` line. No files. |
| doc-writer | material to document (a shipped feature, a plan, a spec, a review) and optionally a destination folder | documentation files in the working tree, the folder README's index or "Empty on purpose" line updated, plus a report: placement rationale, diagrams, claims with evidence |
```

- [ ] **Step 3: Extend `## Responsibility boundaries`**

Add three bullets in the existing voice, each stating what the agent must *not* do
and naming the neighbour it is bounded against. Use the clauses from this plan's
`## Overlap with the existing three agents` table — at minimum: architecture-reviewer
and plan-verifier have **no `Write` and no `Edit` grant at all**, which is the
strongest form of read-only, and they are the "dedicated verification subagent"
the multi-agent guidance in [`../../INSIGHTS.md`](../../../INSIGHTS.md) endorses;
plan-verifier checks traceability and refuses code review, and never ticks a
checkbox — that stays the implementer's one permitted plan edit; doc-writer owns
`<pkg>/docs/` and `<pkg>/specs/` and never `docs/plans/`, `CLAUDE.md`, or
`INSIGHTS.md`.

- [ ] **Step 4: Rewrite `## Not in this set yet`**

It currently says both an architecture reviewer and a security reviewer are
missing. After Task 1 that is half wrong. Replace with: the architecture reviewer
now exists ([`architecture-reviewer.md`](../../../.claude/agents/architecture-reviewer.md));
a **security reviewer does not**, so that half of the implementer's
`For the review agents` hand-off is still the caller's to arrange, and neither the
implementer's silence nor the architecture reviewer's is an all-clear on security.
Keep the section — do not delete it.

- [ ] **Step 5: Extend `## Relationship to skills`**

One sentence noting the two deliberate narrowings — `architecture-reviewer`'s `Skill` grant is restricted
to `onion-architecture` and `frontend-architecture` because it must cite the rule
it applies, and `plan-verifier` is granted **no** `Skill` tool at all so nothing
pulls it toward the code review its contract forbids. Leave the
`pr-self-review` / `engineering-insights` paragraph as it stands, and add
`doc-writer`'s one exception: it invokes `mermaid-diagram`.

- [ ] **Step 6: Verify the edit is an edit**

```bash
cd d:/Projects/neo/dev-digest
git status --porcelain .claude/agents/
wc -l .claude/agents/README.md
```

Expected: the four intended paths and nothing else; the README grows by roughly
20–32 lines from 122. A jump to ~160+ *changed* lines in a later `git diff` would
mean the file was rewritten rather than edited — check for CRLF per
[`INSIGHTS.md`](../../../INSIGHTS.md) 2026-08-03 before continuing.

- [ ] **Step 7: Commit** *(the caller runs this; record the message and stop)*

```
docs(agents): document the three new subagents in the catalog

Catalog, inputs/outputs, and responsibility-boundary entries for
architecture-reviewer, plan-verifier and doc-writer, plus the "not in this set
yet" note narrowed to the security reviewer, which still does not exist.
```

---

## Task 5: Verify the three definitions against the house conventions

No application code changed, so no package gate applies. These checks are the
gate. Part A is the implementer's; **Part B cannot be** — the implementer has no
`Task` tool and cannot dispatch a subagent, so the smoke invocations are the
caller's. Report Part B as `not run — caller` rather than skipping it silently.

**Files:**
- Modify: none. This task only reads.

**Interfaces:**
- Consumes: all four files from Tasks 1–4.
- Produces: nothing.

**Skills:** none.

**Verify:** the checks below *are* the verification; each states its expected
output.

- [ ] **Step 1 (Part A.1): Frontmatter is exactly five lines and `name` matches the filename**

```bash
cd d:/Projects/neo/dev-digest/.claude/agents
for f in architecture-reviewer plan-verifier doc-writer; do
  end=$(grep -n '^---$' "$f.md" | sed -n 2p | cut -d: -f1)
  nm=$(grep -m1 '^name:' "$f.md")
  echo "$f.md: frontmatter ends line $end | $nm"
done
```

Expected: `frontmatter ends line 5` for all three (`---`, `name`, `description`,
`tools`, `---`), and `name: <f>` matching the filename. A `6` or higher means the
`description` wrapped or a stray field was added — fix it, do not accept it.

- [ ] **Step 2 (Part A.2): `tools:` lists exactly what this plan specified**

```bash
cd d:/Projects/neo/dev-digest/.claude/agents
grep -H '^tools:' architecture-reviewer.md plan-verifier.md doc-writer.md
```

Expected, verbatim:

```
architecture-reviewer.md:tools: Read, Grep, Glob, Bash, Skill
plan-verifier.md:tools: Read, Grep, Glob, Bash
doc-writer.md:tools: Read, Write, Edit, Grep, Glob, Bash, Skill
```

Then confirm no `Write` or `Edit` appears on the `architecture-reviewer` or
`plan-verifier` line, and that no file contains a `model:` line:

```bash
grep -l '^model:' architecture-reviewer.md plan-verifier.md doc-writer.md; echo "EXIT=$?"
```

Expected: no filenames printed (`EXIT=1`).

- [ ] **Step 3 (Part A.3): every project skill named in the three files exists on disk**

```bash
cd d:/Projects/neo/dev-digest
for s in onion-architecture frontend-architecture mermaid-diagram; do
  [ -f ".claude/skills/$s/SKILL.md" ] || echo "MISSING SKILL: $s"
done; echo done
```

Expected: `done` with no `MISSING SKILL:` lines. Those three are the only project
skills these agents name — `architecture-reviewer` cites `onion-architecture` and
`frontend-architecture`, `doc-writer` invokes `mermaid-diagram`, and
`plan-verifier` has no `Skill` grant at all. If a file names any other skill, that
is a defect: either add it to this list or remove the reference. No superpowers
skill is named by any of the three, so the plugin-cache check the earlier draft
ran is not needed.

- [ ] **Step 4 (Part A.4): no dangling relative link in any of the four files**

```bash
cd d:/Projects/neo/dev-digest/.claude/agents
grep -rohE '\]\((\.{1,2}/[A-Za-z0-9._/-]+|[A-Za-z0-9._-]+\.md)[^)]*\)' \
  architecture-reviewer.md plan-verifier.md doc-writer.md README.md \
  | sed -E 's/^\]\(//; s/\)$//; s/#.*$//' | sort -u | while read -r f; do
  [ -e "$f" ] || echo "DANGLING: $f"
done; echo done
```

Expected: `done`, no `DANGLING:` lines. Every path is resolved relative to
`.claude/agents/`, which is the convention the existing three files follow
(`../skills/README.md`, `../../server/CLAUDE.md`).

- [ ] **Step 5 (Part A.5): every hard-coded command exists in its `package.json`**

```bash
cd d:/Projects/neo/dev-digest
node -e "for (const p of ['server','client','reviewer-core','e2e']) console.log(p, Object.keys(require('./'+p+'/package.json').scripts).join(' '))"
```

Expected exactly:

```
server dev build start typecheck arch:check arch:baseline test db:generate db:migrate db:seed
client dev build start typecheck test
reviewer-core typecheck build test
e2e test e2e:hermetic typecheck
```

Then read every command in the new files' tables against that output. Two
specific things to confirm: no file tells anyone to run `pnpm test:unit` or
`pnpm test:integration` (those scripts do **not** exist — `server/package.json` is
`skip-worktree`, which is why [`TESTING.md`](../../../TESTING.md) uses
`pnpm exec vitest run …` instead), and `plan-verifier`'s may-run list names
`pnpm arch:check` and the hermetic lane but never `pnpm test`, which needs Docker.

- [ ] **Step 6 (Part A.6): house-convention checklist, one pass per file**

Read each of the three files start to finish against this list and report a row
per file. A `no` is a defect to fix in this task, not a note for the caller.

| # | Convention | Source |
|---|---|---|
| 1 | Frontmatter has only `name`, `description`, `tools` | `README.md` `## Adding an agent` |
| 2 | `description` is one line, says what it is *for* **and** what it will not do | all three existing agents |
| 3 | `# H1` title, then a framing paragraph with exactly one bolded law | `researcher.md`, `implementer.md` |
| 4 | `## Contract` present, 4–6 numbered rules, each a rule and not a hint | all three |
| 5 | An input gate with "up to 3 numbered questions, then stop and wait" where input can be ambiguous | `researcher.md`, `planner.md` |
| 6 | `## Output contract` contains a fenced ```` ```markdown ```` template | all three |
| 7 | `## Bash discipline` present iff `Bash` is granted, with an explicit never-list | `researcher.md`, `planner.md` |
| 8 | A closing `## What you never do` (or equivalent prohibitions section) | `planner.md`, `implementer.md` |
| 9 | Paths are markdown links relative to `.claude/agents/` | all three |
| 10 | Second-person imperative, no emoji, no "please" | all three |
| 11 | 200–340 lines | 237 / 303 / 382 |
| 12 | Names the neighbour agent it is bounded against, in both description and body | `## Overlap` table in this plan |

- [ ] **Step 7 (Part A.7): the working tree contains exactly the intended change**

```bash
cd d:/Projects/neo/dev-digest
git status --porcelain
```

Expected: `.claude/agents/` (or the seven individual files, once the directory is
tracked) and nothing else — in particular no change under `server/`, `client/`,
`reviewer-core/`, `e2e/`, no `skills-lock.json`, no `CLAUDE.md`, no `INSIGHTS.md`,
and no new lockfile. If `.claude/agents/README.md` is tracked by then, also run
`git diff --stat .claude/agents/README.md` and confirm the changed-line count is
proportional to Task 4's edit; a whole-file diff means CRLF
([`INSIGHTS.md`](../../../INSIGHTS.md) 2026-08-03) and must be repaired before
the task is called done.

- [ ] **Step 8 (Part B — caller-run smoke invocations)**

The implementer cannot dispatch these. Report them as `not run — caller`, with
this checklist verbatim so the caller can execute it.

**B.1 `architecture-reviewer`.** Point it at `server/src/modules/conventions/`
(the most recent feature module, shipped in `4fe5904`). Pass if: the verdict table
has all six rows; every finding carries a `file:line` and quoted code; the
`arch:check` output is quoted with its known/new counts and the 24 frozen
violations are **not** reported as findings; `git status` is unchanged. Fail if it
proposes a refactor plan, gives a security or quality verdict, or suggests
`arch:baseline`.

**B.2 `plan-verifier`.** Give it
[`docs/plans/pr-findings-counters-plan.md`](../../plans/pr-findings-counters-plan.md)
(shipped) as the item source and `main` as the implementation surface. Pass if:
it states an item count before checking; there is one table row per numbered
sub-step; at least one row is `not verifiable` naming a command it may not run
(the DB-backed lane or the e2e stack); the report ends with a `Coverage:` line;
and it contains **no** refactor suggestions. Fail if it merges items, substitutes
a general code-quality section for rows, or reports "all satisfied" without
evidence columns.

**B.3 `doc-writer`.** Ask it for a document the caller actually wants, so the
artifact is keepable — `reviewer-core/docs/grounding-gate.md` is the example that
folder's own README names. Pass if: it reads `reviewer-core/docs/README.md` and
says so in `## Placement`; the file is kebab-case, one topic;
it replaces that README's "Empty on purpose" line and adds a link from
`reviewer-core/README.md`; there is a Mermaid diagram whose nodes map to
`file:line`; and it touched no `CLAUDE.md`, no `INSIGHTS.md`, and no code. Fail if
it wrote into `reviewer-core/specs/` without being asked, or documented a prompt
slot with no caller as a live feature.

- [ ] **Step 9: Commit** *(the caller runs this; record the message and stop)*

```
chore(agents): verify the three new subagent definitions

Frontmatter shape, tool grants, skill-name existence, link resolution and
hard-coded commands checked against the packages' package.json. Smoke
invocations are listed for the caller — a subagent cannot dispatch one.
```

## External sources

The practice claims written into the three agent bodies come from here, researched
2026-08-05 by two independent parallel investigations. This mirrors the
`## Sources` section of [`.claude/agents/README.md`](../../../.claude/agents/README.md):
a rule in an agent file should be traceable to something citable.

**Subagent authoring (all primary):**

| Source | What it settles |
|---|---|
| [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents) | Only `name` + `description` are required; fourteen fields exist in total. **Omitting `tools` inherits every tool** — so read-only must be an allowlist, which is why Tasks 1 and 2 grant no `Write`/`Edit` rather than staying silent. `disallowedTools` is the denylist counterpart. `effort: low\|medium\|high\|xhigh\|max` exists (Open question 1). Built-in `Explore`/`Plan` are the reference read-only pattern. |
| [claude.com/blog/subagents-in-claude-code](https://claude.com/blog/subagents-in-claude-code) | A `description` should name **trigger conditions, not a capability label** — "Reviews code for security issues before commits" routes better than "security expert". Shapes every `description` in this plan. |
| [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) | A separate checker call beats one call doing both work and self-assessment; agents need "ground truth" from tool results. The evidence-first contract in Tasks 1 and 2. |
| [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) | The `CitationAgent` precedent — a dedicated pass that checks claims against sources before they reach the user. Also: a subagent needs "an objective, an output format, guidance on the tools and sources to use, and clear task boundaries", which is the four-part shape of every task here. |
| [When to use multi-agent systems](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them) | Already cited in the agents README: a planner/implementer/tester/reviewer split is an anti-pattern; a dedicated **verification** subagent is what works. The reason `test-writer` was dropped and these two verifiers were kept. |

**Practice per role:**

| Source | Feeds | What it settles |
|---|---|---|
| [ArchUnit user guide](https://www.archunit.org/userguide/html/000_Index.html) · [dependency-cruiser rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) · [ts-arch](https://github.com/ts-arch/ts-arch) | Task 1 | A violation report carries rule + both ends + **direction** + `file:line` + a severity from a closed set (`error`/`warn`/`info`). None of the three structures a suggested fix as evidence. |
| [ISTQB glossary — traceability matrix](https://istqb-glossary.page/traceability-matrix/) | Task 2 | A matrix correlates two entities to determine **coverage achieved** — coverage, not quality. |
| ISO/IEC/IEEE 29148 (⚠️ paywalled, HTTP 403 — reached only via secondary summaries) | Task 2 | *Verifiable* and *traceable* are named requirement-quality characteristics; the standard does **not** enumerate per-item statuses. Treat the four-value vocabulary as ours. |
| [Mocks Aren't Stubs](https://martinfowler.com/articles/mocksArentStubs.html) · [The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html) · [Testing Library queries](https://testing-library.com/docs/queries/about/) · [Playwright best practices](https://playwright.dev/docs/best-practices) | — | Researched for the dropped `test-writer`. **Not used by this plan**; kept here because it is the sourced starting point if that agent is ever revived, and because `implementer.md` covers the same ground today. |
| [Diátaxis](https://diataxis.fr/) | Task 3 | Four mutually exclusive documentation kinds on two axes; write in one quadrant. |
| [Nygard, Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) | Task 3 | The five-field ADR, and supersede-never-edit. |
| [C4 model](https://c4model.com/) | Task 3 | Draw context and container; component only if it adds value; do not hand-draw code level. |
| [Mermaid docs](https://mermaid.js.org/intro/) | Task 3 | The available diagram types — and, as a **negative** result, no official type-to-purpose mapping, so ours is judgement and must not be attributed to Mermaid. |

**Weaker sourcing, flagged deliberately.** The theory behind item-by-item
verification (Fagan inspections, 1976; Gawande's *Checklist Manifesto* on
"errors of ineptitude" and "judgment aided — and even enhanced — by procedure")
was reachable only through secondary retellings, and the fitness-function
definition in *Building Evolutionary Architectures* returned HTTP 403. Those ideas
motivate Task 2's central rule but are **not** quoted as authority in any agent
body. If that rule is ever challenged, it should be defended on the ISTQB
coverage definition above, not on the unverified quotes.

---

## Open questions

All three are now resolved or decided; kept on the record so the reasoning is
visible rather than rediscovered.

1. **~~Is there a documented per-agent reasoning-effort field?~~ RESOLVED
   2026-08-05.** Yes — `effort: low|medium|high|xhigh|max` is documented at
   [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents),
   along with ten other keys the house convention does not use (`disallowedTools`,
   `skills`, `permissionMode`, `maxTurns`, `memory`, `background`, `isolation`,
   `color`, `mcpServers`, `hooks`). Only `name` and `description` are required.
   **Caller decision: keep the four-field convention** and write no `effort`. The
   same page confirms the read-only mechanism this plan relies on: omitting `tools`
   *inherits every tool*, so read-only must be an allowlist that leaves out `Write`
   and `Edit` — which is exactly what Tasks 1 and 2 do, and what the built-in
   `Explore`/`Plan` agents do.
2. **~~May `doc-writer` author a `<pkg>/specs/*.md` post-hoc?~~ DECIDED
   2026-08-05 — the narrow reading, as drafted. No task changes needed.** For the
   record, the reasoning: `specs/` is a statement of intent and its README says a spec is
   "not a description of what the code currently happens to do", so doc-writer
   writes one only when the caller explicitly asks **and** intent material (a
   plan, a design doc, the caller's requirements) exists, and otherwise offers a
   `docs/` page. If the caller wants the wide reading — post-hoc specs
   reconstructed from shipped behaviour — Task 3 Step 2 rule 4 and Step 4's
   routing table both need loosening, and the specs READMEs should be amended in
   the same change so the two do not contradict each other.
3. **~~Commit boundaries, given `.claude/agents/` is untracked.~~ DECIDED
   2026-08-05 — commit the existing three first.** `git status` shows
   `?? .claude/agents/`, so `researcher.md`, `planner.md` and `implementer.md` are
   not yet committed. **Task 0, before Task 1:** the caller commits the three
   existing agent files plus the current `README.md` as their own commit, so the
   three new files and the README edit land as a reviewable diff against a tracked
   baseline. This also makes Task 4 Step 6 and Task 5 Step 7 meaningful — both read
   `git diff --stat` on `README.md`, which shows nothing while the file is
   untracked. Suggested message:

   ```
   chore(agents): track the existing researcher, planner and implementer agents

   These three were authored in earlier sessions but never committed. Landing them
   as-is, with no content change, so the next commit's diff is reviewable.
   ```

   Everything after that is unchanged: the implementer never commits, and each
   task's `Commit` step stays the caller's.
