# Blast radius UI — parity with the design

**Date:** 2026-08-10
**Package:** `client/`
**Status:** approved, ready for planning

## Problem

The blast radius card shipped in `feat/blast-radius` renders the right data with
the wrong shape. Against the design comp and the reference prototype it differs
in almost every visual decision: counters carry no icons, every symbol is
permanently expanded, the graph is a second inline view behind a two-button
toggle rather than a dialog, and the Overview page stacks Intent above Blast
where the design places them side by side.

This is a presentation change. The wire contract
[`contracts/blast.ts`](../../../client/src/vendor/shared/contracts/blast.ts) is
unchanged, no endpoint moves, and no model call is added or removed.

## Sources of truth

Two design inputs, and they disagree in one place:

- **The comp** — the full-page Overview mockup. Governs the card: header, counter
  row, collapsible symbols, caller rows, chips, and the two-column page grid.
- **The prototype** — a separate running app outside this repo. Governs the graph
  only: it opens in a dialog over a force-directed layout with a legend, not as
  an inline view.

Where the comp draws a segmented `Tree | Graph` control, the prototype's dialog
wins, and the control becomes a single `Graph` button. A dialog is an action, not
a view switch, and modelling it as one would leave the card holding view state it
never reads.

## Scope

**In:** the blast card's markup and styling, the graph dialog, the two-column
Overview grid, and the tests and message keys those need.

**Out:** "Prior PRs touching these files". The comp draws it inside the card's
border, but it has no backend — no query, no route, no contract, no hook. Only
`pr_files` exists to build it from. It gets its own spec after this lands.

## Card anatomy

### Header

`SectionLabel` with the `Workflow` icon, replacing `Zap` to match the comp's fork
glyph. The `right` slot is now empty — the view control moves into the counter
row.

### Counter row

One row: four counters with icons, `Graph` button pinned right.

```
<> 2 symbols   ↳ 14 callers   ⌾ 3 endpoints   ⏱ 1 cron        [ Graph ]
```

Icons come from the vendored registry — `Code`, `CornerDownRight`, `Globe`,
`Clock`. Nothing new is added to it.

All four counters render including zeros. Under `status: ok`, "0 endpoints" is a
fact; `partial` and `degraded` are what say "we could not see". Suppressing a
zero would erase that distinction at exactly the point the card exists to make
it.

The `Graph` button renders only when `changed_symbols` is non-empty, so the
dialog needs no empty state of its own.

### Symbol rows

Collapsible. The first symbol is expanded on mount, the rest collapsed.

```
▾ <> rateLimit()                                          4 callers
     declared at  src/middleware/rate-limit.ts:12
     ↳ src/api/public/index.ts:23      registerPublicRoutes
     ↳ src/api/public/webhooks.ts:45   handleWebhook
     ⌾ GET /api/public/items   ⌾ POST /api/public/webhooks
     ⏱ reset-rate-buckets (hourly)
▸ <> bucketKey()                                          2 callers
```

Three departures from a literal trace of the comp, each for a reason:

1. **The declaration `file:line` moves into the expanded body**, under the
   existing `declaredAt` message. The comp drops it; dropping the only link to
   the changed symbol itself would be a regression against what ships today.
2. **`()` is appended only for function-like kinds.** `TicketStreamProps` is an
   interface and must not be drawn as callable. Non-function kinds render the
   name bare with `kind` as a muted tag, so the information the comp discards is
   still on screen.
3. **The row header is a `<button aria-expanded>`** controlling the body region
   by id, so the collapse is operable by keyboard and announced by screen
   readers.

Caller rows keep today's link rule: a row links only when `repoFullName` is
known, and renders as plain text otherwise. Every link stays pinned to the PR's
head SHA so line numbers remain correct.

Endpoint and cron chips render per symbol, from that symbol's own attribution —
not from the response's BFS-widened union. The union is what the counters report.

## Graph dialog

The `Graph` button opens `Modal` from the vendored kit at `width={1180}` with a
graph area around 640 high. The card behind it continues to show the tree; there
is no view state and no URL parameter, because which view you are looking at is
presentation, not a shareable location.

The dialog contains the force-directed graph and a bottom-left legend: changed
symbol, caller, endpoint, cron.

**The simulation runs to completion synchronously** inside a `useMemo` —
`forceSimulation(...).stop()` followed by a fixed tick count — rather than
animating through a ticker. Same response yields the same picture, nothing
competes with React's render loop, and the layout is exercisable in jsdom
without a rAF shim.

