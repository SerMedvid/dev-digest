# Spec — Blast radius card: what this PR's changes reach

**Status:** DONE (2026-08-10)
**Owner:** client · **Producer:** server (`GET /pulls/:id/blast`)
**Design:** [`docs/superpowers/specs/2026-08-10-blast-radius-ui-parity-design.md`](../../docs/superpowers/specs/2026-08-10-blast-radius-ui-parity-design.md)
**Plan:** [`docs/superpowers/plans/2026-08-10-blast-radius-ui-parity.md`](../../docs/superpowers/plans/2026-08-10-blast-radius-ui-parity.md)
**Contract:** [`contracts/blast.ts`](../src/vendor/shared/contracts/blast.ts) —
shapes are referenced, never restated here
**Related:** [`finding-deep-links.md`](finding-deep-links.md) (every `file:line`
on this card obeys the same link rule)

`BlastCard` sits on the PR detail page's Overview tab, beside `IntentCard`. It
answers one question from the code index alone, with no model call on render:
**which symbols did this PR change, who calls them, and what endpoints and jobs
sit downstream of those callers.**

## 1. The journey

Entry point: `/repos/:repoId/pulls/:number` → Overview tab (the default).
`OverviewTab` renders Intent and Blast as a two-column grid that collapses to one
column on a narrow viewport, with the PR description full-width below both
([`OverviewTab.tsx`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/OverviewTab.tsx)).
The collapse is `auto-fit` + `minmax`, not a media query — the inline
`CSSProperties` tier this page uses cannot express one.

The card reads top to bottom:

1. A section label carrying the `Workflow` icon, with **Explain** in its right
   slot — the card's one action, and its one paid call.
2. The cached summary, under a `What this touches` label, once one exists at
   this head. At that point the Explain button in the header is gone. It leads
   the card rather than trailing it: a reviewer who reads one thing here should
   read the prose answer, and it sits directly under the button that produced
   it, with the counters and tree backing it up underneath.
3. A **counter row** — symbols, callers, endpoints, cron/jobs, each with an icon,
   and a `Graph` button pushed to the far edge
   ([`CounterRow.tsx`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/BlastCard/_components/CounterRow/CounterRow.tsx)).
4. One **collapsible row per changed symbol**, each opening to its declaration
   site, its callers, and its own endpoint and cron chips
   ([`SymbolRow.tsx`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/BlastCard/_components/SymbolRow/SymbolRow.tsx)).
5. **Prior PRs touching these files** — a titled list of the merged and closed
   PRs that have already been in these paths, each linking out to GitHub
   ([`PriorPrs.tsx`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/BlastCard/_components/PriorPrs/PriorPrs.tsx)).
   It answers the question a reviewer asks right after the map: *who else has
   been in here, and what did they do?*

The `Graph` button opens the same data as a layered column diagram in a modal
over the card. It is an action, not a view switch: the card behind it keeps
rendering the tree, so there is no view state and no URL parameter — which
surface you are looking at is presentation, not a shareable location.

## 2. States

The `status` enum does the work; only the chrome around it changed. The
distinction the card exists to preserve is **"nothing is there"** (`ok` with
empty arrays) versus **"we could not see"** (`partial` / `degraded`).

| State | Behaviour |
|---|---|
| Loading | Section label plus two skeleton bars at the card's footprint, so the page does not shift when data lands ([`BlastCard.tsx:45`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/BlastCard/BlastCard.tsx)) |
| Load error | The server's `ApiError.message`, or a fallback, plus **Retry** — which re-runs the GET. **No Explain is offered**: answering a failed read with a paid model call is not something the user asked for ([`BlastCard.tsx:56`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/BlastCard/BlastCard.tsx)) |
| `degraded` | An explanation only — **no tree, no counters, no graph action** ([`BlastCard.tsx:74`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/BlastCard/BlastCard.tsx)). An empty tree beside a "0 callers" counter reads as an all-clear, which is the opposite of what `degraded` means |
| `partial` | A warning line above the counters; the tree renders in full below it ([`BlastCard.tsx:93`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/BlastCard/BlastCard.tsx)) |
| `ok`, no symbols | Counters (all reading zero) plus an empty note, and **no graph action** — there is nothing to draw, so the dialog needs no empty state of its own ([`BlastCard.tsx:105`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/BlastCard/BlastCard.tsx)) |
| `ok` | Counters plus the tree |

