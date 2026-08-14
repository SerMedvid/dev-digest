# `@devdigest/web` — engineering insights

Durable, non-obvious knowledge about this package, accumulated across sessions.
Read it before working here. Append via the
[`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md) skill:
append-only, and correct a wrong entry with a newer dated one rather than
editing it.

Standing rules live in [`CLAUDE.md`](CLAUDE.md). This file is observations, and
an entry can age — verify before relying on one.

## What works

- **2026-08-02** — A URL param that triggers a *one-shot* effect (scroll to,
  expand, focus) must be latched in a ref, not just guarded by its own value.
  `usePrReviews`' data gets a **new array identity on every refetch** — a
  dismiss, a finished run, a window focus — so any effect that also depends on
  the reviews re-fires and replays the jump, yanking the page back to whatever
  the URL says long after the user moved on. Compare `consumedFindingId.current`
  before acting and set it after, so the param fires at most once per distinct
  value while still being allowed to wait for the data to arrive. The param
  itself stays in the URL (shareable, survives reload) — it's the *effect* that
  is one-shot, not the link.
  (`src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx:119`)

## What doesn't work

- **2026-08-14** — **`RiskAreas` is the brief's data mounted inside the
  *intent's* card**, and `IntentCard` returns early for `isLoading`, `isError`
  and `!data` — none of those three branches render `RiskAreas` at all
  (`src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/IntentCard/IntentCard.tsx:50`).
  So a blip in `usePrIntent` takes the brief's risk list down with it even
  though `usePrBrief` succeeded, and because the expanded row is plain
  component state with nothing in the URL, the remount silently collapses it
  and the reader's click is undone. The nesting is deliberate — "what this PR
  is for" and "what could go wrong with it" read as one card — but the coupling
  is not. **Fixed the same day**: the branches now return `head`/`foot` slots
  and the card renders exactly three children — `foot` is `null`, never absent
  — so `RiskAreas` holds index 1 whatever the intent query does. That last part
  is the load-bearing bit and the reason a wrapper element or a conditional
  sibling would *not* have fixed it: React matches children by position, so a
  branch that renders a different number of children before the shared one
  remounts it just as surely as an early return that omits it. The general
  shape: a card that renders another query's data keeps that data out of its
  own early returns, and keeps its position fixed across them.
  (`src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/IntentCard/IntentCard.tsx:212`)

- **2026-08-14** — **This app has no ambient refetch**, so any UI state whose
  only exit is "the server finished something" deadlocks unless it polls for
  that itself. [`providers.tsx`](src/lib/providers.tsx) sets `staleTime: 30_000`
  **and** `refetchOnWindowFocus: false` globally, so nothing re-reads a query
  after a one-shot `invalidateQueries` — not a tab switch, not returning to the
  window. The PR brief shipped with exactly that hole: a 409 (a generation is
  already in flight) put the card in a busy state, `onError` invalidated
  `["pr-brief", prId]` **once**, that refetch raced the generation it was waiting
  for and got the same 404, and the control then read "Generating…" *disabled,
  forever* — with the brief already stored server-side and only a full page
  reload clearing it. Answer a "someone else is doing it" response with a bounded
  poll, and bound it in both directions: the work landing ends the wait, and so
  does a give-up timer, because work that **fails** never lands anything and
  waiting on it forever is the same stuck control by another route.
  (`src/lib/hooks/brief.ts:76`)

- **2026-08-10** — **Clamping a force-layout's output into a fixed viewBox is
  not containment — it is the bug.** `forceCenter` only translates the centroid;
  nothing in `d3-force` bounds the extent, and the settled blob's diameter grows
  with the node count. Measured on the blast graph's own constants
  (`charge -340`, `linkDistance 110`, 300 ticks): 438×417 at 20 nodes, but
  1316×1207 at 72 and 1921×1943 at 120, against a 1000×500 usable box. The
  trailing `clamp(x, MARGIN, W-MARGIN)` then **projects every out-of-box node
  onto the border rectangle**, so overflow becomes exact overlap rather than
  crowding: at 72 nodes that was 100% of nodes on the border, min pair distance
  0.0px, and 11 distinct y values — the dense horizontal rows that made the
  dialog unreadable. Even the "tuned for ~20 nodes" case already clamped 71%.
  Two things follow. A per-node clamp can never be the containment strategy —
  fit the viewBox to the settled bounding box, or don't use physics. And
  `forceCollide(r)` is a **circle** while a label is a ~120×14px rectangle, so
  it does not prevent label collisions even when nothing is clamped. The cheap
  way to see any of this is a throwaway vitest file that calls the layout
  function and prints border-hits and min pair distance; every unit test in
  place passed throughout, because they asserted nodes were *inside* the box —
  which clamping guarantees by construction.
  (`src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BlastCard/_components/BlastGraph/helpers.ts:200`)

- **2026-07-29** — A `position: absolute` popover **cannot** work on the list,
  timeline or accordion surfaces: each one sets `overflow: hidden` to clip its
  own rounded corners (`src/app/repos/[repoId]/pulls/styles.ts:93` `tableCard`,
  `_components/ReviewRunAccordion/ReviewRunAccordion.tsx:75`), and an absolutely
  positioned box **is** clipped by such an ancestor because the ancestor sits in
  its containing-block chain. The card gets sliced off at the row's edge, and no
  `zIndex` helps — nothing is painting over it. Pin popovers in viewport
  coordinates instead (`position: fixed` + the trigger's `getBoundingClientRect`,
  see `cardPlacement`); a fixed box's containing block is the viewport, so no
  ancestor overflow reaches it. The vendored
  [`Dropdown`](src/vendor/ui/kit/Dropdown.tsx) still has this latent bug — it
  only looks fine because it's used in unclipped headers, so don't copy its
  positioning onto a row.
  (`src/components/findings-breakdown/helpers.ts:96`)

## Codebase patterns & tool notes

- **2026-08-06** — Tailwind 4's **preflight is active**, and it silently removes
  two defaults the inline-`CSSProperties` tier (entry below) is otherwise
  assumed to inherit: `ul`/`ol` get `list-style: none`, and **every `svg` gets
  `display: block`**. Both fail quietly and identically — a `<ul>` renders as
  bare indented lines that read as one run-on paragraph, and an icon placed in
  running text takes a whole line to itself — and neither is visible to
  `tsc` or to a jsdom test, which asserts text and never layout. So a list in a
  `styles.ts` must restate `listStyleType: "disc"` (`IntentCard`'s `list` did;
  `SplitBanner`'s didn't, and shipped marker-less), and an icon beside text
  needs a flex container rather than being an inline sibling. This is also why
  icons inside `Badge`/`Button` always look right — those primitives are
  `inline-flex`, so their `svg` is a flex item and the `display: block` never
  bites. Suspect preflight first when a hand-rolled row looks wrong in a way
  the styles don't explain.
  (`src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/_components/SmartDiffViewer/_components/SplitBanner/styles.ts:23`)

- **2026-08-06** — [`CLAUDE.md`](CLAUDE.md) says "Tailwind classes live in
  `styles.ts`", but **every** component under
  `src/app/repos/[repoId]/pulls/[number]/_components/` instead exports an `s`
  object of `CSSProperties` and applies it with `style={s.x}` — `IntentCard`,
  `FindingCard`, `VerdictBanner`, `RunStatus`, `PrDetailHeader`, and
  `src/components/diff-viewer/styles.ts` too. Nothing enforces either form, so a
  new component in that tier that follows the written rule reads as foreign next
  to its siblings, and a reviewer will flag whichever one you pick. Match the
  neighbours you are sitting among rather than the doc, and expect this to need
  re-deciding only if `CLAUDE.md` is corrected. Practical consequence for tests
  and e2e: with no class names or `data-testid`s anywhere in this tier, the only
  locators available are roles, visible text, and positional CSS — which is why
  the Smart Diff e2e flow ended up on `nth-of-type` chains.
  (`src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/IntentCard/styles.ts`)

- **2026-08-14** — Switching tab and scrolling to an element **in the same
  handler** silently does nothing on the PR detail page. `page.tsx` renders each
  tab behind `tab === "..."`, and `tab` comes from `useSearchParams` via
  `router.replace`, so the target tab's DOM does not exist until that navigation
  commits — `document.getElementById(...)` in the click handler returns `null`
  and the click reads as dead. Defer the lookup by one frame
  (`requestAnimationFrame`) after calling the tab setter. Note this is a
  different problem from the one-shot latch on `FindingCard`/`FileCard`'s
  `scrollToLine` (2026-08-02 below): there the element exists and the effect
  replays, here the element does not exist yet.
  (`src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/ReviewFocus/ReviewFocus.tsx:41`)

- **2026-08-06** — Every PR-detail tab takes `prId: string | null`
  (`OverviewTab`, `FindingsTab`, `DiffTab`, and `IntentCard` under it), so a
  null-`prId` branch inside one reads as a live user-facing path. It is
  **unreachable**. [`page.tsx`](src/app/repos/[repoId]/pulls/[number]/page.tsx)
  resolves `prId` from the pulls list with `?? null`, hands it to
  `usePullDetail`, which is `enabled: prId != null`
  ([`src/lib/hooks/core.ts:118`](src/lib/hooks/core.ts)) — so `pr` stays
  `undefined` and the `if (isError || !pr)` guard returns `ErrorState` before any
  tab mounts. The nullable prop is defensive typing, not a state the UI reaches.
  Worth knowing because a code review (human or model) will otherwise report
  "clicking this button posts to `/pulls/null/…`" as a real bug, and the fix it
  proposes — validating at the page level — is already there. Check the guard
  before treating any null-id branch in these tabs as reachable.
  (`src/app/repos/[repoId]/pulls/[number]/page.tsx:114`)

- **2026-08-03** — Two more vendored components that fix their own shape, same
  family as the `Textarea`/`FormField` entry below.
  [`EmptyState`](src/vendor/ui/primitives/EmptyState.tsx) takes **no children** —
  it has `cta`/`onCta`/`ctaLoading` for its one button, and `body` is a
  `ReactNode`, which is the only slot arbitrary content can ride in (a list of
  drop reasons, say). `<EmptyState>{…}</EmptyState>` is a type error, not a
  silent no-op, so it fails loudly — but plan-shaped code that assumes children
  has to be restructured, not patched.
  [`SelectInput`](src/vendor/ui/kit/SelectInput.tsx) accepts only
  `value/onChange/options/mono` and forwards nothing, so `aria-label` never
  reaches its `<select>`; inside a `FormField` it therefore has no accessible
  name at all. Query it through an option only it carries —
  `screen.getByRole("option", { name: "…" }).closest("select")` — rather than
  by index, which breaks the moment another select is added.
  (`src/app/repos/[repoId]/conventions/_components/ConventionsView/ConventionsView.tsx:104`)

- **2026-08-03** — [`ProgressBar`](src/vendor/ui/primitives/ProgressBar.tsx)
  takes a **0–100** value, not a 0–1 fraction: it does
  `Math.min(100, value) + "%"` directly. Passing a confidence or ratio straight
  through renders a bar that is technically correct and visually empty (0.91 →
  a 0.91%-wide sliver), and nothing throws — so it survives a test that only
  asserts the numeric label beside it. Multiply at the call site. Its sibling
  `PercentProgress` takes the same 0–100 scale and rounds for you.
  (`src/app/repos/[repoId]/conventions/_components/ConventionsView/_components/ConventionCard/ConventionCard.tsx:96`)

- **2026-08-03** — A test that asserts a query's **error** state must build its
  QueryClient with `defaultOptions: { queries: { retry: false } }`. The test
  helpers here all do a bare `new QueryClient()`, which inherits react-query's
  default `retry: 3` with exponential backoff — the stubbed failure retries for
  ~7s, `ErrorState` never renders inside `waitFor`'s 1s window, and the test
  reads as "the error branch is broken" when it is only slow. Mutation-error
  tests need no such change (mutations default to `retry: 0`), which is why a
  failed *save* asserts fine with the plain helper. Also: stub the failure as
  `{ ok: false, status, json: async () => ({ error: { message } }) }` —
  `apiFetch` reads `body.error.message` for the `ApiError` text, and without it
  the inline detail is just `"500 Internal Server Error"`.
  (`src/app/skills/[id]/_components/SkillDetail/_components/StatsTab/StatsTab.test.tsx:26`)

- **2026-08-03** — With `@tanstack/react-query` 5.62, calling `mutate` again on
  the same `useMutation` instance **discards the previous call's mutate-level
  callbacks**: `mutate` re-points the single mutation observer, so when the
  superseded request settles its `onSuccess`/`onError` never run (probed:
  0 calls for the superseded one, 1 for the newest). That is what makes the
  `previous`-snapshot revert in
  [`SkillsTab`](src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx)
  safe under rapid toggling — a stale revert *cannot* overwrite a newer
  optimistic update, so no sequence guard is needed. Two consequences: don't
  "fix" that pattern with a ref counter (dead code), and don't assume an error
  banner appears for a failed call that has been superseded — `isError` tracks
  the newest call only. Splitting one mutation into several instances (one per
  row, say) removes the protection and *then* needs explicit ordering.
  (`src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.test.tsx:151`)

- **2026-08-03** — The vendored [`Modal`](src/vendor/ui/kit/Modal.tsx) pads its
  own header (`18px 24px`) and footer (`16px 24px`) but gives the body **zero
  padding**, so children dropped straight in sit flush against the border while
  the title and buttons above/below them are inset — the feature has to supply
  that gutter itself (`<div style={{ padding: 24 }}>`, as
  [`CreateAgentModal`](src/app/agents/_components/AgentsListView/_components/CreateAgentModal/CreateAgentModal.tsx)
  does). Compounding it, [`Tabs`](src/vendor/ui/kit/Tabs.tsx) defaults to
  `pad="0 28px"`, which mismatches a modal's 24 — pass `pad="0 24px"` inside a
  `Modal`. Every surface that composes these two has to restate the gutter, so
  copy it from a neighbour rather than trusting the primitive's default.
  (`src/app/skills/_components/SkillsListView/_components/CreateSkillModal/styles.ts:11`)

- **2026-08-02** — The vendored form controls split on whether they forward
  props, which decides how a test can reach them.
  [`TextInput`](src/vendor/ui/kit/TextInput.tsx) spreads `...rest` onto its
  `<input>`, so `aria-label` works and `getByLabelText` finds it;
  [`Textarea`](src/vendor/ui/kit/Textarea.tsx) accepts only
  `value/onChange/placeholder/rows/mono` and forwards nothing, and
  [`FormField`](src/vendor/ui/kit/FormField.tsx) renders a bare `<label>` with
  no `htmlFor`. A textarea inside a FormField therefore has **no accessible
  name at all** — `getByLabelText(/…/)` and `getByRole("textbox", {name})` both
  fail, however the label reads on screen. Query it via
  `container.querySelector("textarea")` (or a placeholder) rather than adding a
  second `<label>` or forking the primitive. Same family as the `MonoLink` and
  badge entries below. (`src/app/skills/[id]/_components/SkillDetail/_components/ConfigTab/ConfigTab.test.tsx:52`)

- **2026-08-02** — jsdom 25 implements `File` **without `Blob.prototype.text()`**,
  so `await file.text()` in a file-picker handler throws
  `file.text is not a function` — and it surfaces as an *unhandled rejection*
  inside a React event handler, not as a clean test failure, so the assertion
  error you see names the missing DOM node rather than the cause. Read picked
  files with `FileReader` + `readAsText`, which jsdom does implement and every
  target browser supports. Companion to the `SubtleCrypto` entry below: assume
  nothing about which Blob/File methods this jsdom has.
  (`src/app/skills/_components/SkillsListView/_components/CreateSkillModal/CreateSkillModal.tsx:16`)

- **2026-08-02** — jsdom ships **no `SubtleCrypto`**, so `crypto.subtle` is
  `undefined` under vitest even though `crypto` exists. Any browser-crypto code
  needs `vi.stubGlobal("crypto", { ...globalThis.crypto, subtle: { digest } })`
  to be testable at all, and must itself treat a missing `subtle` as a normal
  degraded path (it's also genuinely absent in any non-secure context, i.e.
  plain http on a non-localhost host) rather than throwing. Second trap in the
  same place: a function that memoizes its digests at module scope keeps that
  cache **across tests in a file**, so every case has to use a distinct input
  key or a stubbed result leaks into the next one.
  (`src/lib/github-urls.test.ts:16`)

- **2026-08-02** — `MonoLink` ([`src/vendor/ui/primitives/MonoLink.tsx`](src/vendor/ui/primitives/MonoLink.tsx))
  hardcodes `fontSize: 13` in an **inline style on the element itself**, which
  no wrapper can override — inline wins over any inherited or ancestor rule. In
  a denser surface (the findings breakdown card's meta row is 12px) composing it
  produces a link that reads as a different typeface from the text beside it.
  Write a plain `<a>` with the surface's own style there, keeping the primitive's
  semantics (`target="_blank"`, `rel="noopener noreferrer"`, `stopPropagation`);
  that is not forking a primitive, it's declining to use one. Same family as the
  badge-primitive entry below: these components fix their own appearance, and the
  feature has to work around it rather than through it.
  (`src/components/findings-breakdown/styles.ts:141`)

- **2026-07-29** — The vendored badge primitives
  ([`Badge.tsx`](src/vendor/ui/primitives/Badge.tsx)) take **no `style` or
  `className` prop** and hardcode their colours inline from `SEV`/`CAT`, so a
  feature cannot restyle them — hover states, emphasis and spacing all have to
  live on a wrapper element around the badge. A `filter` on that wrapper is the
  only way to reach the badge's own colours; keep it off any ancestor of a
  `position: fixed` popover, since `filter` creates a containing block for fixed
  descendants and would reintroduce the clipping the fixed positioning solved.
  (`src/components/findings-breakdown/styles.ts:19`)

- **2026-07-29** — There is no `@testing-library/user-event` here; interaction
  tests drive components with `fireEvent` from `@testing-library/react`. That
  matters for any popover copied from
  [`src/vendor/ui/kit/Dropdown.tsx`](src/vendor/ui/kit/Dropdown.tsx): its
  outside-close listener is `document.addEventListener("mousedown", …)`, and
  `fireEvent.click` dispatches **no** mousedown, so an outside-click test that
  uses `click` silently asserts nothing. Use `fireEvent.mouseDown(target)` to
  close, and `fireEvent.click(trigger)` for the toggle — a browser turns
  Enter/Space on a native `<button>` into exactly that click, so keyboard
  activation needs no separate path.
  (`src/components/findings-breakdown/FindingsBreakdown.test.tsx:191`)

## Decisions

- **2026-08-10** — The blast graph is **layered columns, not a force
  simulation**, and a future "let's make it force-directed again" should stop
  here. The response is a strict three-tier DAG (changed symbol → caller →
  endpoint/cron), which is the shape force-directed layout is worst at: it
  discards the tier information the data already carries and converges to a
  hairball that is unreadable past ~40 nodes however well it is fitted. Columns
  give it back for free — one row per node at a fixed pitch means two labels
  *cannot* overlap at any map size, barycentric ordering within a column is the
  standard crossing heuristic, and the whole thing is plain arithmetic, so it
  needs no ticks, no alpha, no seeded spiral to stay deterministic. The cost is
  accepted deliberately: a large map is a several-screen scroll with no
  zoomed-out overview, and the counters plus the tree remain the summary view.
  This also removed the package's only `d3-force` dependency.
  (`src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BlastCard/_components/BlastGraph/helpers.ts:24`)

## Recurring errors & fixes

- **2026-08-14** — A test that combines `vi.useFakeTimers()` with RTL's
  `waitFor` **hangs to the 5s test timeout instead of failing**, which reads as
  "the code never settles" when the timers simply never advanced: `waitFor`
  polls on `setTimeout` and detects *Jest's* fake timers, not Vitest's, so with
  frozen timers its own poll never fires. Use
  `vi.useFakeTimers({ shouldAdvanceTime: true })` — real time still drives
  `waitFor`, while `await vi.advanceTimersByTimeAsync(ms)` (the async form, so
  the microtasks a refetch queues actually flush) jumps the interval or timeout
  under test. Needed for anything polling-shaped: the brief's 409 watch, and any
  future `refetchInterval`. Same failure signature as the `retry: false` entry
  under *Codebase patterns* — a slow test masquerading as a broken one.
  (`src/lib/hooks/brief.test.ts:86`)

- **2026-08-10** — A **local green build is not evidence this package builds**.
  [`.github/workflows/client.yml`](../.github/workflows/client.yml) runs
  `pnpm install --frozen-lockfile` with `working-directory: client`, so CI has
  *only* `client/node_modules` — any node_modules above this package exists on
  contributors' machines and nowhere else. An import satisfied from up there
  passes `pnpm typecheck` and `pnpm test` locally and fails in CI with `TS2307:
  Cannot find module` plus vite's `Failed to resolve import`. This had already
  shipped on `feat/blast-radius`: `BlastGraph/helpers.ts` imported `d3-scale`
  and `d3-shape` while both were declared only in a **repo-root**
  `package.json` + `pnpm-lock.yaml` that the root `CLAUDE.md` explicitly rules
  out ("not a monorepo, no root package.json"). Two things follow. First, the
  `.npmrc`'s `node-linker=hoisted` does **not** make packages under
  `node_modules/.pnpm/node_modules` importable from `src/` — being listed there
  is not resolution, and `recharts` → `victory-vendor` pulling a d3 module in
  transitively buys this package nothing. Second, the only cheap way to settle
  whether a bare specifier actually resolves is a throwaway vitest file that
  imports it and running `pnpm exec vitest run` on that file; `ls node_modules`
  and `require.resolve` both answer a different question than vite's resolver
  does. Suspect this whenever a d3-ish or otherwise transitive-looking import
  works and was never added with `pnpm add`.
  (`src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BlastCard/_components/BlastGraph/helpers.ts:1`)

- **2026-07-29** — `next dev` here can keep serving a **stale chunk** after an
  edit: the webpack watcher misses the change, a reload recompiles some other
  entry, and the page silently renders the old component — so a "still broken"
  report can be about code that was never loaded. Before re-diagnosing a UI fix,
  check the bundle rather than the source: `grep -rl "<newIdentifier>" .next/`.
  If it's absent, `touch` the changed files and `curl` the route to force a
  compile, then re-grep. Read chunk paths out of `.next/app-build-manifest.json`
  — the on-disk mtime of a chunk lies here (it stayed at its pre-edit value
  while the file's contents were current), so timestamps are not evidence.
  (`.next/app-build-manifest.json`)

## Open questions
