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

## Recurring errors & fixes

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
