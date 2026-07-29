# Spec — PR findings severity counters (list roll-up + preview)

**Status:** DRAFT (2026-07-29)
**Owner:** server · **Consumer:** client ([`client/specs/findings-counters-display.md`](../../client/specs/findings-counters-display.md))
**Plan:** [`docs/plans/pr-findings-counters-plan.md`](../../docs/plans/pr-findings-counters-plan.md)
**Related:** [`run-cost.md`](run-cost.md) (the precedent this follows), `contracts/findings.ts` `Severity`

Findings are persisted with a severity (`CRITICAL` / `WARNING` / `SUGGESTION`),
but the only aggregate any endpoint exposes is the flat
`agent_runs.findings_count`. The PR list therefore cannot show *what kind* of
findings a PR has. This spec adds a per-severity roll-up and a slim findings
preview to the pulls list endpoint, so the client can render a Findings column
with a click-to-open breakdown card — without a new endpoint and without a
single extra model call.

This reverses a previously documented decision: the comment in
[`modules/pulls/routes.ts`](../src/modules/pulls/routes.ts) (currently lines
114–117) says the per-severity breakdown is "intentionally not surfaced on the
list". That comment must be rewritten when this ships.

## 1. Scope

**In scope**

- Two new nullish fields on `PrMeta`, populated only by `GET /repos/:id/pulls`:
  per-severity counts and a capped findings preview.
- One new repository aggregate on the reviews domain, reached via
  `container.reviewRepo`.
- Two new indexes: `findings.review_id`, `reviews.pr_id` (the join now runs on
  every list render; neither index exists today).

**Out of scope**

- **Deduplication across review runs** — deferred by decision (2026-07-29).
  Findings have no stable identity across runs (a re-review inserts new rows;
  lines shift, titles vary), so content-heuristic dedup is unreliable. The
  likely future shape is *latest review per agent*; until then, counts span all
  reviews and re-runs of the same agent can double-count near-identical
  findings until superseded ones are dismissed. This is accepted, not an
  oversight.
- Any change to `RunSummary` or `contracts/trace.ts`. The per-run breakdown on
  the PR detail page is derived client-side from `GET /pulls/:id/reviews`,
  which already returns full findings. (`trace.ts` is also on the known
  vendor-copy drift list — one more reason not to touch it.)
- A lazy `GET /pulls/:id/findings` endpoint. The preview is embedded in the
  list response by decision.
- Low-confidence filtering. The client's `FindingsPanel` hides findings below a
  confidence threshold; the counters deliberately do **not** — they count every
  non-dismissed finding.
- The orphaned `findings_by_severity` inside `AgentStats`
  (`contracts/observability.ts`). Same shape, different owner; it stays
  unimplemented until its lesson lands.
- Denormalized counters on `pull_requests`, and any backfill.

## 2. Contract

The Zod definitions in `src/vendor/shared/contracts/` are the source of truth.
Two new types and two new fields, all in `contracts/platform.ts` next to
`PrMeta`:

| Contract | Change |
|---|---|
| `PrFindingsBySeverity` (new) | `{ CRITICAL, WARNING, SUGGESTION }`, all non-negative ints |
| `PrFindingPreview` (new) | `id`, `severity` (`Severity` enum), `category` (string — see §3.4), `title`, `file`, `start_line`, `end_line`, `confidence` (0–1), `rationale_snippet` |
| `PrMeta` | gains `findings_by_severity: PrFindingsBySeverity.nullish()` and `findings_preview: z.array(PrFindingPreview).nullish()` — list-endpoint-only fields, following the existing `score` / `cost_usd` pattern |

`@devdigest/shared` is **two physical copies**. Every edit lands in both
`server/src/vendor/shared/contracts/platform.ts` and
`client/src/vendor/shared/contracts/platform.ts`, and both packages get
type-checked. The two `platform.ts` copies are byte-identical today — diff
after editing to keep them so.

No route gains or changes a status code, and no new error case is introduced.
`GET /repos/:id/pulls` declares no `schema.response`, so nothing strips the new
fields on the way out. `PrDetail` extends `PrMeta`; because the fields are
nullish, the detail endpoint stays valid without populating them.

