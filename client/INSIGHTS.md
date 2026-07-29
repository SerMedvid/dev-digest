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

## Codebase patterns & tool notes

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

## Open questions
