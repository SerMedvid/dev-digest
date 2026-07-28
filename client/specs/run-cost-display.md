# Spec — Run cost display

**Status:** DRAFT (2026-07-28)
**Owner:** client · **Depends on:** [`server/specs/run-cost.md`](../../server/specs/run-cost.md)
**Related:** `RunCostBadge` (new, shared), `PRRow`, `RunHistory`, `RunTraceDrawer`, `ReviewRunAccordion`, `VerdictBanner`

Surface what a review run cost, on the screens where a user is already deciding
whether a run was worth re-running. Four surfaces, one shared badge, no new
endpoint and no new hook.

## 1. The journey

A user who has just run a review wants two answers: *what did this run cost*, and
*what has this PR cost me so far*.

| Entry | Route | Surface |
|---|---|---|
| Repo → Pull requests | `/repos/:repoId/pulls` | a `COST` column in the list, per PR |
| Open a PR → **Agent runs** tab | `/repos/:repoId/pulls/:number` | cost + tokens on each run row in the timeline |
| Same tab → **Review runs** section | same route | cost on each review-run header, and inside the expanded verdict banner |
| Click the trace icon on a run | same route, `?trace=<runId>` | a `COST` tile in the drawer's Stats row |

Exit is wherever they came from — nothing here navigates, mutates, or blocks.

## 2. States

Applies to every surface, driven entirely by the value's type.

| State | Renders |
|---|---|
| a positive number | the formatted amount, e.g. `$0.0013` |
| exactly `0` (a free-tier model) | `$0` |
| `null` / `undefined` — unknown model price, failed run, or a run predating the feature | `—` |
| the run is still `running` | `—`, replaced when the existing poll/SSE completes the run |
| tokens known but cost `null` (detailed variant) | tokens still render; the cost part is `—` |
| the underlying query is loading or errored | the surrounding component's existing skeleton / error state; no cost-specific UI |

**`—` must never render as `$0.00`.** A missing price and a free run are
different facts and must look different. This is the rule most likely to be
broken by a careless formatter, and it is the first thing to test.

### Formatting

The cost formatter deleted by `d45ab0d` was a two-decimal `toFixed`, which
collapses every real run to `$0.00`. It must not be reused. Precision scales
with magnitude, trailing zeros trimmed:

| Magnitude | Decimals | Example |
|---|---|---|
| `>= 1` | 2 | `$1.23` |
| `>= 0.01` | 3 | `$0.014`, `$0.06` |
| `< 0.01` | 4 | `$0.0013`, `$0.001` |

Token counts render two ways: a **total** (`9,119 tok`) on the timeline, and an
**in→out flow** (`8.2K→1.3K`) in the verdict banner, reusing the flow formatter
the trace drawer already has.

## 3. Data

No new endpoint, no new hook, no additional request on any screen. Every surface
reads a field added to a payload the page already fetches — see
[`server/specs/run-cost.md`](../../server/specs/run-cost.md) §2 for the contracts.

| Surface | Hook | Source |
|---|---|---|
| PR list column | `usePulls` | `PrMeta` |
| Timeline row | `usePrRuns` | `RunSummary` |
| Trace drawer tile | `useRunTrace` | `RunTrace.stats` |
| Review-run header + verdict banner | `usePrRuns` | `RunSummary`, joined client-side |

The review-run surfaces need a join: they are driven by `ReviewRecord`, which
carries no cost but does carry `run_id`. The PR detail page already fetches both
reviews and runs, so the match happens there — `ReviewRecord` is **not** widened
to carry cost, because the run row is already the authority on it.

Failure handling is inherited. A failed `usePulls` / `usePrRuns` / `useRunTrace`
already produces the surrounding component's error state; cost adds no new
`ApiError` branch and never gets its own toast.

## 4. Interaction

Cost is read-only on every surface: no keyboard affordance, no focus target, no
click target, nothing disabled, nothing optimistic.

The PR list gains a column, so the header and the rows must stay aligned — they
share one grid definition, and its track count has to match the column-key list.
A mismatch here shifts every cell in the table and is the known failure mode of
adding a column to this screen.

The timeline value appears when a run reaches a terminal state; until then the
existing 4s poll and SSE stream govern the row, and cost follows whatever they
report. Nothing new polls.

All labels — the column header, the drawer's `COST` tile label, any accessible
name on the badge — come from the message catalogue, not from JSX.

## 5. Acceptance

- [ ] Every completed run shows a cost on the timeline and on its review-run header.
- [ ] A run with no cost data shows `—`; it never shows `$0.00`.
- [ ] A free-model run shows `$0` and is visually distinct from `—`.
- [ ] A still-running run shows `—`, and updates once the run completes without a reload.
- [ ] The PR-list `COST` value equals the sum of that PR's run costs.
- [ ] A PR with no completed runs shows `—`.
- [ ] The trace drawer's Stats row shows four tiles: duration, tokens, cost, findings.
- [ ] Adding the column leaves header and row cells aligned.
- [ ] The detailed badge still shows tokens when cost is `null`.
- [ ] No screen issues an additional network request because of this feature.
- [ ] No user-facing string is hardcoded in a component.

Component tests cover the badge's own state table (`null`, `0`, sub-cent,
multi-cent, both variants) plus the updated fixtures in the timeline and trace
drawer tests.

**No e2e flow.** `pnpm db:seed` creates no `agent_runs`, so a deterministic
browser run has nothing priced to assert against. Revisit if the seed ever grows
completed runs.
