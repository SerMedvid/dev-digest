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

1. A section label carrying the `Workflow` icon.
2. A **counter row** — symbols, callers, endpoints, cron/jobs, each with an icon,
   and a `Graph` button pushed to the far edge
   ([`CounterRow.tsx`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/BlastCard/_components/CounterRow/CounterRow.tsx)).
3. One **collapsible row per changed symbol**, each opening to its declaration
   site, its callers, and its own endpoint and cron chips
   ([`SymbolRow.tsx`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/BlastCard/_components/SymbolRow/SymbolRow.tsx)).
4. **Explain**, or the cached summary once one exists at this head.

The `Graph` button opens the same data as a force-directed diagram in a modal
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
- **Graph.** Opens in a modal, closes on the modal's own close control or its
  backdrop. The layout is a `d3-force` simulation seeded on a fixed spiral and
  ticked to completion **synchronously** inside a `useMemo`, never animated —
  so one response always produces one picture, nothing competes with React's
  render loop, and the geometry is assertable without an animation-frame shim.
  d3 computes numbers only; React renders every element
  ([`BlastGraph/helpers.ts`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/BlastCard/_components/BlastGraph/helpers.ts)).
- **Explain.** One model call, only on an explicit click, never on render. Once a
  summary exists at the current head the button is replaced by the summary — no
  "Regenerate", which would be a paid call producing the answer already on
  screen.
- Nothing on this card is optimistic; the summary appears only after the server
  answers.

## 5. Acceptance

| # | Item | Covered by |
|---|---|---|
| 1 | Four icon counters render, zeros included, with a right-aligned Graph button | `CounterRow.test.tsx` ("reports all four counters", "renders a zero rather than hiding the counter") |
| 2 | No Graph button when there is no map to draw | `CounterRow.test.tsx` ("renders no Graph button…"); `BlastCard.test.tsx` ("hides the graph action when there are no symbols to draw") |
| 3 | A function renders `name()`; a non-function renders bare plus its kind | `SymbolRow.test.tsx` ("renders a function kind as callable…", "never draws a non-function kind as callable…") |
| 4 | Rows collapse and expand, toggling `aria-expanded`; first symbol open on mount | `SymbolRow.test.tsx` (— collapse); `BlastCard.test.tsx` ("opens the first symbol and leaves the rest closed") |
| 5 | The declaration `file:line` appears in the expanded body under `declared at` | `SymbolRow.test.tsx` ("keeps the declaration link the comp drops") |
| 6 | Every caller link is SHA-pinned, `rel="noopener noreferrer"` | `SymbolRow.test.tsx` ("SHA-pins every caller link"); `BlastCard.test.tsx` ("SHA-pins every caller link…") |
| 7 | Rows render as plain text, never a dead link, when the repo is unknown | `SymbolRow.test.tsx`, `BlastCard.test.tsx`, `BlastGraph.test.tsx` (all three surfaces) |
| 8 | Per-symbol endpoint and cron chips render that symbol's own attribution | `SymbolRow.test.tsx` ("renders this symbol's own endpoint and cron chips") |
| 9 | Counters report the widened union, not the per-symbol chips | `BlastCard.test.tsx` ("counts callers across symbols, and endpoints from the widened union") |
| 10 | The Graph button opens a modal, the tree stays mounted behind it, no refetch, and it closes again | `BlastCard.test.tsx` ("opens the graph over the card without a refetch, and closes again") |
| 11 | The dialog names all four node colours in a legend | `BlastGraphDialog.test.tsx` ("names every node colour in the legend") |
| 12 | The layout is deterministic for a fixed response, every node inside the canvas | `BlastGraph.test.tsx` ("is deterministic…", "places every node inside the canvas") |
| 13 | Node and edge counts match the response, deduped; a BFS-widened fact gets no node | `BlastGraph.test.tsx` ("emits one node per symbol, caller and fact…", "emits one edge per…", "draws no node for a fact the BFS widened past every caller") |
| 14 | `degraded` renders no tree, no counters, no graph action, no Explain | `BlastCard.test.tsx` ("degraded explains itself and renders no tree, no counters, no Explain"; "hides the graph action entirely on a degraded map") |
| 15 | `ok` with no symbols is a distinct empty state, counters still present | `BlastCard.test.tsx` ("ok-with-no-symbols is a true empty state, distinct from degraded") |
| 16 | A load error offers Retry, and every retry is a GET | `BlastCard.test.tsx` ("surfaces a load error and retries the GET (not a paid POST)") |
| 17 | Explain posts once; the button disappears once a summary exists; a failure is an inline alert | `BlastCard.test.tsx` (— Explain, three cases) |
| 18 | Overview renders two columns, collapsing to one when narrow | **Not verified** — no automated test is possible at this tier and no browser check has been done; see Known gaps |

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
- **"Prior PRs touching these files" is not built.** The design comp draws it
  inside this card's border, but it has no backend — no query, no route, no
  contract, no hook, with only `pr_files` to build it from. It is deliberately
  out of scope here and needs its own spec.
- **Graph node labels are truncated** to a fixed character budget, keeping the
  tail as the identifying part. A long path is therefore readable in the tree but
  abbreviated in the graph; the tree remains the complete, accessible-first view
  and the graph carries no information the tree lacks.
- **The graph canvas is a fixed viewBox.** A map far larger than the tuned
  ~20-node case will place nodes closer together rather than growing the canvas,
  since the simulation clamps every node inside the box.