The prior-PRs section is a **separate read with its own states**, and it renders
in three of the branches above — `ok`, `partial` and `degraded` — but in neither
Loading nor Load error. It reads `pr_files` and never the code index, so "the
index is unusable" says nothing about whether this list is right.

| Prior-PRs state | Behaviour |
|---|---|
| Loading | One skeleton bar under the section title; the map around it is unaffected |
| Error | A muted inline line only — **never an `ErrorState`, never a Retry**. A failed secondary read must not look like the card failed |
| Empty, nothing uncomparable | "No merged or closed PR has touched these files." — a true all-clear |
| Empty, `uncomparable_prs > 0` | The all-clear is **suppressed** and replaced by how many PRs could not be compared. An empty list is only honest next to that count |
| Populated | One row per PR: `#number`, title, then shared-file count and author |
| Collapsed | Header only. Everything below it — list, all-clear, uncomparable note — folds away together |

Under `ok`, a zero renders rather than being suppressed. A suppressed zero would
make "nothing there" look like "we could not see" — collapsing exactly the
distinction the status enum carries.

## 3. Data

- `useBlastRadius(prId)` — `["pr-blast", prId]` → `GET /pulls/:id/blast`
  ([`lib/hooks/blast.ts:13`](../src/lib/hooks/blast.ts)). The endpoint always
  answers 200 for a PR that exists; how much it could see rides in `status`, not
  in the HTTP code.
- `useBlastSummary(prId)` — a mutation posting to `/pulls/:id/blast/summary`,
  whose `onSuccess` patches the returned sentence into the cached map with
  `setQueryData` rather than invalidating; a refetch would redo the index reads
  to learn one field already in hand
  ([`lib/hooks/blast.ts:22`](../src/lib/hooks/blast.ts)).
- **The graph issues no request of its own.** It is handed the same response
  object the tree just rendered, so opening the dialog costs nothing
  ([`BlastCard.tsx:142`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/BlastCard/BlastCard.tsx)).
- `usePriorPrs(prId)` — `["pr-prior-prs", prId]` → `GET /pulls/:id/prior-prs`
  ([`lib/hooks/blast.ts`](../src/lib/hooks/blast.ts)). **Its own query, not a
  field on the map.** Two reasons: the card must render the map when this read
  fails, and the map must not pay for the join on every render. The section
  fetches for itself rather than taking data from `BlastCard`, so a failure here
  is structurally incapable of taking the map down. Server contract:
  [`server/specs/prior-prs.md`](../../server/specs/prior-prs.md).
- No `fetch` in a component. A failed read surfaces inline with Retry; a failed
  Explain surfaces as an inline `role="alert"` beside its button, which stays so
  the user can retry once the cause is fixed.

### Counters versus chips

The counters report the response's **top-level unions**, which the server widened
by BFS and which are therefore a *superset* of the per-symbol attributions. The
chips inside a symbol row report **that symbol's own** endpoints and crons. So a
row's chips are always a subset of the counters, and the two disagreeing is
expected rather than a bug.

The graph follows the chips, not the counters: endpoints and crons hang off the
caller that exposes them, and a fact the BFS widened past every individual caller
is drawn nowhere — putting it on the canvas would assert a path the response does
not claim.

## 4. Interaction

- **Disclosure.** The first symbol is open on mount, every other is closed
  ([`BlastCard.tsx:115`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/BlastCard/BlastCard.tsx)).
  Each row's header is a real `<button aria-expanded>` controlling its body by
  id, so the collapse is keyboard-operable and announced rather than being a
  click target that only a mouse can reach.
