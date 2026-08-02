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
