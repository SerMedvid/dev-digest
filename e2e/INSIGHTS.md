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
  a present one prints `1`. Used to assert the Intent card is _not_ labelled
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

- **2026-08-14** — **The local runner was serving `next dev` while CI serves a
  PRODUCTION build, and that gap is why a whole class of failures "only happens
  in CI".** [`e2e-web.yml`](../.github/workflows/e2e-web.yml) does
  `pnpm build` + `pnpm start`; `scripts/e2e.sh` did `next dev`. Different React
  build, routes compiled on demand, different hydration timing — so
  [`CLAUDE.md`](CLAUDE.md)'s instruction to "check it passes under
  `./scripts/e2e.sh` (the CI environment)" was not true of the one thing most
  likely to differ. The script now builds by default, with `E2E_WEB_MODE=dev`
  for the fast edit loop. Reach for this **first** when CI fails a step that no
  local run can reproduce, before suspecting the locator, the seed or the
  session. Caveat, recorded honestly: this was found while chasing flow `11`'s
  CI-only click failures and is a real gap, but it has **not** been shown to
  cause them — three attempts to reproduce under parity died on leaked ports and
  a mis-aimed `pkill` before producing a verdict. (`../scripts/e2e.sh:164`)

- **2026-08-14** — **Flow `11` is now READ-ONLY: both of its click-driven cases
  are gone**, superseding the restore-and-it-passes entry this replaces. The
  expand-on-click step failed in CI, was removed, restored after a clean local
  run went 11/11 with it — and then CI failed the *next* click in the same flow
  ("click the first focus row" → `wait --url tab=diff`, click reports `✓`, URL
  never changes). Ruled out with evidence, so do not re-spend it: the literals
  (they match [`../server/src/db/seed.ts`](../server/src/db/seed.ts)`:447` and
  the stored row), the locator (`find text` resolves the innermost node, which
  bubbles), **below-the-fold position** (reproduced at CI's exact 1280×577
  viewport: the row sits at `top: 1206` and the click still works), and session
  sharing (CI runs one suite on a clean runner). What is left unexplained is a
  click that lands and produces no `router.replace`, in CI only. The rendering
  assertions still cover the three brief surfaces; the interactions stay covered
  by `RiskAreas.test.tsx` and `ReviewFocus.test.tsx`.
  (`specs/11-pr-brief.flow.json`)

- **2026-08-14** — **agent-browser is ONE session per machine, so two runs at
  once silently corrupt each other — and the damage looks exactly like a flaky
  interaction.** `run.ts` shells out to the CLI per step with no session id, so
  a second suite (a colleague's, a leftover background run, a hung one that
  never exited) drives the *same page*. The signature is diagnostic: every
  `wait --text` still passes, because both runs sit on similar pages and the
  literal is somewhere in the DOM, while every click-then-assert step fails,
  because the other run navigates away between the click and the assertion.
  Observed live: flow `11`'s "the click switches to the Files changed tab" step
  failed in a run launched while a forgotten hermetic run was still stepping
  through the same flows; the identical click passed `exit=0` on a clean
  session moments later, URL and all. Scope it correctly, though: this explains
  **local** confusion only. It cannot explain a CI failure — CI runs one suite
  on a fresh runner — so it is not the answer to flow `11`'s, and the 2026-08-10
  flow-`09` entry stays unexplained rather than closed by it. Before treating a
  local interaction failure as flaky: confirm nothing else holds the session (a
  stale `next dev` on 3100/3101 is the tell), then re-run alone.
  (`../scripts/e2e.sh`, `run.ts:44`)

- **2026-08-14** — **`scripts/e2e.sh`'s teardown leaks the API and web
  processes on Windows**, so the *next* run meets a stack whose ports are bound
  by a server with no database behind it — the isolated Postgres container is
  removed by the same trap that fails to kill them. The backstop is
  `lsof -nP -iTCP:"$port" -sTCP:LISTEN -t`, and `lsof` does not exist in Git
  Bash; `kill_tree` alone misses the grandchild that `pnpm exec tsx` / `next
  dev` actually spawn as the listener. Symptom: `curl localhost:3100` answers
  404 and `localhost:3101/health` answers 200 while `docker ps` shows no
  `devdigest-e2e-postgres`. **Fixed** the same day — the backstop now falls back
  to `powershell -Command "(Get-NetTCPConnection …).OwningProcess"` when `lsof`
  is absent — but it cost two dead runs before that, so if a run dies with
  `EADDRINUSE` on 3100/3101, check for an orphan rather than assuming the
  previous run is still alive. Related trap while cleaning up by hand: the dev
  API and the hermetic API are the *same command line* (`tsx src/server.ts`), so
  `pkill -f` matches both and takes the developer's stack down with it. Kill by
  port or PID. (`../scripts/e2e.sh:70`)