- **Prior-PRs disclosure.** The section's title is itself a
  `<button aria-expanded>` controlling its body by id — the same disclosure
  `SymbolRow` uses, so it is keyboard-operable and announced. **Open on mount**:
  collapsing is additive, and a section that hid itself by default would be a
  feature nobody finds. The PR count sits at the header's far edge so a collapsed
  header still says how much is folded away rather than reading as empty. The
  list, the all-clear and the `uncomparable_prs` note collapse **together** —
  hiding the list while leaving the caveat on screen would strand it, and hiding
  the caveat alone would leave a false all-clear.
- **Naming.** A `function` or `method` renders as `name()`. Every other kind the
  indexer emits — `class`, `enum`, `interface`, `type` — renders bare, with the
  kind beside it as a muted tag
  ([`constants.ts`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/BlastCard/constants.ts)).
  Drawing an interface as `TicketStreamProps()` would state it is callable.
- **Links.** Every `file:line` — the declaration, each caller, each linkable
  graph node — is pinned to the PR's head SHA so the line number stays correct as
  the branch moves on, and renders as **plain text rather than a dead link** when
  the repo's `full_name` is unknown. One helper builds them all, so the tree and
  the graph cannot disagree about where a location points
  ([`helpers.ts`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/BlastCard/helpers.ts)).
  Endpoint and cron nodes never link: there is no file behind them.
- **Long paths wrap rather than widen the card.** A path is one token with no
  break opportunity — browsers do not break at `/` — and both cards are grid
  items, whose default `min-width: auto` refuses to shrink below their content.
  Left alone the two combine to push a deep path straight through the card's
  border. The fix is a `minWidth: 0` chain down every container that holds a
  path, plus `overflowWrap: anywhere` on the leaf that holds it. Any new
  path-bearing row here needs both; neither is observable in jsdom, which
  computes no layout.
- **Graph.** Opens in a modal, closes on the modal's own close control or its
  backdrop. The layout is **three layered columns** — changed symbols, their
  callers, and what those callers expose — one row per node, computed by plain
  arithmetic inside a `useMemo`. Rows are a fixed pitch apart, so two labels
  can never overlap; ordering within a column is barycentric against the caller
  column, the standard layered-graph crossing heuristic. Nothing is random or
  iterative, so one response always produces one picture, nothing competes with
  React's render loop, and the geometry is assertable with no animation-frame
  shim. The helper computes numbers only; React renders every element
  ([`BlastGraph/helpers.ts`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/BlastCard/_components/BlastGraph/helpers.ts)).
- **The canvas grows downwards, and the modal body scrolls.** Width is fixed at
  the three columns the dialog is sized for; height is computed from the row
  count. A large map therefore gets a taller canvas at full label size rather
  than tighter packing. The legend sits **above** the diagram for the same
  reason — below it, it would be off screen on exactly the maps that need it.
- **Explain.** One model call, only on an explicit click, never on render. It
  sits in the section heading's right slot. Once a summary exists at the current
  head the button is gone and the summary renders in the card body — there is no
  "Regenerate", which would be a paid call producing the answer already on
  screen. A failed Explain surfaces as an inline `role="alert"` and the button
  stays, so the user can retry once the cause is fixed.
- Nothing on this card is optimistic; the summary appears only after the server
  answers.

## 5. Acceptance

