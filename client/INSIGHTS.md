# `@devdigest/web` — engineering insights

Durable, non-obvious knowledge about this package, accumulated across sessions.
Read it before working here. Append via the
[`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md) skill:
append-only, and correct a wrong entry with a newer dated one rather than
editing it.

Standing rules live in [`CLAUDE.md`](CLAUDE.md). This file is observations, and
an entry can age — verify before relying on one.

## What works

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