- **2026-08-14** — **Second instance of the 2026-08-10 entry below, and it
  settles the rule: this suite covers no expand-on-click path, in any flow.**
  Flow `11`'s "the explanation reveals on expand" step failed in the
  maintainer's hermetic run — `wait --text` timed out on the risk explanation
  while the step *above* it (the row title, same component, same seeded row)
  passed — and did not reproduce against the dev stack in either form: direct
  URL to the PR, and the flow's own click-through path from the pulls list,
  both `exit=0` on the click **and** the reveal. Ruled out and not worth
  re-checking: the literal (it matches
  [`../server/src/db/seed.ts`](../server/src/db/seed.ts)`:447` and the stored
  `pr_brief` row character for character, so this is *not* the
  literal-provenance class recorded under _Codebase patterns_), and the locator
  (`find text` resolves the innermost node, the `<span>` holding the title,
  which bubbles to the row's `<button>`). Leading suspect, **unproven**:
  `RiskAreas` mounts inside `IntentCard`, whose `isLoading` / `isError` /
  `!data` branches render no `RiskAreas` at all
  (`../client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/IntentCard/IntentCard.tsx:50`),
  so any blip in the **intent** query unmounts it and its `open` state — plain
  component state, nothing in the URL — resets, collapsing an expanded row for
  good. What to do instead: assert only what the **collapsed** render already
  shows (the refs are visible collapsed, so the grounding assertion never
  needed the click), and leave reveal-on-expand to `RiskAreas.test.tsx`, which
  covers it four ways. (`specs/11-pr-brief.flow.json:23`)

- **2026-08-10** — **Supersedes the "Applied in flow `09`'s post-click step"
  claim in the 2026-08-10 `get count` entry under _Codebase patterns & tool
  notes_: that step no longer exists.** Flow `09`'s "clicking the collapsed
  package-lock.json card expands it" case was removed. It failed in the
  maintainer's environment in both forms — `get count … 2` and then a polling
  `wait` on the body selector — while passing in every environment where it
  could be reproduced: 6/6 back-to-back replays, 20/20 rapid toggles (counts
  alternated `1,2,1,2…`, so the DOM read never lagged the click), and two
  full-suite runs against a freshly-seeded hermetic stack. Ruled out and
  therefore not worth re-investigating: file ordering within a group
  (`../server/src/modules/smart-diff/helpers.ts:85` sorts by findings desc,
  lines desc, path asc — a total order, `package-lock.json` first on every DB),
  the click straying onto the summary pill that `stopPropagation`s, and a
  refetch remounting the tab and re-seeding the open state
  (`page.tsx` gates on `isLoading`, false during background refetches, and the
  seed effect is ref-guarded per PR). **Do not re-add the step without a
  reproduction first** — two rounds of fixing it blind have now cost more than
  the coverage is worth, and no expand-on-click path is covered e2e at all
  (the badge one has no seeded target either). (`specs/09-pr-smart-diff.flow.json`)

- **2026-08-06** — An e2e assertion can be _valid_ and still prove nothing, and
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

- **2026-08-14** — Extends the 2026-08-05 entry below from *casing* to
  *provenance*: a `--text` literal for seeded content must be read off
  [`server/src/db/seed.ts`](../server/src/db/seed.ts), never copied from the
  feature's unit tests. Both usually carry a fixture with the same shape and
  similar prose, so the copy looks right in review and in the diff — flow `11`
  asserted the brief's `why` as *"Unauthenticated clients can hammer …"* while
  the seed says *"can **currently** hammer"*, one word apart, and the step timed
  out. What made it expensive to read is that the step **above** it passed:
  section labels like `PR BRIEF` render in the empty state too, so "the section
  is there" is not evidence the data loaded, and the failure looks like a
  broken query rather than a wrong string. When adding a flow over seeded data,
  diff every literal against the seed — a one-liner over the flow's `--text`
  arguments and the seeded row catches the whole class at once — and prefer
  asserting a value only the *populated* state can render.
  (`specs/11-pr-brief.flow.json:12`, `../server/src/db/seed.ts:441`)

- **2026-08-10** — `get count` is a **single instantaneous DOM read** taken in
  its own process, with none of the polling every `wait` form does — so a
  `get count` immediately after a click asserts on whatever the DOM happened to
  be at that instant, and has no retry if the re-render lands a beat later. Two
  compounding weaknesses: `stdoutIncludes` is a _substring_ check, so an
  expected `"2"` also passes on `12`, `20` or `32`, and an expected `"1"` passes
  on `10`–`19`. Assert **presence** with `wait "<css selector>"` (polls, exits
  non-zero on timeout) and keep `get count` for **absence**, which has no wait
  form. Applied in flow `09`'s post-click step; the selector was proven to
  discriminate live in both states — it times out on the collapsed card and
  passes after the click. (`specs/09-pr-smart-diff.flow.json`)

- **2026-08-10** — `find text <value>` resolves the **innermost** element
  containing the string, not an ancestor: on a FileCard header the chain ends at
  the `<span class="mono">` holding the path, so the click lands on the filename
  and bubbles to the header's `onClick`, and cannot stray onto a sibling control
  like the summary pill (which `stopPropagation`s and would call a model).
  Verified by `find text … hover` then
  `eval "document.querySelectorAll(':hover')"`, which prints the resolution
  chain — the way to check what any locator will actually click.
  (`specs/09-pr-smart-diff.flow.json:29`,
  `../client/src/components/diff-viewer/FileCard/FileCard.tsx:140`)

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

- **2026-08-14** — A `next dev` server that was **already running while files
  were edited** — especially anything under
  [`../client/src/vendor/ui/`](../client/src/vendor/ui/), which every screen
  imports — serves `Application error: a client-side exception has occurred`
  on routes that are perfectly fine after a restart. Running the flows against
  it produces a failure pattern that reads exactly like a real regression: the
  `wait --url` steps pass (routing works), every `wait --text` step times out
  (nothing painted), and the browser console shows only React's DevTools notice
  because the error boundary already swallowed the throw. Two cheap checks
  before believing it: open a route the change cannot touch (`/settings/...`
  passing while `/pulls` fails means the shell is fine), and reload the failing
  route once more — a stale-HMR crash clears on a fresh load, a real one does
  not. Restart the dev server before a local e2e run, or drive
  [`../scripts/e2e.sh`](../scripts/e2e.sh), which starts a fresh one.
  (`specs/02-repo-pulls-detail.flow.json`)

- **2026-08-14** — Extends the entry below with the *other* half of the Windows
  story: [`../scripts/e2e.sh`](../scripts/e2e.sh) does not tear its stack down
  there. Its `cleanup` trap kills by walking the process tree with `pgrep -P` and
  backstops with `lsof -nP -iTCP:<port>`, and **neither binary exists in Git
  Bash** — so the trap removes the ephemeral Postgres container (`docker rm -f`
  works) while the API and web children survive as orphans. The state that
  leaves behind is actively misleading: `:3101/health` still answers `{"status":
  "ok"}` (liveness does not ping the DB) so the stack looks up, while every real
  endpoint 500s with `connect ECONNREFUSED 127.0.0.1:5433`, and the next run's
  `docker run` collides with nothing so the failure does not repeat identically.
  Reap them by port before re-running:
  `netstat -ano | grep ":<port> " | awk '{print $5}'` then `taskkill //PID <pid>
  //F`. Prefer driving `npm test` against an already-running stack on Windows and
  leave `e2e.sh` to Linux/CI. (`../scripts/e2e.sh:68`)

- **2026-08-05** — On Windows, [`run.ts`](run.ts)'s `execFile` cannot launch the
  npm shim: bare `agent-browser` is `spawn ENOENT` (no `.cmd` resolution without
  a shell) and `agent-browser.cmd` is `spawn EINVAL` (Node's batch-file spawn
  hardening). Fix without touching the runner — point the existing knob at the
  packaged native binary:
  `AGENT_BROWSER_BIN="<npm prefix>/node_modules/agent-browser/bin/agent-browser-win32-x64.exe"`.
  CI is Linux, where the plain name resolves. (`run.ts:45`)

## Open questions

- **2026-08-05** — `wait --url` intermittently times out when the navigation it
  is waiting for has _already_ completed (agent-browser 0.33.2): each CLI
  invocation is a separate process, so a fast client-side route change can land
  before the wait arms. Observed once by hand, never in a full `npm test` run —
  unclear whether it is a real race in the flows or an artifact of driving the
  CLI manually.