No schema change to `findings` or `reviews` columns — indexes only.

## 3. Behaviour

### 3.1 One query per page

The roll-up is computed on read by a single aggregate for the whole page —
never a query per row. It lives in the reviews repository
(`findingsSummaryByPr(workspaceId, prIds)`) and is reached through
`container.reviewRepo`, because a module never imports another module's
repository.

Shape: `findings` inner-joined to `reviews` on `review_id`, filtered by
`reviews.workspace_id = ?` (workspace scoping is load-bearing),
`reviews.pr_id IN (…)`, and `findings.dismissed_at IS NULL`; ordered by
`pr_id`, then severity rank (`CASE` expression: CRITICAL 0, WARNING 1,
SUGGESTION 2, else 3), then `confidence DESC`. Counts and preview come from the
same rows in one pass of JS grouping.

### 3.2 What is counted

- **Non-dismissed only**: `dismissed_at IS NULL`. Accepted findings still
  count; dismissing removes a finding from the counters on the next fetch,
  un-dismissing restores it. Computed on read — no denormalized state to go
  stale.
- **All reviews of the PR**, both `kind` values (findings only attach to
  review-path rows in practice; a stray one would still be a real finding).
  See the dedup deferral in §1.
- No confidence filter.

### 3.3 The preview

- Capped at `PREVIEW_LIMIT = 6` findings per PR — the first 6 rows in the
  query's order, i.e. most severe first, highest confidence first within a
  severity. Because the rows arrive pre-ordered, the cap is a plain JS
  truncation; no window function.
- `rationale_snippet` is truncated **in SQL** (`left(rationale, 280)`,
  `RATIONALE_SNIPPET_LEN = 280`) so full rationales never leave the database
  on this route. The client clamps it further visually.
- The counts are authoritative for totals; the preview is a capped sample. The
  client derives "+k more" from `sum(counts) - preview.length`.

### 3.4 Unknown values fold away

`findings.severity` and `findings.category` are plain `text` columns — the
enum exists only at the contract layer. A row whose severity is not one of the
three `Severity` values is excluded from **both** the counts and the preview
(never a zod failure on the client, never a miscount). Category passes through
as a string; the client renders nothing for an unknown category.

## 4. Degradation

House rule: degrade visibly, never fail the caller.

| Condition | Behaviour |
|---|---|
| Roll-up aggregate throws | logged warn; `findings_by_severity: null`, `findings_preview: null` for every PR on the page; `GET /repos/:id/pulls` still 200s |
| PR has zero non-dismissed findings | both fields `null` — **never zeros / empty array**. An empty cell and a failed roll-up are indistinguishable by design |
| Severity value outside the enum | excluded from counts and preview (§3.4) |
| PR never reviewed | both fields `null`, same as zero findings |

Findings counters are never a reason for the list endpoint to 500.

## 5. Acceptance

- [ ] `GET /repos/:id/pulls` returns correct per-severity counts for a PR with
      findings of mixed severities.
- [ ] A dismissed finding is excluded; un-dismissing restores it to the counts.
- [ ] A PR with no non-dismissed findings returns `null` for both fields — not
      zeros, not `[]`.
- [ ] The preview is capped at 6, ordered CRITICAL → WARNING → SUGGESTION, then
      confidence descending within a severity.
- [ ] `rationale_snippet` is at most 280 characters even when the stored
      rationale is longer.
- [ ] A raw-inserted finding with an unknown severity string appears in neither
      the counts nor the preview.
- [ ] Counts aggregate across two reviews of the same PR.
- [ ] The roll-up is one query for the page, not one per PR, and is
      workspace-scoped (another workspace's findings never leak in).
- [ ] A thrown aggregate degrades to `null` fields and the route still 200s.
- [ ] Both `vendor/shared` copies carry the contract change and both packages
      type-check.

Covered by `test/contracts.test.ts` (shape) and `test/reviews.it.test.ts`
(roll-up, exclusion, cap, ordering, scoping) — the DB-backed assertions need
the `.it.test.ts` suffix.
