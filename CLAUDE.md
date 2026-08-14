# DevDigest — working notes for Claude

Local-first AI pull-request review. One flow works end to end: add a repo →
clone + index → import PRs → **Review** → LLM → grounding gate → persisted
findings. Read [`README.md`](README.md) for the architecture and the review flow;
this file is only the things that are easy to get wrong.

## Read first

| Doc | When |
|---|---|
| [`README.md`](README.md) | architecture, the end-to-end flow, quick start |
| [`TESTING.md`](TESTING.md) | suite-per-package strategy, CI path filters |
| [`server/README.md`](server/README.md) | API map, request/DI flow, env vars |
| [`client/README.md`](client/README.md) | UI route map |
| [`reviewer-core/README.md`](reviewer-core/README.md) | the review pipeline |
| [`e2e/README.md`](e2e/README.md) | browser flows, hermetic runner |
| [`docs/agent-prompts/`](docs/agent-prompts/) | **required** before touching any agent `system_prompt` |
| [`INSIGHTS.md`](INSIGHTS.md) + `<pkg>/INSIGHTS.md` | before working in a package — what past sessions learned |

Each package also has its own `CLAUDE.md` with rules local to it.

**Docs and specs are per package.** Every package carries `docs/` (documentation
too deep for its README — deep-dives, decision records) and `specs/` (what a
feature is *supposed* to do: contract, behaviour, degradation, acceptance). Each
folder has a README stating what belongs there. Repo-root `docs/` is only for
cross-cutting material that isn't about one package.

One exception worth knowing: [`e2e/specs/`](e2e/specs/) holds **executable**
agent-browser flow definitions, not prose — written specs for that package go in
[`e2e/docs/`](e2e/docs/).

## This is a course starter — expect deliberate gaps

Later lessons (L01–L08) add features back, so the scaffolding runs ahead of the
code. Do **not** "fix" these:

- **~15 DB tables have zero code references** (`memory`, `conventions`,
  `eval_*`, `ci_*`, `multi_agent_runs`, `installed_plugins`, `digests`,
  `code_chunks`, `onboarding`, `pr_brief`, `skill_versions`, …). They sit empty
  until a lesson fills them. Existing ≠ live — grep before assuming a table is used.
- Comments reference task IDs (`A2`, `F1`, `T1.3`, `T2.2`, `T3`, `L06`). These are
  course labels, not code concepts. Don't invent new ones.
- `reviewer-core` accepts prompt slots nothing feeds yet (`skills`, `memory`,
  `specs`). Omitted slots render no section — that's the contract.

## Not a monorepo — five standalone packages

No workspace, no root `package.json`. Each package has its own lockfile, and
**the package manager differs per package**:

| Package | Manager | Install | Test |
|---|---|---|---|
| `server/` | **pnpm** | `pnpm install` | `pnpm test` |
| `client/` | **pnpm** | `pnpm install` | `pnpm test` |
| `mcp/` | **pnpm** | `pnpm install` | `pnpm test` |
| `reviewer-core/` | **npm** | `npm ci` | `npm test` |
| `e2e/` | **npm** | `npm ci` | `npm test` |

Using the wrong one writes a second lockfile. Check for `pnpm-lock.yaml` vs
`package-lock.json` before installing.

Cross-package imports resolve through **tsconfig path aliases only** — TypeScript
source is consumed directly (tsx in dev, vitest in tests). `reviewer-core` never
emits JS; its `build` is `tsc --noEmit`.

## Superpowers — what this repo uses, and what it does not

The plugin is enabled in [`.claude/settings.json`](.claude/settings.json). Its own
`using-superpowers` skill states that user instructions take precedence over
skills, so this section is the policy.

**Feature work runs on superpowers, end to end.** The chain is
`superpowers:brainstorming` → `superpowers:writing-plans` →
`superpowers:executing-plans`, with `superpowers:test-driven-development`
inside each task and `superpowers:systematic-debugging` for anything that
misbehaves. `superpowers:verification-before-completion` gates the claim that
it works, and `superpowers:dispatching-parallel-agents` is what
[`pr-self-review`](.claude/skills/pr-self-review/SKILL.md) uses to dispatch its
review lanes.

Three local amendments to that chain:

