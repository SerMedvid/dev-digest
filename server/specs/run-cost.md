# Spec — Run cost (persistence + exposure)

**Status:** DRAFT (2026-07-28)
**Owner:** server · **Consumer:** client ([`client/specs/run-cost-display.md`](../../client/specs/run-cost-display.md))
**Related:** `reviewer-core` `ReviewOutcome`, [`PriceBook`](../src/platform/price-book.ts), [`estimateCost`](../src/adapters/llm/pricing.ts)

Every review run already resolves its own dollar cost inside the engine. The
server currently discards it at
[`run-executor.ts:213`](../src/modules/reviews/run-executor.ts) — a deliberate
removal (`d45ab0d`, migration `0009` dropped `agent_runs.cost_usd`). This spec
restores the persistence path and adds a per-PR roll-up, so the studio can show
what a review actually cost **without issuing a single extra model call**.

## 1. Scope

**In scope**

- Persist per-run cost on `agent_runs`.
- Expose it on `RunSummary` (`GET /pulls/:id/runs`) and `RunTrace.stats`
  (`GET /runs/:id/trace`).
- A per-PR cost roll-up on `GET /repos/:id/pulls`.

**Out of scope**

- `ci_runs.cost_usd` and `eval_runs.cost_usd` — both columns already exist and
  neither has a route.
- The orphaned cost fields in `contracts/observability.ts`,
  `contracts/productionize.ts`, `contracts/eval-ci.ts`, `contracts/knowledge.ts`.
  They stay unimplemented until their lessons land.
- Budgets, quotas, spend alerts, and cost aggregation across PRs or workspaces.
- Prompt assembly and the `Review` contract — unchanged, so
  [`docs/agent-prompts/`](../../docs/agent-prompts/) is untouched.
- Backfilling cost for runs that predate this change (decided: they stay null).

## 2. Contract

The Zod definitions in `src/vendor/shared/contracts/` are the source of truth.
This change adds exactly one field to each of three existing contracts:

| Contract | File | Added |
|---|---|---|
| `RunSummary` | `contracts/trace.ts` | `cost_usd`, nullable number |
| `RunStats` | `contracts/trace.ts` | `cost_usd`, nullable number |
| `PrMeta` | `contracts/platform.ts` | `cost_usd`, nullish number |

`@devdigest/shared` is **two physical copies** and `contracts/trace.ts` is
already on the known-drift list. Every edit lands in both
`server/src/vendor/shared/` (read by the server *and* `reviewer-core`) and
`client/src/vendor/shared/`, and both packages get type-checked. Diff the two
copies before editing rather than assuming they match.

No route gains or changes a status code, and no new error case is introduced.
`GET /pulls/:id/runs` declares no `schema.response`, so nothing strips the new
field on the way out.

Storage: `agent_runs.cost_usd`, `double precision`, nullable. Schema change goes
through `src/db/schema/runs.ts` → `pnpm db:generate`; migration `0009` is applied
and must not be edited.

## 3. Behaviour

### 3.1 The value is captured, never recomputed

What gets persisted is whatever `ReviewOutcome.costUsd` already resolved to
inside the engine, in this precedence:

1. OpenRouter's real `usage.cost` — the request already carries
   `usage: { include: true }`, so this costs nothing extra;
2. the injected `PriceBook` estimate (live OpenRouter `/models` prices);
3. the static `estimateCost` table;
4. `null`.

The server adds no pricing logic of its own. `PriceBook.estimate` is
synchronous and refreshes lazily in the background, so nothing on the review
path blocks on it.

### 3.2 `null` is a value, not a missing zero

An unknown model price yields `null`, and `null` must survive all the way to the
client. Storing `0` in its place is a bug: it claims a run was free.

Map-reduce runs null-poison on purpose — if any single chunk is unpriced, the
whole run's cost is `null` rather than a partial sum that would read as a total.
That behaviour lives in `reviewer-core` and this spec depends on it.

A model that genuinely costs nothing (a free OpenRouter tier) resolves to `0`,
which is a real measurement and is persisted as `0`.

### 3.3 Terminal paths

Every terminal path already has to persist a status **and** a `run_traces`
document; cost joins that invariant:

| Path | `cost_usd` |
|---|---|
| success | the resolved value (number or `null`) |
| failed | `null` |
| cancelled | `null` |
| reaped on boot (`reapStaleRunningRuns`) | left as-is (`null`, never set) |

Note the existing failure paths write `tokensIn: 0, tokensOut: 0`. Cost
deliberately **does not** follow that pattern — a failed run that stored `0`
would render as `$0` on every surface.

### 3.4 Per-PR roll-up

`GET /repos/:id/pulls` returns `cost_usd` per PR = `SUM(agent_runs.cost_usd)`
over that PR's runs, scoped by `workspaceId` like every other query on the route.

Postgres `SUM` ignores `NULL` rows and returns `NULL` when every row is null,
which is exactly the semantics wanted — so no status filter is needed. Failed
runs contribute nothing because their cost is null.

The roll-up is computed on read, alongside the existing latest-review score
lookup: one grouped aggregate for the whole page, not a query per row. It is
reached through `container.reviewRepo`, because a module never imports another
module's repository.

Ordering, idempotency, and partial-failure behaviour elsewhere on these routes
are unchanged.

## 4. Degradation

House rule: degrade visibly, never fail the caller.

| Condition | Behaviour |
|---|---|
| No LLM key configured | the run fails on its own terms; cost is `null` |
| Model absent from OpenRouter *and* the static price table | `null` |
| `PriceBook` cache cold, or `/models` unreachable | falls through to the static table; `null` if that also misses |
| OpenRouter omits `usage.cost` | falls through to the estimate chain |
| Run predates this change | `null` — no backfill |
| The roll-up aggregate throws | logged, `cost_usd: null` for the page; `GET /repos/:id/pulls` still succeeds |

Cost is never a reason for a review to fail, and never a reason for a list
endpoint to 500.

## 5. Acceptance

- [ ] A successful run against a priced model persists a non-null
      `agent_runs.cost_usd`.
- [ ] `GET /pulls/:id/runs` returns that value on `RunSummary`.
- [ ] `GET /runs/:id/trace` returns it on `RunTrace.stats`.
- [ ] A failed run and a cancelled run both persist `cost_usd = null`, not `0`.
- [ ] A run whose model is in neither price source persists `null`.
- [ ] A free-priced model persists `0`, distinguishable from `null`.
- [ ] `GET /repos/:id/pulls` returns, per PR, the sum of its runs' costs.
- [ ] A PR with no runs, or only unpriced runs, returns `cost_usd: null`.
- [ ] The roll-up is one query for the page, not one per PR, and is
      workspace-scoped.
- [ ] Running a review issues exactly the same number of outbound model calls as
      before this change.
- [ ] Both `vendor/shared` copies carry the contract change and both packages
      type-check.

Covered by `test/contracts.test.ts` (shape) and `test/reviews.it.test.ts`
(persistence, exposure, roll-up, failed-run null) — the DB-backed assertions need
the `.it.test.ts` suffix.
