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

- **2026-08-06** — **Corrects the 2026-08-05 "negative UI assertion" entry under
  _What works_: `get count "text=<string>"` does not work, and its `0` is
  meaningless.** `get count` takes a **CSS selector** (`agent-browser get --help`:
  `count <selector>`); `text=` is only an engine for the separate
  `find text <value>` subcommand. So `text=…` matches nothing and prints `0`
  whether the element is present or absent — the assertion **cannot fail**.
  Verified on agent-browser 0.33.2 against a static fixture where the string was
  visibly present twice: `get count "text=1 findings"` → `0`, and
  `find nth 1 "text=1 findings"` errors. The consequence is live:
  [`specs/08-pr-intent.flow.json`](specs/08-pr-intent.flow.json)'s "the card is
  NOT labelled stale" step has never been capable of failing, and
  `../server/specs/intent.md`'s acceptance table cites it as coverage. To assert
  absence, count a **real CSS selector** and — because the app ships no
  ids/classes/testids — prove the selector discriminates by running it against a
  static HTML fixture in both states (present and absent) before trusting it.
  (`specs/09-pr-smart-diff.flow.json`, `specs/08-pr-intent.flow.json:20`)

- **2026-08-06** — An e2e assertion can be *valid* and still prove nothing, and
  the collapse rules are where that bites. Flow `09` clicked a finding badge and
  then waited for the revealed line — but `src/config.ts` is `wiring` **with** a
  finding, so `SmartDiffViewer`'s collapse rule 2 had already expanded it at first
  paint and the line was in the DOM before the click. Before asserting that an
  interaction reveals something, confirm the thing is **not already visible in the
  initial render** for that fixture's data; on this page that means checking the
  file's role and finding count against
  `../client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/_components/SmartDiffViewer/helpers.ts`.
  Note no seeded boilerplate file carries a finding, so the badge-reveal path
  cannot be covered e2e on the current seed at all.
  (`specs/09-pr-smart-diff.flow.json`)

- **2026-08-05** — Flows `04` and `05` do `find text "Add rate limiting…" click`
  with no `wait --text` on that row first, so locally they fail at "open the PR
  row" while `02` (which does wait) passes on the identical click. Any new flow
  that clicks a row must carry the `wait --text` guard; adding one to `04`/`05`
  would fix them. (`specs/04-pr-findings.flow.json:7`,
  `specs/02-repo-pulls-detail.flow.json:8`)

## Codebase patterns & tool notes

- **2026-08-10** — Names the mechanism behind the 2026-08-05 innerText entry
  below, which recurred in flow `09`: the uppercase is not per-screen CSS but
  [`@devdigest/ui`](../client/src/vendor/ui/primitives/SectionLabel.tsx)'s
  `SectionLabel` primitive, which hardcodes `textTransform: "uppercase"` on its
  children. **Every** section caption on every screen therefore renders
  uppercase — `wait --text "REVIEWER-ORDERED DIFF"`, never the catalogue's
  `Reviewer-ordered diff`. The trap is that jsdom does not apply
  `text-transform`, so the client unit test asserting the catalogue casing
  passes while the flow times out; a green `client` suite is not evidence about
  casing. (`specs/09-pr-smart-diff.flow.json:12`,
  `../client/src/vendor/ui/primitives/SectionLabel.tsx:22`,
  `../client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/_components/SmartDiffViewer/SmartDiffViewer.test.tsx:323`)

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
