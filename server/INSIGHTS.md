# `@devdigest/api` — engineering insights

Durable, non-obvious knowledge about this package, accumulated across sessions.
Read it before working here. Append via the
[`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md) skill:
append-only, and correct a wrong entry with a newer dated one rather than
editing it.

Standing rules live in [`CLAUDE.md`](CLAUDE.md). This file is observations, and
an entry can age — verify before relying on one.

## What works

## What doesn't work

- **2026-08-10** — Deriving a PR-scoped status by comparing
  `repo_index_state.lastIndexedSha` to the pull request's `headSha` is
  **structurally always true**, and blast shipped that way: the index is built
  from the clone's default-branch HEAD (`git rev-parse HEAD`, the clone is synced
  to `origin/<defaultBranch>`), while `headSha` is the PR branch's tip — a pull
  request exists precisely because those differ. So `partial`/`index_stale` fired
  on every PR forever and re-indexing could not clear it, which devalued the
  card's only "the map is incomplete" signal. What kept it hidden is worth more
  than the bug: `seed.ts` set `lastIndexedSha: pr.headSha` *specifically* so a
  fresh install would not show it, so every demo and every seeded test looked
  correct and the defect only appeared against imported PRs. **A fixture written
  to make a derived state not fire is a smell — check whether the state can ever
  correctly fire on real data.** The comparison is gone; `partial` now reflects
  the indexer's own verdict only. (`src/modules/blast/helpers.ts:44`,
  `src/db/seed.ts:360`)

- **2026-08-03** — A feature that resolves its model with
  `getFeatureModelOverride(...) ?? SOME_LOCAL_CONSTANT` **silently diverges from
  the Settings screen**. That screen renders
  `chosen[id]?.model ?? f.defaultModel` straight off the `FEATURE_MODELS`
  registry, so with nothing chosen it advertises the *registry* default while
  the feature runs the *module's* constant — no error, no warning, and the only
  symptom is a provider/model string in the UI that never matches what ran.
  Conventions shipped this way for exactly one session: Settings said
  `openai / gpt-5.4`, every scan used `openrouter / deepseek-v4-flash`. The fix
  is to take the fallback from the registry itself
  (`FEATURE_MODELS.find((f) => f.id === '<feature>')`) and change the registry
  when you want a different default — never to restate it locally. Note the
  registry is mirrored in `client/src/lib/feature-models.ts`, so a default
  change is a two-file edit like any other shared contract.
  (`src/modules/conventions/routes.ts:28`)

- **2026-08-03** — [`src/modules/settings/feature-models.ts`](src/modules/settings/feature-models.ts)
  is unreachable from any other module, and both ways around it are also closed.
  Importing it directly is a `no-cross-module-internals` violation; wrapping it
  in a `Container` getter instead closes a **cycle**, because the helper itself
  type-imports `Container` (`container.ts → settings/feature-models.ts →
  container.ts`), which `no-circular` rejects. So a new module that wants the
  workspace's per-feature model has three options, and only the last two pass the
  gate: give up, read the `settings` row in its own `repository.ts` (a cross-table
  read inside one repository is allowed — this is what `conventions` does), or
  move the helper to `platform/` and retype it to take `Db` instead of
  `Container`. Its `FEATURE_MODELS` registry has had a `conventions` entry and a
  Settings UI since long before any reader existed, so this bites the first module
  that tries to use it. (`src/modules/conventions/repository.ts:38`)

- **2026-08-03** — Extends the entry below: bumping the version in SQL fixed the
  *collision*, not the whole class, because `isBodyChange` still compared against
  an unlocked read. Two concurrent `PUT /skills/:id` calls where one re-sends the
  body it read make that one decide "unchanged" — so it skips the bump but
  **still writes its body** (the `set` includes `body` regardless of
  `bodyChanged`), and if its UPDATE lands second the live `skills.body` ends up in
  no snapshot at all. Any "did this field change?" rule that gates a side effect
  is a read-modify-write and needs the row: wrap it in `db.transaction` with
  `.for('update')` on the read, and pass the `tx` into the write *and* the
  snapshot insert (`snapshotVersion(tx, …)` — a snapshot written on `this.db`
  escapes the transaction). This is the first transaction in `src/`; drizzle's tx
  handle types as `Parameters<Parameters<Db['transaction']>[0]>[0]`.
  `AgentsRepository.update` gates `configChanged` on the same kind of unlocked
  read. (`src/modules/skills/repository.ts:104`)

- **2026-08-03** — A single-shot concurrency test passes by luck often enough to
  be worthless. The unlocked-read defect above showed up in ~5 of 8 races and the
  first version of its test — one race, one ordering — went green against the
  broken code. Race tests here need **both orderings** (`[a(), b()]` and
  `[b(), a()]`) repeated ~3× each inside one `it`, with the ordering and
  iteration in the assertion message so a failure says which interleaving broke.
  Also worth knowing where the window is: two `app.inject` PUTs in a
  `Promise.all` do interleave their reads, while two direct `repo.update` calls
  in a `Promise.all` serialised and never reproduced it — test the race at the
  layer that actually has it. (`test/skills.it.test.ts:206`)

- **2026-08-03** — Computing the next version in JS (`existing.version + 1` from
  a prior `SELECT`) and snapshotting it with `.onConflictDoNothing()` **loses
  history silently**. Two `PUT /skills/:id` bodies landing together both read v1,
  both write `version = 2`, and the second `skill_versions` insert hits the
  `(skill_id, version)` unique index and is swallowed — so the row says v2 while
  the only v2 snapshot holds the *other* writer's body, and the Versions tab
  shows a body that was never saved. Bump in SQL instead
  (`set({ version: sql`${t.skills.version} + 1` })`) and snapshot
  `.returning()`'s `row.version`: each writer then gets its own version number
  and its own snapshot. `AgentsRepository.bumpForSkillChange` already did it this
  way; `AgentsRepository.update` still computes `nextVersion` in JS and has the
  same hole. Reproducible without any sleep: two `app.inject` calls in one
  `Promise.all` (`test/skills.it.test.ts:183`).
  (`src/modules/skills/repository.ts:120`)

- **2026-08-03** — Asserting `agent_skills.order` by sorting on it and comparing
  the *names* is a test that cannot fail. `Array.prototype.sort` is stable, so
  when every link is written at `order: 0` the rows keep the order Postgres
  returned — which is insertion order — and the expected sequence still matches.
  A mutation that replaced `order` with `0` in
  [`src/db/seed.ts`](src/db/seed.ts)'s link loop left the suite green. Assert the
  `[name, order]` pairs sorted by **name** instead: the stored column is then
  part of the comparison. The same trap applies to any ordered join table here
  (`agent_skills`, and anything else keyed on a positional column).
  (`test/seed-agent-skills.it.test.ts:63`)

- **2026-08-02** — Supersedes the 2026-08-02 entry below on cycle counts: taking
  `Container` does **not** by itself close a cycle. The frozen baseline holds
  five `no-circular` entries; four run through `platform/container.ts`, and all
  four are `repo-intel`'s — because `container.ts` is the only place that
  constructs a service it also imports (`new RepoIntelService(this)`). `agents`,
  `repos`, and `reviews` take `Container` and close **no** cycle at all. Keep the
  two consequences apart: taking `Container` always breaks the dependency rule
  (the entire outer ring lands in the core's type graph), and it *additionally*
  closes a cycle only where the container constructs you. The fifth cycle is
  `agents/helpers.ts` ⇄ `agents/repository.ts` and involves no container.
  (`src/platform/container.ts:116`)

- **2026-08-02** — `constructor(private container: Container)` is not just a
  wide dependency, it is a **real import cycle**. `Container` imports
  `modules/repo-intel/service.ts`, `modules/reviews/repository.ts`, and
  `modules/agents/repository.ts`, so a service importing `Container` closes the
  loop. A dependency-cruiser run over `src` finds four such cycles, e.g.
  `repo-intel/service.ts → platform/container.ts → repo-intel/service.ts`
  (`incremental.ts` and `full.ts` add two more through the same edge). All four
  services do this — `agents`, `repos`, `reviews`, `repo-intel`. The fix is a
  narrow per-module deps object built by a container getter, not a wider
  `ContainerOverrides`. (`src/modules/repo-intel/service.ts:104`)

## Codebase patterns & tool notes

- **2026-08-09** — The `declFiles` parameter of
  [`RepoIntelRepository.getResolvedCallers`](src/modules/repo-intel/repository.ts)
  is **the PR's whole changed-file list**, not one symbol's declaration file —
  `tryPersistentBlast` passes `changedFiles` straight through. So filtering
  self-references with `notInArray(references.fromPath, declFiles)` reads
  correctly and is wrong: it drops every caller the PR *also* touches, which on
  a real multi-file diff is most of them (the seeded nine-file PR #482 went from
  four callers of `rateLimit` to one). The self-reference filter has to be
  column-to-column — `ne(references.fromPath, references.declFile)` — because
  only `decl_file` names the file that actually declares the symbol. The same
  confusion bites the fact-file set: `getReverseDependents` excludes its own
  inputs by contract, so `changedFiles` must be unioned back in explicitly or a
  changed route file's own endpoints/crons are attributed to nothing.
  (`src/modules/repo-intel/repository.ts:527`,
  `src/modules/repo-intel/service.ts:394`)

- **2026-08-06** — `GET /pulls/:id` **deletes and re-inserts every `pr_files` row
  on each request** (and the same for `pr_commits`), so nothing per-file can be
  cached on that table: a column added there is silently wiped by the next page
  load, with no error to notice. Any per-file derived data needs its own table
  keyed `(pr_id, path)` — `pr_file_summary` is one, and it carries `head_sha` as
  its freshness key for the same reason `pr_intent` does. Also note the row's
  `patch` is `f.patch ?? null`: GitHub omits `patch` for large and binary files,
  so a **patch-less row is normal**, not corruption, and any feature that reads
  `pr_files.patch` must handle it rather than coercing to `''`.
  (`src/modules/pulls/routes.ts:217`)

- **2026-08-06** — `findings` carries **one row per finding**, so several findings
  can cite the same `file` + `start_line` — two agents in one batch flagging the
  same line is the normal case, not an edge case, and nothing dedupes it. Any
  per-line UI or projection must therefore *select* deterministically (worst
  severity) rather than take the first match, and any "lines" projection must
  dedupe explicitly. `SmartDiff` splits this deliberately: `finding_marks` is
  one-per-finding while `finding_lines` is the sorted-unique projection of it,
  derived in one place so they cannot drift. A consumer that assumes
  `finding_marks` is already unique per line silently drops findings.
  (`src/modules/smart-diff/service.ts:80`,
  `src/modules/reviews/repository/review.repo.ts:60`)

- **2026-08-03** — The seeded demo repo has `clone_path: null`
  ([`src/db/seed.ts`](src/db/seed.ts)), so any `*.it.test.ts` for a feature that
  reads the clone takes the "no clone on disk" degradation branch and never
  reaches the real code — the test goes green having exercised an early return.
  It is easy to miss because the assertion that survives (`status` is terminal,
  not `running`) still looks meaningful. To cover the real path, `mkdtemp` a
  directory, write the files the feature expects into it, and
  `db.update(t.repos).set({ clonePath: dir })` in a `beforeAll`. Put that block
  **last** in the file if the feature replaces rows, and reset any state earlier
  cases left behind (a scan parked at `queued` will 409 the next request).
  (`test/conventions.it.test.ts:213`)

- **2026-08-02** — Corrects the "reaching for the alias through the wrong file"
  advice in the `no-circular` entry below: a module's `helpers.ts` cannot import
  its row types from [`src/db/rows.ts`](src/db/rows.ts) either. `core-no-persistence`
  scopes the core ring to `src/modules/*/(service|helpers|domain|ports).ts` and
  bans every `^src/db/` import but `db/client.ts`, so that route trades a
  `no-circular` failure for a `core-no-persistence` one — the two rules close off
  both files a row type could come from. What works is declaring the row shape
  **structurally** in `helpers.ts` (a plain interface of the columns the
  transforms read): the Drizzle `$inferSelect` row satisfies it, so the
  repository and service call sites type-check with no cast and no re-export. A
  module-local `domain.ts` would also satisfy both rules, but only if nothing in
  it imports `src/db/`. (`src/modules/skills/helpers.ts:15`)

- **2026-08-02** — `pnpm arch:check` does **not** keep the database out of the
  core. `core-no-persistence` exempts [`src/db/client.ts`](src/db/client.ts) by
  path (`pathNot: '^src/db/client\.ts$'`) on the rationale that it is "the `Db`
  type a repository constructor takes" — but that file also exports
  `createDb(databaseUrl, opts)`, a runtime factory that opens a live
  `postgres()` pool. A `service.ts` can `import { createDb } from
  '../../db/client.js'`, connect to the database, and the gate stays green. This
  is a hole in the gate, not a limitation of type-level analysis — don't read the
  rule's comment as a guarantee. Proper fix is to move `export type Db` into its
  own type-only file and repoint the `pathNot` there, leaving `createDb` under
  the general `^src/db/` ban. (`src/db/client.ts:17`)

- **2026-08-02** — Because `tsPreCompilationDeps: true` is set (entry below),
  `no-circular` also fires on cycles that are **type-only** and cannot exist at
  runtime — including on new code written the way the architecture docs
  prescribe. The frozen example: `agents/helpers.ts` type-imports `AgentRow` from
  `agents/repository.ts`, while `repository.ts` value-imports `isConfigChange`
  back. Do **not** silence it with `dependencyTypesNot: ['type-only']`; that
  would also blind the rule to the four genuine `repo-intel` runtime cycles. Fix
  it structurally instead — declare the module's shared row/domain types in a
  `domain.ts` so both files import downward. `agents` is one step away already:
  `repository.ts` merely re-exports `AgentRow` from `db/rows.ts`, so `helpers.ts`
  is reaching for the alias through the wrong file.
  (`src/modules/agents/helpers.ts:3`)

- **2026-08-02** — Any static-analysis tool pointed at `src` must be configured
  to see **type-only imports**, or it will silently miss the DI boundary. The
  couplings that matter most here are written `import type { Container } from
  '../../platform/container.js'`, which vanishes at compile time. For
  dependency-cruiser that means `tsPreCompilationDeps: true` plus
  `tsConfig: { fileName: 'tsconfig.json' }` (the latter for the
  `@devdigest/shared` path alias); without the first flag a rule forbidding
  service→container passes on code that violates it. Measured baseline for a
  correctly configured run: 149 modules, 467 dependencies.
  (`src/modules/agents/service.ts:1`)

- **2026-07-29** — `ContainerOverrides` covers *adapters* only. The shared
  repositories (`container.reviewRepo`, `container.agentsRepo`) are constructed
  from `this.db` in [`src/platform/container.ts`](src/platform/container.ts) and
  have no override key, so a test that needs a repository method to *fail* — the
  usual way to exercise a route's degrade-don't-500 path — can't inject a mock.
  Spy on the cached instance instead: the getter memoises, so
  `vi.spyOn(app.container.reviewRepo, 'someAggregate').mockRejectedValue(…)`
  after `buildApp()` reaches the same object the route uses. It also counts
  calls, which is how you prove an aggregate runs once per page rather than once
  per row. (`test/reviews.it.test.ts:399`)

## Decisions

- **2026-07-28** — Per-run LLM cost is *removed*, not unbuilt. `d45ab0d`
  ("feat(reviews): remove per-PR/run cost, keep model pricing") dropped
  `agent_runs.cost_usd` (migration `0009`), the `completeAgentRun` parameter,
  and `cost_usd` on `RunStats`/`RunSummary`, along with the client's COST tile —
  but deliberately **kept** the entire pricing stack:
  [`estimateCost`](src/adapters/llm/pricing.ts),
  [`PriceBook`](src/platform/price-book.ts) (live OpenRouter `/models` prices,
  injected into the provider by the container), and `reviewer-core`'s
  OpenRouter provider, which already sends `usage: { include: true }` and
  returns a real `costUsd` on `ReviewOutcome`. The server throws that value away
  on a single destructuring line. Restoring cost display is therefore a guided
  revert — `git show d45ab0d` is a usable reverse-patch — needing zero new
  pricing code and zero extra model calls. Don't re-derive a price table.
  (`src/modules/reviews/run-executor.ts:213`)

## Recurring errors & fixes

- **2026-08-10** — Every `octokit.rest.*.list*` call here is a **single page**
  unless it goes through `octokit.paginate`, and `per_page: 100` is GitHub's
  maximum, not a safety margin — so it reads as deliberate while silently
  truncating. `pulls.listFiles` capped `pr_files` at 100 rows for any PR with
  more changed files, and GitHub returns them **path-sorted**, so the dropped
  tail is whatever sorts last: on this repo's own 125-file branch that was every
  single `server/src/modules/**` and `server/test/**` file, i.e. the entire
  substance of the change. There is no error and no truncation flag; the only
  symptom is downstream features looking thin. `pr_files` feeds blast radius,
  smart-diff grouping, `diff-loader`'s patch reconstruction and prior-PRs
  overlap, so one missing `paginate` degrades four features at once. Confirm with
  `SELECT count(*) FROM pr_files WHERE pr_id = …` — exactly 100 is the tell.
  `listCommits` had the identical defect (GitHub caps it at 250).
  (`src/adapters/github/octokit.ts:79`)

- **2026-08-10** — A testcontainers fixture must be owned by **one** outer
  `describe`. Vitest runs an `afterAll` registered inside a `describe` as soon as
  *that* block's tests finish — before the next sibling `describe` runs — so a
  file laid out as two top-level `d(...)` blocks sharing a module-level `db` hands
  the second block a closed pool. It does not surface as a teardown error: every
  `app.inject` returns **500 `write CONNECTION_ENDED localhost:<port>`**, which
  reads like a route bug, and the query-level tests above it all pass. Nest the
  second block instead, as [`test/blast-routes.it.test.ts`](test/blast-routes.it.test.ts)
  does — one outer `d(...)` holding `beforeAll`/`afterAll`, plain `describe`s
  inside. Worth knowing alongside it: when `startPg()` itself fails (the reaper
  is flaky on Windows), the module-level `db` and id vars stay `undefined`, so
  `buildApp({ db: undefined })` quietly connects to the *dev* database from
  `config.databaseUrl` and the route 422s on a `/pulls/undefined/...` uuid — a
  container failure can therefore masquerade as an assertion failure two suites
  away. (`test/blast-prior-prs.it.test.ts:63`)

- **2026-08-09** — A repo-intel fixture whose `changedFiles` has **one entry**
  cannot distinguish "this symbol's declaration file" from "the set of changed
  files" — every predicate over the two is trivially equivalent, so a filter
  that confuses them passes. Two blast defects lived through a green
  hand-built route it-test for exactly this reason and only appeared when the
  same endpoint was pointed at the seeded nine-file PR #482. When testing
  anything in `repo-intel` that takes a file list, make the fixture's list
  contain a file that is *also* a caller/dependent of another file in it —
  that overlap is the normal case in a real PR and the only shape that
  exercises the distinction. Asserting the whole file set a query was asked
  for (rather than just the result) is what localises it.
  (`test/blast-routes.it.test.ts:396`, `test/repo-intel-blast.test.ts:140`)

- **2026-08-06** — The hermetic/integration lane split excludes by **filename, not
  by `describe`**, so a Docker-free block placed inside an `*.it.test.ts` file
  **never runs in the fast lane** — `--exclude '**/*.it.test.ts'` drops the whole
  file. The symptom is a regression guard that looks present in review, passes
  when you run its file directly, and is silently absent from every normal
  `pnpm test` run. A hermetic case belongs in its own non-`.it.` file
  (`test/smart-diff-service.test.ts` is one); the only thing that decides which
  lane a case runs in is the filename it sits in. Confirming it landed is one
  command: the hermetic lane's file count should go up.
  (`test/smart-diff-service.test.ts`)

- **2026-08-05** — An `.it.test.ts` that awaits
  [`waitForPrRuns`](test/helpers/runs.ts) and then reads `GET /runs/:id/trace`
  is racing, and 404s intermittently — the more agents in the batch, the more
  often. `runOneAgent` calls `completeAgentRun` (which writes the terminal
  status the helper polls for) at `run-executor.ts:295` and only saves the trace
  45 lines later at `:340`, so the helper can return while the last run's
  `run_traces` row does not exist yet. Existing single-agent tests hide it
  because the gap is one `await`. To assert on a run's *log*, read the
  replay-first SSE buffer instead (`GET /runs/:id/events`): it is in memory,
  complete the moment the events were emitted, and is the very source
  `runLog.logFor` persists into the trace — so it proves the same thing without
  the window. (`test/intent-review.it.test.ts:161`)

- **2026-08-03** — `pnpm db:generate` **blocks on an interactive prompt** when
  one migration both drops a column and adds columns to the same table: drizzle-kit
  asks "created or renamed from another column?" once per added column. It reads
  raw keypresses, so piping newlines into it does nothing and the command hangs —
  which makes it unrunnable from any non-interactive shell, including an agent's.
  Don't hand-write the SQL to get around it. Split the schema edit in two and
  generate twice: first the deletion alone, then the additions (with no pending
  dropped column, there is nothing to disambiguate and no prompt). That is why
  `conventions` landed as `0013_drop_convention_accepted` plus
  `0014_conventions_extractor` rather than one file. Adding a table alongside
  column changes is fine — the prompt only fires on drop-plus-add in one table.
  (`src/db/migrations/0013_drop_convention_accepted.sql`)

- **2026-08-02** — Resolves the 2026-07-28 entry below: `writeFileAt` in
  [`test/indexer-pipeline.test.ts`](test/indexer-pipeline.test.ts) now uses
  `dirname`, and the hermetic lane is green on Windows — those 6 failures are no
  longer expected, so a red `indexer-pipeline` today **is** your change. The
  same defect still sits in
  [`test/indexer-walk.test.ts`](test/indexer-walk.test.ts), where it is invisible
  rather than fixed: its variant slices to `lastIndexOf('/')` **without** a
  guard, so on Windows `slice(0, -1)` yields the path minus its last character
  (`…\src\b.t`) and `mkdir(…, { recursive: true })` creates the real parent as a
  byproduct. The write then succeeds and the suite passes, leaving a junk
  directory inside each temp `src/`. Two copies of one helper, one loud failure
  and one silent one — grep for `lastIndexOf('/')` before trusting any path
  arithmetic in a test helper. (`test/indexer-walk.test.ts:20`)

- **2026-07-28** — 6 tests in [`test/indexer-pipeline.test.ts`](test/indexer-pipeline.test.ts)
  fail on Windows with `ENOENT … \src\a.ts`, and have nothing to do with
  whatever you just changed — verify against a clean tree before chasing them.
  Its `writeFileAt` helper builds the path with `join()` (so `\` on Windows)
  but then looks for the parent directory with `full.lastIndexOf('/')`, which
  returns −1, so the `mkdir` is skipped and the write hits a missing directory.
  CI is Linux, so it stays green there. Fix is `path.dirname(full)`, not a
  separator swap. (`test/indexer-pipeline.test.ts:142`)

## Open questions