| # | Item | Covered by |
|---|---|---|
| 1 | Four icon counters render, zeros included, with a right-aligned Graph button | `CounterRow.test.tsx` ("reports all four counters", "renders a zero rather than hiding the counter") |
| 2 | No Graph button when there is no map to draw | `CounterRow.test.tsx` ("renders no Graph button…"); `BlastCard.test.tsx` ("hides the graph action when there are no symbols to draw") |
| 3 | A function renders `name()`; a non-function renders bare plus its kind | `SymbolRow.test.tsx` ("renders a function kind as callable…", "never draws a non-function kind as callable…") |
| 4 | Rows collapse and expand, toggling `aria-expanded`; first symbol open on mount | `SymbolRow.test.tsx` (— collapse); `BlastCard.test.tsx` ("opens the first symbol and leaves the rest closed") |
| 5 | The declaration `file:line` appears in the expanded body, marked by a return arrow and carrying no visible `declared at` wording, but still named for assistive tech | `SymbolRow.test.tsx` ("keeps the declaration link the comp drops") |
| 6 | Every caller link is SHA-pinned, `rel="noopener noreferrer"` | `SymbolRow.test.tsx` ("SHA-pins every caller link"); `BlastCard.test.tsx` ("SHA-pins every caller link…") |
| 7 | Rows render as plain text, never a dead link, when the repo is unknown | `SymbolRow.test.tsx`, `BlastCard.test.tsx`, `BlastGraph.test.tsx` (all three surfaces) |
| 8 | Per-symbol endpoint and cron chips render that symbol's own attribution | `SymbolRow.test.tsx` ("renders this symbol's own endpoint and cron chips") |
| 9 | Counters report the widened union, not the per-symbol chips | `BlastCard.test.tsx` ("counts callers across symbols, and endpoints from the widened union") |
| 10 | The Graph button opens a modal, the tree stays mounted behind it, no refetch, and it closes again | `BlastCard.test.tsx` ("opens the graph over the card without a refetch, and closes again") |
| 11 | The dialog names all four node colours in a legend | `BlastGraphDialog.test.tsx` ("names every node colour in the legend") |
| 12 | The layout is deterministic for a fixed response, every node inside the canvas it reports | `BlastGraph.test.tsx` ("is deterministic…", "places every node inside the canvas it reports") |
| 12a | Symbols, callers and facts sit in three left-to-right columns, each headed | `BlastGraph.test.tsx` ("lays symbols, callers and facts out in three left-to-right columns", "heads each column so the diagram reads without the legend") |
| 12b | No two labels can overlap, at any map size, and the canvas grows instead | `BlastGraph.test.tsx` ("never lets two labels share a band, however large the map", "grows the canvas with the map rather than packing nodes tighter") |
| 12c | Callers follow the order of the symbols that call them; an edge leaves clear of its own label | `BlastGraph.test.tsx` ("orders callers to follow the symbol that calls them", "starts an outgoing edge clear of its own label") |
| 13 | Node and edge counts match the response, deduped; a BFS-widened fact gets no node | `BlastGraph.test.tsx` ("emits one node per symbol, caller and fact…", "emits one edge per…", "draws no node for a fact the BFS widened past every caller") |
| 14 | `degraded` renders no tree, no counters, no graph action, no Explain | `BlastCard.test.tsx` ("degraded explains itself and renders no tree, no counters, no Explain"; "hides the graph action entirely on a degraded map") |
| 15 | `ok` with no symbols is a distinct empty state, counters still present | `BlastCard.test.tsx` ("ok-with-no-symbols is a true empty state, distinct from degraded") |
| 16 | A load error offers Retry, and every retry is a GET | `BlastCard.test.tsx` ("surfaces a load error and retries the GET (not a paid POST)") |
| 17 | Explain posts once; the button disappears once a summary exists; a failure is an inline alert; the summary renders above the counters | `BlastCard.test.tsx` (— Explain, four cases, incl. "puts the summary above the counters — the answer before the detail") |
| 18 | Overview renders two columns, collapsing to one when narrow | **Not verified** — no automated test is possible at this tier and no browser check has been done; see Known gaps |
| 19 | A prior PR renders with its overlap count and author, linked to GitHub with `rel="noopener noreferrer"` | `PriorPrs.test.tsx` ("lists a prior PR with its overlap, linked to GitHub") |
| 20 | Prior-PR rows render as plain text, never a dead link, when the repo is unknown | `PriorPrs.test.tsx` ("renders plain text — never a dead link…") |
| 21 | An empty list with nothing uncomparable is a true all-clear | `PriorPrs.test.tsx` ("says nothing touched these files when the comparison was complete") |
| 22 | An empty list with `uncomparable_prs > 0` suppresses the all-clear and says how many could not be compared | `PriorPrs.test.tsx` ("never claims an all-clear when PRs could not be compared") |
| 23 | A failed prior-PRs read reports inline, with no Retry, and the map stays rendered | `PriorPrs.test.tsx` ("reports a failed read inline without throwing"); `BlastCard.test.tsx` ("keeps the map rendered when the prior-PRs read fails") |
| 24 | The section renders on a `degraded` map too — it reads no index | `BlastCard.test.tsx` ("renders it on a degraded map too — it reads no index") |
| 25 | The section is open on mount and collapses, toggling `aria-expanded`; the header stays | `PriorPrs.test.tsx` ("opens on mount and collapses the list away, toggling aria-expanded") |
| 26 | The PR count rides on the header and survives the collapse | `PriorPrs.test.tsx` ("says how many PRs are folded away…") |
| 27 | Collapsing hides the all-clear and its uncomparable caveat together | `PriorPrs.test.tsx` ("keeps the all-clear and its caveat together when collapsed") |

