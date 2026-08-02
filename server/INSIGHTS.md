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

- **2026-07-28** — 6 tests in [`test/indexer-pipeline.test.ts`](test/indexer-pipeline.test.ts)
  fail on Windows with `ENOENT … \src\a.ts`, and have nothing to do with
  whatever you just changed — verify against a clean tree before chasing them.
  Its `writeFileAt` helper builds the path with `join()` (so `\` on Windows)
  but then looks for the parent directory with `full.lastIndexOf('/')`, which
  returns −1, so the `mkdir` is skipped and the write hits a missing directory.
  CI is Linux, so it stays green there. Fix is `path.dirname(full)`, not a
  separator swap. (`test/indexer-pipeline.test.ts:142`)

## Open questions
