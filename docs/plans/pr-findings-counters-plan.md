# Plan — Findings severity counters

**Date:** 2026-07-29 · **Status:** ready to implement
**Specs (authoritative for behaviour):**
[`server/specs/pr-findings-counters.md`](../../server/specs/pr-findings-counters.md) ·
[`client/specs/findings-counters-display.md`](../../client/specs/findings-counters-display.md)
**Precedent:** commit `67f8b22` (per-run LLM cost) shipped the same shape of
feature across the same surfaces — mirror its structure throughout.

Per-severity findings counters (CRITICAL / WARNING / SUGGESTION) on the PR
list, the run timeline, and the review accordions, each opening a click-to-open
breakdown card. Decisions already made (do not re-litigate): non-dismissed
findings only; list endpoint embeds counts + a top-6 preview (no lazy
endpoint); aggregation spans all reviews of the PR (**dedup deferred** — see
the server spec's Out-of-scope); card opens on click, not hover.

Read before starting: root `CLAUDE.md` (esp. "two physical copies" of
`@devdigest/shared`), `server/CLAUDE.md` (layering), `client/CLAUDE.md`
(component folder convention), both `INSIGHTS.md` files. Package managers
differ: `server/` and `client/` use **pnpm**; do not create
`package-lock.json` there.

---

## Phase 1 — server

### 1.1 Contracts (both copies)

Edit `server/src/vendor/shared/contracts/platform.ts` **and apply the
byte-identical edit** to `client/src/vendor/shared/contracts/platform.ts`
(they are identical today; keep them so — diff after editing).

Next to `PrMeta` (~line 157), importing `Severity` from `./findings.js`:

```ts
export const PrFindingsBySeverity = z.object({
  CRITICAL: z.number().int(),
  WARNING: z.number().int(),
  SUGGESTION: z.number().int(),
});
export type PrFindingsBySeverity = z.infer<typeof PrFindingsBySeverity>;

export const PrFindingPreview = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  confidence: z.number(),
  rationale_snippet: z.string(),
});
export type PrFindingPreview = z.infer<typeof PrFindingPreview>;
```

Extend `PrMeta`, following the `score` / `cost_usd` "list endpoint only"
comments:

```ts
findings_by_severity: PrFindingsBySeverity.nullish(),
findings_preview: z.array(PrFindingPreview).nullish(),
```

Do **not** reuse `AgentColumnFinding` (`contracts/observability.ts`) — it
lacks `end_line`/`confidence`/snippet and belongs to the multi-agent lesson.
Do **not** touch `contracts/trace.ts` (known drift between copies; no
`RunSummary` change is needed — see Phase 2.3).

### 1.2 Indexes

In `server/src/db/schema/reviews.ts` add table extras:

- `reviews`: `index('reviews_pr_id_idx').on(prId)`
- `findings`: `index('findings_review_id_idx').on(reviewId)`

Then `cd server && pnpm db:generate` (produces migration `0011_*`), commit the
generated SQL + meta, and `pnpm db:migrate` locally. Never hand-edit an applied
migration.

### 1.3 Repository aggregate

New function in `server/src/modules/reviews/repository/review.repo.ts`
(findings belong to the review aggregate; `run.repo.ts` is agent_runs):

```ts
const PREVIEW_LIMIT = 6;
const RATIONALE_SNIPPET_LEN = 280;

export interface PrFindingsSummary {
  counts: { CRITICAL: number; WARNING: number; SUGGESTION: number };
  preview: PrFindingPreview[];
}

export async function findingsSummaryByPr(
  db, workspaceId: string, prIds: string[],
): Promise<Map<string, PrFindingsSummary>>
```

One flat query — counts and preview from the same rows:

- `select` finding columns + `sql<string>` snippet
  `left(${t.findings.rationale}, 280)`;
- `innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))`;
- `where(and(eq(t.reviews.workspaceId, workspaceId),
  inArray(t.reviews.prId, prIds), isNull(t.findings.dismissedAt)))` —
  workspace scoping is load-bearing;
- `orderBy(t.reviews.prId, <CASE severity rank: CRITICAL 0 / WARNING 1 /
  SUGGESTION 2 / else 3>, desc(t.findings.confidence))`.

JS loop over the pre-ordered rows: skip rows whose severity is not in
`Severity.options` (column is plain text — fold from counts AND preview);
accumulate counts; push to `preview` while `length < PREVIEW_LIMIT`. Return
early with an empty Map when `prIds` is empty. No window function — the
ordering makes "first 6 per PR" correct.

Facade: add a delegating `findingsSummaryByPr(workspaceId, prIds)` to
`server/src/modules/reviews/repository.ts` next to `sumRunCostByPr` (~line
175). Cross-module access is `container.reviewRepo` only.

### 1.4 Route wiring — `server/src/modules/pulls/routes.ts`

- **Rewrite the comment at lines 114–117**: keep the score explanation, delete
  the parenthetical claiming the per-severity breakdown is "intentionally not
  surfaced on the list" (this feature reverses that decision).
- After the cost block (~line 145), mirror its degradation exactly:

```ts
let findingsByPr = new Map<string, PrFindingsSummary>();
if (prIds.length > 0) {
  try {
    findingsByPr = await container.reviewRepo.findingsSummaryByPr(workspaceId, prIds);
  } catch (err) {
    app.log.warn({ err }, 'PR findings roll-up failed; serving list without findings counters');
  }
}
```

- In the `rows.map` return object (~line 171):

```ts
findings_by_severity: findingsByPr.get(r.id)?.counts ?? null,
findings_preview: findingsByPr.get(r.id)?.preview ?? null,
```

`null` for zero findings — never zeros or `[]` (see spec §4).

### 1.5 Server tests

- Extend `server/test/reviews.it.test.ts` (DB-backed; `.it.test.ts` suffix is
  mandatory for the unit lane's exclude glob). Assert every item in the server
  spec's Acceptance list: counts, dismiss/un-dismiss, null-for-none, preview
  cap + ordering + snippet length, unknown-severity fold, multi-review
  aggregation, workspace scoping.
- `server/test/contracts.test.ts`: `PrMeta` parses with the new fields
  present, null, and absent; `PrFindingPreview` shape.
- Run: `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'`;
  with Docker up, the full `pnpm test`.

## Phase 2 — client

### 2.1 Shared component `client/src/components/findings-breakdown/`

Folder per convention (mirror `client/src/components/run-cost-badge/`):
`FindingsBreakdown.tsx`, `FindingsBreakdown.test.tsx`, `helpers.ts`,
`constants.ts`, `styles.ts`, `index.ts`. Two exports:

**`SeverityCounters`** — presentational. For each severity with count > 0, in
CRITICAL → WARNING → SUGGESTION order, render
`<SeverityBadge severity={sev} count={n} compact />` (from `@devdigest/ui`
`primitives/Badge.tsx` — it already supports `count`; icon + count per its
WCAG note). Returns `null` when all zero.

**`FindingsBreakdown`** — click trigger + card. Props:

```ts
{
  counts: PrFindingsBySeverity;
  findings: BreakdownFinding[];
  align?: "left" | "right";   // which edge of the trigger the card aligns to
  totalOverride?: number;     // header count when `findings` is a capped preview
}
```

Behaviour (compose the open/close mechanics of `vendor/ui/kit/Dropdown.tsx`
(~lines 73–99) — **compose, don't fork**; `vendor/ui` is treated as
third-party):

- Trigger: native `<button type="button" aria-haspopup="dialog"
  aria-expanded={open} aria-label={t("findings.openBreakdown")}>` wrapping
  `SeverityCounters` — Enter/Space work for free.
- Root wrapper `onClick={(e) => e.stopPropagation()}` — covers trigger, card,
  and keyboard-synthesized clicks, so PRRow navigation and the accordion
  toggle never fire.
- Outside-click close: `document.addEventListener("mousedown", …)` with a
  `ref.contains(e.target)` guard, like Dropdown. This also yields
  one-card-open-at-a-time for free.
- Escape closes and returns focus to the trigger (`triggerRef.current?.focus()`).
- Positioning: relative wrapper + absolutely positioned card
  (`top: calc(100% + 6px)`, `[align]: 0`, width ≈ 380, `maxHeight: 340`,
  `overflowY: "auto"`, elevated background/border/shadow tokens). Same
  approach as the vendored Dropdown; no scroll/resize listeners.
- Card content: header `"{total} FINDINGS"` (`totalOverride ??
  findings.length`); one row per finding — severity icon + colour from the
  `SEV` map in `vendor/ui/primitives/tokens.ts` (the single source; do not add
  a fourth ad-hoc severity map), title (600 weight, ellipsis),
  `<CategoryTag />` (unknown category renders nothing), mono `file:lineLabel`
  plain text (no navigation target on the list), `<ConfidenceNum />`,
  rationale snippet clamped to 2 lines (`WebkitLineClamp`). Footer
  `"+{k} more"` when `totalOverride > findings.length`.
- `styles.ts` consts only — no inline literals in the `.tsx`. Strings in a new
  `findings` block of `client/messages/en/prReview.json` (`header`, `more`,
  `openBreakdown`) — both consuming pages already use the `prReview`
  namespace.

`helpers.ts`:

```ts
export interface BreakdownFinding { id; severity; category; title; file;
  start_line; end_line; confidence; snippet }
export function lineLabel(f): string              // "11" | "11-15" — small local dup of FindingCard's helper; don't import across routes
export function fromPreview(p: PrFindingPreview): BreakdownFinding
export function fromRecords(fs: FindingRecord[]): { counts: PrFindingsBySeverity; items: BreakdownFinding[] }
// fromRecords: filter !dismissed_at, sort severity-rank then confidence desc; snippet = rationale (visual clamp only)
```

Do **not** scope-creep into consolidating the three existing ad-hoc severity
maps (`FindingCard/constants.ts`, trace-drawer `FindingsSection.tsx`,
`FindingsPanel/constants.ts`) — optional follow-up, not this change.

### 2.2 PR list wiring

- `client/src/app/repos/[repoId]/pulls/constants.ts`: insert `"findings"` into
  `COLUMN_KEYS` after `"score"`, and a matching `110px` track into `GRID` →
  `"1fr 132px 92px 60px 110px 118px 72px 78px"`. The file's comment is
  load-bearing: track count MUST equal `COLUMN_KEYS.length` (8 = 8). Keep the
  `PrMeta` re-export at the top of the file.
- `client/messages/en/prReview.json`: `list.columns.findings: "Findings"` +
  the `findings.*` card strings.
- `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx`: new cell
  after the score cell — render `<FindingsBreakdown counts={…}
  findings={(pr.findings_preview ?? []).map(fromPreview)}
  totalOverride={total} />` only when `pr.findings_by_severity` is present and
  its total > 0; otherwise an empty cell. Add `findingsCell` to
  `pulls/styles.ts`.
- `client/src/lib/types.ts`: delete the dead `PrRowView` interface (lines
  38–48) — its findings shape now lives on the real contract. Grep for
  importers first; **keep the `PrMeta` re-export** (pulls/constants.ts imports
  it from here).

### 2.3 PR detail wiring (`…/pulls/[number]/_components/`)

No server change for these surfaces — full findings already arrive via
`usePrReviews`, and client derivation stays live-correct after a dismiss.

- `FindingsTab/FindingsTab.tsx`: next to the existing `runById` memo, build
  `findingsByRun: Map<runId, FindingRecord[]>` from the reviews (filter
  `!dismissed_at`, keyed by `review.run_id` when present); pass to
  `<RunHistory findingsByRun={…} />`.
- `RunHistory/RunHistory.tsx`: new optional prop
  `findingsByRun?: Map<string, FindingRecord[]>`. On settled rows, beside the
  existing findings text (~lines 192–197), render
  `<FindingsBreakdown {...fromRecords(list)} align="right" />` when the list
  is non-empty. Missing entry (review deleted) → render nothing extra.
- `ReviewRunAccordion/ReviewRunAccordion.tsx`: in the header, after the
  "{n} findings · {b} blockers" span (keep it — it carries the blockers
  wording), render `<FindingsBreakdown {...fromRecords(review.findings)} />`.
  The component's internal stopPropagation protects the header toggle.

### 2.4 Cache invalidation — `client/src/lib/hooks/reviews.ts`

Mutations know `prId` but not `repoId`, so use the `["pulls"]` **array
prefix** (TanStack partial matching reaches every `["pulls", repoId]`; broader
than one repo but correct and cheap). Add
`qc.invalidateQueries({ queryKey: ["pulls"] })` to the `onSuccess` of
`useFindingAction`, `useDeleteReview`, and `useDeleteRun`. `useRunReview`
unchanged — the list's existing refetch interval + focus refetch cover async
run completion.

### 2.5 Client tests

- `FindingsBreakdown.test.tsx` (RTL + userEvent): non-zero-only badges with
  counts; `aria-expanded` toggles on click; card header + row content; Escape
  closes and focus returns to trigger; outside mousedown closes; a wrapping
  `onClick` spy (simulating row navigation) is NOT called from trigger or
  card.
- Extend the RunHistory test: badges when `findingsByRun` has an entry, none
  otherwise. PRRow-level: empty cell without counts; row navigation still
  fires from elsewhere.
- `cd client && pnpm typecheck && pnpm test`.

## Phase 3 — wrap-up

- `diff server/src/vendor/shared/contracts/platform.ts
  client/src/vendor/shared/contracts/platform.ts` → identical.
- Skim `e2e/specs/02-repo-pulls-detail.flow.json` and
  `04-pr-findings.flow.json`; adjust only if they pin the list's column count
  or header labels.
- Manual pass (see client spec Acceptance): column renders, card
  opens/closes correctly, row navigation isolated, dismiss updates both
  surfaces.
- Conventional commit, e.g. `feat(reviews): per-severity findings counters on
  the PR list and run surfaces`, on a branch off `main`.

## Risks / edge cases

| Risk | Handling |
|---|---|
| Card clipping — `s.tableCard` in `pulls/styles.ts` has `overflow: hidden`; a card on the last visible row of a short list may clip | Accepted initially (matches the vendored Dropdown's behaviour). One-line fallback if it bites: drop `overflow: hidden` from `s.tableCard` (its clip only rounds row hover backgrounds) |
| Unknown severity strings in the DB (plain text column) | Folded in the repository's JS grouping — never a client zod failure, never a miscount |
| Aggregate failure on the list | try/catch → both fields `null`, route 200s (house rule; cost precedent) |
| Vendor-copy contract drift | Only `platform.ts` is edited; diff post-edit + typecheck both packages |
| `["pulls"]` prefix invalidation is broader than one repo | Accepted — endpoint is cheap and already polled |
| Double-counting across re-reviews of the same agent | Deferred by decision — see the server spec's Out-of-scope (future shape: latest review per agent) |