- **`brainstorming` writes the design doc to
  `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and commits it.** Write
  the file, don't commit it — no agent here commits (see the last line of this
  section). The doc *is* the spec; there is no separate spec artefact.
- **`writing-plans` ends every task with a "Commit" step.** Replace it with the
  task's verification command. Same reason.
- **`executing-plans` opens by ensuring an isolated workspace via
  `superpowers:using-git-worktrees`.** Skip that step. Instead, check the tree
  is clean before task 1 and stop to ask if it is not — starting a feature on
  top of someone else's uncommitted work mixes two changes into one diff and
  makes either one impossible to revert.

**The custom spec-driven chain is switched off.** `specreator`,
`implementation-planner` and [`/impl-sdd`](.claude/skills/impl-sdd/SKILL.md)
are not to be used to drive work: it is slow out of proportion to what it
buys, and its remediation rounds have introduced defects of their own. The
files stay in the tree for reference. `.claude/agents/implementer.md` is still
the right prompt for a *subagent* asked to execute one task, but the plan and
the loop around it are `writing-plans` and `executing-plans`.

**Still not used, and why:**

- **`superpowers:subagent-driven-development`** dispatches `general-purpose`
  subagents with its own implementer prompt, so this repo's implementer — skill
  routing, the per-package managers, `arch:check`, the two `vendor/shared`
  copies — is bypassed; its implementer template also commits each task, and its
  controller is told to rule on conflicts rather than stop. Run plans inline
  with `superpowers:executing-plans` instead.
- **`superpowers:finishing-a-development-branch`** merges, pushes and opens PRs.
  All three are the caller's, and `gh pr create` is gated by the
  `pr-self-review` hook.
- **`superpowers:writing-skills`** competes with this repo's own conventions in
  [`.claude/skills/README.md`](.claude/skills/README.md). Invoke it only when
  deliberately authoring a skill.

No agent in this repository commits, pushes, branches, or creates a worktree.

## Insights — read them, write them back

Each package has an `INSIGHTS.md` next to its `CLAUDE.md`: durable, non-obvious
things earlier sessions learned the hard way. **Read the one for the package
you're touching** before you start, along with its `CLAUDE.md`. Treat it as
high-confidence guidance unless something in front of you contradicts it — an
entry can age, and correcting a stale one is part of the job.

When a session surfaces something that passes all three tests — **non-obvious**
(not already evident from the code), **durable** (still true next month), and
**actionable cold** (names the thing and says what to do) — invoke the
`engineering-insights` skill right then, and again when wrapping up the task.
Don't defer it to the end; the end is where it gets forgotten.

Entries are **append-only**. A wrong entry is corrected by a newer dated one,
never by rewriting the old one — seeing what was believed, and when, is most of
the value once something turns out to be wrong.

Do **not** record: what the code already says, what a `CLAUDE.md` already says,
what you did this session, or a slip with no lesson in it. A noisy `INSIGHTS.md`
gets skimmed and then ignored, which is worse than an empty one.

## `@devdigest/shared` is two physical copies — edit both

The alias resolves to **different directories** per package:

- `server/` and `reviewer-core/` → [`server/src/vendor/shared/`](server/src/vendor/shared/)
- `client/` → [`client/src/vendor/shared/`](client/src/vendor/shared/)

Nothing enforces sync and **they have already drifted** (`adapters.ts`,
`contracts/trace.ts`, `knowledge.ts`, `eval-ci.ts`, `productionize.ts` differ;
the client copy is behind). When you change a contract used by both sides, apply
the edit to both files and typecheck both packages.

Related consequence: each package installs its own `zod`, so
`err instanceof z.ZodError` can be false across the boundary. The error handler
in [`server/src/app.ts`](server/src/app.ts) therefore also matches ZodError *by
shape* — keep that, and don't add cross-package `instanceof` checks on library
classes.

## Portability

The app is OS-agnostic and must stay that way: it has to run on any contributor's
machine, and CI runs on Linux. No platform-specific branches, paths, or
assumptions in application code.

- **CLI entrypoints compare against `pathToFileURL(process.argv[1]).href`**, never
  a `file://${process.argv[1]}` template. The template form only matches when
  `argv[1]` is already a POSIX path; everywhere else the "am I the entrypoint?"
  check silently fails and the script exits 0 having done nothing. Reference
  implementation: [`server/src/db/migrate.ts`](server/src/db/migrate.ts).
- Build paths with `path.join` / `path.resolve`. Never concatenate with a
  hardcoded separator, and never assume a path shape when parsing one.
- `scripts/*.sh` are POSIX shell. Prefer adding a `pnpm`/`npm` script over
  shelling out, so every environment gets the same entrypoint.

## Database

- **Migrations are NOT applied on boot.** `cd server && pnpm db:migrate`. Any
  `relation ... does not exist` error is this.
- **`pnpm db:seed` is not optional.** Auth resolves the current user/workspace by
  looking up the *seeded* row; an unseeded DB throws on every request.
- Never hand-edit an applied migration in `server/src/db/migrations/` — change
  `src/db/schema/*.ts` and run `pnpm db:generate`.
- **Never `docker compose down -v`.** The `-v` drops `devdigest_pgdata` and every
  imported repo and review with it. Stop the container without `-v`.

## Git

- Conventional commits with a scope: `fix(db):`, `feat(reviews):`, `ci(server):`,
  `chore:`. Explain *why* in the body.
- Branch off `main`; don't commit straight to it.
- Secrets live in `~/.devdigest/secrets.json` (outside the repo) and clone
  checkouts in `DEVDIGEST_CLONE_DIR` — neither belongs in a commit.

## Before saying it works

- `cd server && pnpm typecheck` and `cd client && pnpm typecheck` are fast; run
  the one you touched.
- Server tests split by filename: hermetic by default,
  `pnpm exec vitest run --exclude '**/*.it.test.ts'`; DB-backed ones are
  `*.it.test.ts` and need Docker.
- CI is path-filtered per package, and `reviewer-core/**` also triggers the
  server workflows (the server type-checks against `../reviewer-core/src`).
