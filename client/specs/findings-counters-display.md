# Spec — Findings severity counters (list column, run badges, breakdown card)

**Status:** DRAFT (2026-07-29)
**Owner:** client · **Producer:** server ([`server/specs/pr-findings-counters.md`](../../server/specs/pr-findings-counters.md))
**Plan:** [`docs/plans/pr-findings-counters-plan.md`](../../docs/plans/pr-findings-counters-plan.md)
**Related:** [`run-cost-display.md`](run-cost-display.md) (the precedent this follows)

Three surfaces gain per-severity findings counters, each opening the same
click-to-open breakdown card:

1. **PR list** — a Findings column showing compact per-severity badges.
2. **PR detail → Agent runs tab** — badges on settled run-timeline rows.
3. **PR detail → review-run accordions** — badges in each accordion header.

## 1. The journey

**PR list** (`/repos/:repoId/pulls`): a new Findings column sits between Score
and Status. A PR with non-dismissed findings shows one compact badge per
non-zero severity (icon + count, most severe first). Clicking the badges opens
the breakdown card below them; clicking anywhere else in the row still
navigates to the PR as today. The card lists up to 6 findings — severity icon,
title, category tag, `file:line` in mono, confidence %, rationale snippet
clamped to two lines — with a header stating the true total and a "+k more"
footer when the preview is capped. The full list lives on the PR detail page,
as today.

**PR detail** (`/repos/:repoId/pulls/:number?tab=findings`, the "Agent runs"
tab): each settled timeline row and each review-run accordion header shows the
same compact badges for **that run's** findings (no cross-run aggregation on
these surfaces), opening the same card with that run's full non-dismissed list.

## 2. States

| State | Behaviour |
|---|---|
| PR with no findings, roll-up failed, or never reviewed | empty cell — no "0", no placeholder. `null` from the server means "nothing to show" by design |
| Preview capped (more findings than the card shows) | card header uses the counts total; footer "+k more" |
| Timeline run whose review was deleted | no badges on that row (the flat findings text stays as today) |
| Finding dismissed | disappears from all counters on the next refetch (list) / immediately after mutation invalidation (detail) |
| Loading | the list's existing skeleton rows; no new loading state. The card itself never loads — its data is already on the page |
| Live run in progress | unchanged; badges appear only on settled runs |

## 3. Data

- **PR list**: embedded in `PrMeta` (`findings_by_severity`,
  `findings_preview`) via the existing `usePulls` hook — **no new hook, no new
  endpoint**. See the server spec for null semantics and the preview cap.
- **PR detail**: derived client-side from `usePrReviews`
  (`ReviewRecord.findings`), grouped per run through the existing
  review-to-run join in `FindingsTab` — explicitly no server call. Counting
  rule matches the server: non-dismissed only, no confidence filter.
- **Cache truth**: the finding accept/dismiss mutation and the review/run
  delete mutations additionally invalidate the `["pulls"]` query prefix, so
  list counters follow those actions. New findings from a completing run reach
  the list via its existing refetch interval and focus refetch.
- A failed pulls fetch behaves as today (the column is part of the same
  response); there is no findings-specific error state.

## 4. Interaction

- The badge cluster is a real button: focusable, Enter/Space toggles,
  `aria-haspopup="dialog"`, `aria-expanded` reflects state, with an accessible
  label.
- Click toggles the card. Outside click closes it (which also guarantees at
  most one card open at a time). Escape closes it and returns focus to the
  trigger; outside-click close leaves focus where the user clicked.
- Hovering the trigger gives the badges feedback: each is underlined in its own
  severity colour and the cluster brightens. The whole cluster reacts as one,
  because the whole cluster is one click target. Idle state reserves the
  underline's space, so nothing shifts on hover.
- Clicking the trigger or anywhere inside the card never activates the
  underlying surface — no row navigation on the list, no accordion toggle on
  the detail page.
- Severity is never conveyed by colour alone: badges and card rows always pair
  the severity icon with a count or label (the existing `SeverityBadge`
  convention).
- The card is never clipped by the surface it opens from. All three surfaces
  clip their own rounded corners (`overflow: hidden`), so the card is pinned in
  viewport coordinates rather than laid out inside the row: it hangs below the
  badges, flips above them when there isn't room below, is clamped to stay
  inside the viewport horizontally, and caps its height to the space on
  whichever side it took (scrolling internally beyond that). It stays attached
  to the badges while the surface underneath scrolls or the window resizes.
- Nothing is optimistic; all counter changes wait for the server via query
  invalidation.

## 5. Acceptance

- [ ] List row with findings shows one badge per non-zero severity, most
      severe first; a row with `null` counts shows an empty cell.
- [ ] Clicking the badges opens the card; row navigation does not fire from
      the trigger or the card; it still fires from the rest of the row.
- [ ] Card shows the counts total in its header, up to 6 rows (severity icon,
      title, category, `file:line`, confidence %, two-line snippet), and
      "+k more" when capped.
- [ ] Escape closes the card and focus returns to the trigger; outside click
      closes it; opening a second card closes the first.
- [ ] `aria-expanded` toggles on the trigger; the card is reachable and
      dismissible by keyboard alone.
- [ ] Timeline rows and accordion headers show that run's badges; a run
      without a surviving review shows none; accordion toggle is unaffected by
      clicks on the badges/card.
- [ ] Dismissing a finding on the detail page updates the accordion badges
      (via reviews invalidation) and the list counters (via pulls
      invalidation).
- [ ] Detail badges equal the number of non-dismissed findings in the
      accordion's list below them.

e2e: the existing list/detail flows (`02-repo-pulls-detail`, `04-pr-findings`)
may need touch-ups only if they pin the list's column count or header labels;
no new flow is required for this feature.