Edge semantics carry over from the layered layout unchanged: endpoints and crons
hang off the caller that exposes them, so an edge always asserts "reachable
through that caller", and facts the BFS widened past any individual caller stay
out of the graph rather than being drawn as a relationship the data does not
claim.

### Dependency

`d3-force` and `@types/d3-force` are **not** added to
[`client/package.json`](../../../client/package.json). The root `.npmrc` sets
`node-linker=hoisted`, so both already resolve flat out of
`client/node_modules/.pnpm/node_modules`, arriving transitively through
`recharts` → `victory-vendor`. This is the same phantom-dependency footing the
current `d3-scale` and `d3-shape` imports already stand on. The risk is
acknowledged and accepted: it breaks if the linker mode changes or recharts drops
`victory-vendor`.

## States

The status contract does the work it already does. Only the chrome changes.

| State | Renders |
|---|---|
| `isLoading` | Skeleton at the card's footprint |
| `isError` | Message + Retry. **No Explain** — a failed read must not offer a paid model call |
| `degraded` | Explanation only. No tree, no counters, no Graph button |
| `partial` | Warning line above the counters; tree renders normally |
| `ok`, no symbols | Empty note; no Graph button |
| `ok` | Counters + tree |

`degraded` renders no counters and no tree on purpose. An empty tree beside a
"0 callers" counter reads as an all-clear, which is the opposite of what
`degraded` means.

Explain and the cached summary stay at the foot of the card: when `summary` is
present it renders under an uppercase muted `What this touches` label; otherwise
a small Explain button. No Regenerate once a summary exists at this head — it
would be a paid call producing the answer already on screen.

## Page layout

[`OverviewTab`](../../../client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx)
becomes a two-column grid — Intent left, Blast right — collapsing to one column
on narrow viewports. The Description block stays full-width below both.

## Structure

Following the client's folder-per-component convention:

```
BlastCard/
  BlastCard.tsx          shell + states; owns dialog open state
  BlastCard.test.tsx     states, counters, expand/collapse, dialog open/close
  helpers.ts             callerHref (unchanged)
  constants.ts           FUNCTION_KINDS — drives the "()" suffix
  styles.ts
  _components/
    CounterRow/          four icon counters + Graph button
    SymbolRow/           collapsible symbol: declaration row, callers, chips
    BlastGraphDialog/    Modal + legend, wraps BlastGraph
    BlastGraph/          svg; helpers.ts swaps layered layout for d3-force
```

Styling stays inline `CSSProperties` in `styles.ts`, matching every neighbour
under `pulls/[number]/_components/` rather than the Tailwind-in-`styles.ts` rule
the package `CLAUDE.md` states — a Tailwind card here would read as foreign
beside `IntentCard`.

New message keys in `blast.json`: `viewGraph`, `graph.title`, `graph.legend.*`.
`declaredAt` and `callerCount` already exist and get their first use.

## Testing

`BlastCard.test.tsx` covers rendered behaviour, not internals:

- each status branch renders its documented block, and `degraded` renders no
  tree, no counters and no Graph button
- counters report the union values, zeros included
- the first symbol is expanded and the second is not; clicking a collapsed
  header expands it and toggles `aria-expanded`
- the Graph button opens the dialog and closing it returns focus to the card
- rows render unlinked when `repoFullName` is null

`BlastGraph.test.tsx` asserts layout **invariants**, never coordinates: every
node placed, all coordinates finite and within the canvas, node and edge counts
matching the response, and no edge for a BFS-widened fact.

## Acceptance

- [ ] Counter row shows four icon counters and a right-aligned Graph button
- [ ] Symbols collapse and expand; first open on mount; keyboard operable
- [ ] Function-like kinds render `name()`; other kinds render bare name + kind tag
- [ ] Declaration `file:line` appears in the expanded body under `declaredAt`
- [ ] Endpoint and cron chips carry the globe and clock icons
- [ ] Graph opens in a modal with a force layout and a legend; card keeps the tree
- [ ] Graph layout is deterministic for a fixed response
- [ ] Overview renders two columns, collapsing to one when narrow
- [ ] `degraded` renders no tree, no counters, no Graph button
- [ ] `cd client && pnpm typecheck && pnpm test` pass