The journey does not currently warrant an [`e2e`](../../e2e/README.md) flow: the
card reads one GET and the only paid action is already covered by component
tests against a mocked `fetch`.

## 6. Known gaps

- **The two-column grid is unverified by any automated test.** It is a single
  CSS grid declaration with no behaviour to assert, and this tier of the app
  carries no class names or `data-testid`s, so a jsdom test could only re-read
  the inline style it just set. jsdom also computes no layout, so the collapse
  itself is not observable there. **It has also not yet been confirmed in a
  browser** — treat the two-column rendering and its narrow-viewport collapse as
  unverified until someone loads a PR's Overview tab and looks.
- **Counter labels have no singular form.** One caller reads `1 callers`,
  matching the existing `callerCount` catalogue entry rather than introducing
  pluralisation this card would be the first to need.
- **The prior-PRs list is a lower bound, and says so.** `pr_files` is populated
  by opening a PR's detail, so a PR nobody has opened is invisible to the query.
  `uncomparable_prs` discloses how many, and the section suppresses its
  all-clear whenever that count is non-zero — but the underlying blind spot is
  reported, not removed. See
  [`server/specs/prior-prs.md`](../../server/specs/prior-prs.md) §5.
- **Backfilling `pr_files` at import time would remove that blind spot**, at the
  cost of a much heavier import. Out of scope; no work is planned.
- **Prior-PR rows have no singular form either** — one shared file reads
  `1 shared files` and a one-PR header reads `1 PRs`, matching the `callerCount`
  convention above rather than introducing pluralisation this catalogue has
  never carried.
- **The prior-PRs collapse is not persisted.** It is local `useState`, so it
  resets on every navigation back to the tab — the same choice the graph dialog
  makes, for the same reason: which sections you have folded is presentation,
  not a shareable location.
- **Graph node labels are truncated** to a fixed character budget, keeping the
  tail as the identifying part. A long path is therefore readable in the tree but
  abbreviated in the graph; the tree remains the complete, accessible-first view
  and the graph carries no information the tree lacks.
- **A very large map is a long scroll.** The canvas grows a row per node with no
  cap, so a PR touching a widely-called symbol produces a diagram several
  screens tall. Every row stays legible, but there is no overview of the whole
  map at once and no zoom-out; the counters and the tree remain the summary
  view. This replaces the previous gap here — "the graph canvas is a fixed
  viewBox … the simulation clamps every node inside the box" — which was not a
  packing trade-off but a defect: the clamp projected every out-of-box node onto
  the border, putting 100% of a 72-node map onto 11 distinct rows. Resolved
  2026-08-10 by the layered layout in §4.
