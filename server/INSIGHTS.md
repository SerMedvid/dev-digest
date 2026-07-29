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

## Codebase patterns & tool notes

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
