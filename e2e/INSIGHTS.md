# `@devdigest/e2e` — engineering insights

Durable, non-obvious knowledge about this package, accumulated across sessions.
Read it before working here. Append via the
[`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md) skill:
append-only, and correct a wrong entry with a newer dated one rather than
editing it.

Standing rules live in [`CLAUDE.md`](CLAUDE.md). This file is observations, and
an entry can age — verify before relying on one.

## What works

- **2026-08-05** — A negative UI assertion has no `wait` form, but
  `{"cmd": ["get", "count", "text=<string>"], "assert": {"stdoutIncludes": "0"}}`
  works: `get count` prints the bare integer, so an absent element prints `0` and
  a present one prints `1`. Used to assert the Intent card is *not* labelled
  stale. Pair it with a positive assertion — a count of `0` also holds on a blank
  page. (`specs/08-pr-intent.flow.json`)

## What doesn't work

- **2026-08-05** — Flows `04` and `05` do `find text "Add rate limiting…" click`
  with no `wait --text` on that row first, so locally they fail at "open the PR
  row" while `02` (which does wait) passes on the identical click. Any new flow
  that clicks a row must carry the `wait --text` guard; adding one to `04`/`05`
  would fix them. (`specs/04-pr-findings.flow.json:7`,
  `specs/02-repo-pulls-detail.flow.json:8`)

## Codebase patterns & tool notes

- **2026-08-05** — `wait --text` matches the **rendered** innerText, so CSS
  `text-transform: uppercase` wins: the Intent card's headings must be asserted
  as `IN SCOPE` / `LOW CONFIDENCE`, and the DOM-cased `In scope` times out. Dump
  the real strings with `agent-browser get text body` before writing assertions
  rather than reading them out of the message catalogue.
  (`specs/08-pr-intent.flow.json`,
  `../client/messages/en/prReview.json`)

## Decisions

## Recurring errors & fixes

- **2026-08-05** — On Windows, [`run.ts`](run.ts)'s `execFile` cannot launch the
  npm shim: bare `agent-browser` is `spawn ENOENT` (no `.cmd` resolution without
  a shell) and `agent-browser.cmd` is `spawn EINVAL` (Node's batch-file spawn
  hardening). Fix without touching the runner — point the existing knob at the
  packaged native binary:
  `AGENT_BROWSER_BIN="<npm prefix>/node_modules/agent-browser/bin/agent-browser-win32-x64.exe"`.
  CI is Linux, where the plain name resolves. (`run.ts:45`)

## Open questions

- **2026-08-05** — `wait --url` intermittently times out when the navigation it
  is waiting for has *already* completed (agent-browser 0.33.2): each CLI
  invocation is a separate process, so a fast client-side route change can land
  before the wait arms. Observed once by hand, never in a full `npm test` run —
  unclear whether it is a real race in the flows or an artifact of driving the
  CLI manually.
