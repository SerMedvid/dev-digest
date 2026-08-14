# Spec — PR brief on the Overview tab

**Status:** implemented (L05)

**Server half:** [`server/specs/brief.md`](../../server/specs/brief.md)

**Design:** [`docs/superpowers/specs/2026-08-14-pr-brief-design.md`](../../docs/superpowers/specs/2026-08-14-pr-brief-design.md)

## 1. The journey

Route: `/repos/:repoId/pulls/:number` (`?tab=overview`, the default).

A reviewer opens a pull request and, before the diff, reads three things in this
order:

1. **PR brief** — above everything: the verdict banner, the risk-level badge and
   one paragraph saying why the change exists and what it costs to get wrong.
2. **Risk areas** — inside the Intent card, below its scope lists: one row per
   risk, expandable to its explanation and the files or endpoints it names.
3. **Review focus** — below the Intent | Blast grid: the ordered "read these
   first" list. Clicking a row switches to the Files-changed tab and scrolls to
   that file.

The exit is the Files-changed tab, which is the point: the brief exists to make
the diff cheaper to read, not to replace it.

## 2. Components

| Component | Where | Responsibility |
|---|---|---|
| `PrBriefCard` | `OverviewTab/_components/` | Section label, `VerdictBanner`, `what`, the stale marker, the generate/regenerate control and its errors |
| `RiskAreas` | `IntentCard/_components/` | `brief.risks` rows: a severity icon, the title, and the refs **visible while collapsed**; the chevron expands only the explanation. Presentational — calls no hook |
| `ReviewFocus` | `OverviewTab/_components/` | The ordered focus list and the jump to the diff |

`PrBriefCard` **wraps** the existing `VerdictBanner` rather than adding a second
banner: the verdict and the risk level answer the same question at different
resolutions, and two boxes saying it would read as a disagreement. The banner's
paragraph is `brief.why` when a brief exists.

`VerdictBanner` gains three **optional** props (`riskLevel`, `onRegenerate`,
`regenerating`). Every existing call site — the run accordion — passes none of
them and renders identically.

`OverviewTab` owns the one `usePrBrief` call and passes the data down. The brief
appears in three places; a hook call in each would be three renders of one
answer.

## 3. States

| State | Rendering |
|---|---|
| Loading | Section label plus a skeleton at the banner's own height, so the page does not blank-then-shift |
| No brief (hook returns `null`) | `brief.unavailable` + `brief.unavailableHint` and a **Generate brief** button. Not an error banner — the API 404s for "not generated at this state", which is an empty state |
| Brief present | Banner with the risk badge and the regenerate control; `what` below it |
| Stale (`stale: true`) | Everything above, plus an explicit marker saying a newer review has run. The brief is still served — one review out of date beats an empty card |
| Generating | The control is disabled and reads `brief.regenerating`; the existing brief stays on screen |
| Generation failed | The server's own message, inline and `role="alert"`, directly under the control that produced it |
| Generation conflicted (`409`) | `brief.conflict` as a **`role="status"`, not an alert**, and the control stays in its busy state. A 409 means a generation is already in flight — a state, not a failure. Styling it as an error put a red "you can't" beside the stale marker's "you should", with nothing on screen that resolved the contradiction. The hook refetches on 409 so the winning generation's result lands, and the message is cleared once a newer `created_at` arrives, so it cannot outlive the condition |
| No risks survived the gate | `RiskAreas` renders **nothing at all**. An empty block under a heading reads as a feature that failed |
| No review focus | `ReviewFocus` renders nothing |
| A focus file absent from the diff | The row renders unlinked rather than as a control that scrolls nowhere |

## 4. Data

| Hook | Endpoint | Failure |
|---|---|---|
| `usePrBrief` | `GET /pulls/:id/brief` | **404 → `null`**, the empty state above. Anything else propagates to the query's error state |
| `useGenerateBrief` | `POST /pulls/:id/brief` | Inline message on the card, never a toast — the control that failed is on screen, and a toast would land away from it |
| `usePrReviews` | `GET /pulls/:id/reviews` | Already used by the page; the newest review supplies the banner's verdict, score and counters |
| `usePrRuns` | `GET /pulls/:id/runs` | Spend for the banner's cost badge. It lives on the **run**, not on `ReviewRecord`, so the run is resolved by `review.run_id` — the same lookup `ReviewRunAccordion` does. Absent renders "—" rather than breaking |

`useGenerateBrief` writes the returned record straight into the cache with
`setQueryData`. The POST already returns the fresh record, so a follow-up
invalidation would spend a request to learn what is already held.

Nothing calls the POST on mount. It always regenerates, and mounting the card
would then spend a model call on every page open.

## 5. Interaction

- Every user-facing string comes from `messages/en/brief.json`. Nothing is
  hardcoded in JSX.
- The risk row's **whole header** is the toggle, carrying `aria-expanded`, so
  the hit target is the row rather than a 12px chevron.
- Colour is never the only carrier. The banner's risk level is spelled out in
  text; a risk row has no visible severity text (the mockup draws none), so it
  is carried by an icon whose **shape** differs per level and announced on the
  toggle's accessible name.
- A risk's `refs` stay visible while the row is collapsed. They are its
  evidence, and every one has passed the server's grounding gate — hiding them
  made the risk a claim the reader could not check without a click.
- Spend sits **under the score**, not among the badges (`spendPlacement="score"`).
  The prop is explicit rather than inferred from the brief-only props, so the
  run accordion's layout cannot change by accident.
- A focus row's label shows `file:line` only when `line !== null`. A null line is
  not missing data: it means no finding vouched for a line there, and printing
  `:0` or guessing one would undo the server's grounding gate on the client.
- The focus list is rendered **in the order it arrived** and numbered, never
  re-sorted. The order is the content.
- Jumping to a file sets `?tab=diff` and then scrolls on the next frame — the
  diff is not mounted until the tab changes, so a same-frame lookup would miss
  and the click would silently do nothing. The anchor is `fileAnchorId(path)` on
  `FileCard`, which both the flat and the Smart Diff viewers compose.

## 6. Acceptance

- [ ] The card renders `why` in the banner and the risk badge at the PR's level.
- [ ] With no brief, the empty state and its Generate button render; the hook
      returned `null` and no error banner appears.
- [ ] `stale: true` renders the stale marker **and** the brief.
- [ ] Clicking regenerate calls the mutation and shows the in-flight label.
- [ ] A 409 renders the conflict message as a `status`, never an `alert`, keeps
      the control busy, and clears once a newer brief arrives.
- [ ] The banner shows the review run's cost and tokens, and renders without a
      run rather than breaking.
- [ ] `RiskAreas` renders one row per risk with its refs **visible collapsed**;
      the chevron expands only the explanation; an empty array renders nothing;
      a risk with no refs renders no empty evidence row.
- [ ] Each risk row's accessible name carries its severity level.
- [ ] `ReviewFocus` shows `:line` only when `line !== null`.
- [ ] A focus click calls the tab setter with `"diff"`.
- [ ] A focus file not in the diff renders unlinked.
- [ ] Existing `VerdictBanner` call sites still render with none of the new props.

The journey deserves an e2e flow: [`e2e/specs/11-pr-brief.flow.json`](../../e2e/specs/11-pr-brief.flow.json)
runs it against the seeded PR #482 with no model key, reading the seeded
`pr_brief` row.
