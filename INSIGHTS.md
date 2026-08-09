# dev-digest — engineering insights

Durable, non-obvious knowledge about the repo as a whole, accumulated across
sessions. Read it before working here. Append via the
[`engineering-insights`](.claude/skills/engineering-insights/SKILL.md) skill:
append-only, and correct a wrong entry with a newer dated one rather than
editing it.

Standing rules live in [`CLAUDE.md`](CLAUDE.md). This file is observations, and
an entry can age — verify before relying on one.

## What works

## What doesn't work

## Codebase patterns & tool notes

- **2026-08-09** — Same root cause as the `node --test` entry below, worse
  failure mode: with no root `package.json`, `npx <tool>` run from the repo root
  does not resolve the package's pinned binary — it **silently fetches a
  different major version** and reports success. `npx vitest run test/x.test.ts`
  from the root ran `v4.1.10` rooted at the repo, while the same command from
  `mcp/` ran the pinned `v2.1.9` rooted at the package; the root invocation
  printed green for a suite it had resolved differently. There is no error to
  notice, so read the `RUN v<version> <rootdir>` banner, and `cd` into the
  package for every `npx`/`npm`/`pnpm` invocation — including after a `cd` to
  the repo root to run `git`, which is where the working directory usually
  drifts. (`mcp/package.json:1`)

- **2026-08-05** — A Claude Code Bash permission rule with a trailing wildcard
  does **not** match the bare command: `Bash(pnpm typecheck *)` never authorises
  `pnpm typecheck` with no arguments, so a rule that looks installed silently
  prompts anyway. List both forms. Shell operators are outside the match too —
  `Bash(safe-cmd *)` does not cover `safe-cmd && other-cmd`, which makes a `deny`
  entry a partial net at best (`Bash(docker compose down -v*)` misses
  `docker compose -f x.yml down -v` and `--volumes`). Put the load-bearing
  prohibition in the agent's own prompt body and treat the `deny` list as the
  second rubber. (`.claude/settings.local.json:17`)

- **2026-08-05** — `superpowers` v6.2.0 plan/execute skills mandate three steps a
  repo-local agent may not be allowed to run: `writing-plans` templates a
  `Step N: Commit` with a real `git commit` at the end of every task, and
  `executing-plans` opens by requiring a git worktree via `using-git-worktrees`
  and closes by handing off to `finishing-a-development-branch`. Wiring any agent
  to execute a plan from [`docs/superpowers/plans/`](docs/superpowers/plans/)
  therefore needs those three carved out explicitly, with a stated replacement
  (report the intended commit message, work in the tree it was given, stop and
  report). Skill sources live in the plugin cache, not the repo:
  `~/.claude/plugins/cache/claude-plugins-official/superpowers/<version>/skills/`.
  (`.claude/agents/implementer.md:72`)

- **2026-08-02** — A Claude Code hook in [`.claude/settings.json`](.claude/settings.json)
  has **no `args` field**. A `type: "command"` hook is a single shell string
  (`command`, plus optional `timeout` / `shell` / `async`); writing
  `"command": "node", "args": [...]` runs bare `node` and the hook silently
  gates nothing. Quote the path inside the one string instead:
  `node "${CLAUDE_PROJECT_DIR}/scripts/x.mjs"`. Verify a new hook by piping a
  payload to the script directly — a no-op hook looks installed.
  (`.claude/settings.json:14`)

- **2026-08-02** — `node --test scripts/` does **not** discover tests here: with
  no root `package.json`, Node treats the directory as an entry module and dies
  with `Cannot find module …/scripts`. Use the glob —
  `node --test "scripts/*.test.mjs"`. Bare `node --test` is worse: it walks the
  whole repo into the per-package vitest suites and fails on files it can't run.
  (`scripts/pr-self-review-gate.test.mjs:1`)

- **2026-07-28** — [`skills-lock.json`](skills-lock.json) is not an inventory of
  [`.claude/skills/`](.claude/skills/), and nothing reconciles the two.
  `architecture-patterns` and `github-workflow-automation` are locked but absent
  from disk; `mermaid-diagram`, `react-best-practices`, `react-testing-library`
  and `security` are on disk but unlocked. List the directory before trusting
  the lock as the skill list. Skills authored in this repo have no upstream, so
  they belong nowhere in it. (`skills-lock.json:4`)

## Decisions

- **2026-08-05** — The [`planner`](.claude/agents/planner.md) /
  [`implementer`](.claude/agents/implementer.md) split exists **despite**
  Anthropic documenting it as an anti-pattern: their multi-agent guidance reports
  that with agents specialised by development role (planner, implementer, tester,
  reviewer) "the subagents spent more tokens on coordination than on actual work",
  and recommends splitting by context boundary instead — "an agent handling a
  feature should also handle its tests". Four mitigations are what make ours
  viable, so treat them as load-bearing rather than stylistic: the handoff is a
  **file** in `docs/plans/` or `docs/superpowers/plans/`, never a chat message;
  both agents read [`.claude/skills/README.md`](.claude/skills/README.md) as the
  single shared rule source instead of each carrying its own skill list; the
  implementer takes a vertical slice **including its own tests**; and
  architecture/security review is done by separate blackbox agents, which is the
  one role split that guidance endorses ("verification requires minimal context
  transfer by nature"). Dropping any of them reopens the telephone-game failure.
  Source: `claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them`.
  (`.claude/agents/planner.md:1`)

## Recurring errors & fixes

- **2026-08-06** — A *fabricated* secret in fixture data still blocks the push if
  it is **shaped** like a real one. [`server/src/db/seed.ts`](server/src/db/seed.ts)'s
  demo diff carried `sk_live_` + 40 alphanumerics, and GitHub push protection
  matched it as a Stripe key and rejected the whole branch. Two consequences.
  Push protection scans **every commit in the push**, not the tip — so fixing it
  forward does not unblock; the offending commit has to be amended at its source
  and everything after it replayed (`git checkout --detach <sha>` → edit →
  `git add` → `git commit --amend` → `git rebase --onto <new> <old> <branch>`).
  And the repo's *other* fake keys pass precisely because they are not key-shaped
  (`sk_live_xxx` in [`server/src/adapters/mocks.ts`](server/src/adapters/mocks.ts),
  `sk_live_leak` in the reviewer-core tests, `sk_live_...` in
  `client/messages/en/eval.json`). Since this app's whole domain is diffs that
  leak secrets, fixtures will keep wanting one: give it the recognisable
  **prefix** and never a realistic body. (`server/src/db/seed.ts:38`)

- **2026-08-06** — Same class as the CRLF entry below, different mechanism:
  `powershell -File script.ps1` reads the script as the **ANSI codepage**, so
  non-ASCII written into that script arrives mangled — an em dash in a comment
  landed as `вЂ”` in the source. It type-checks, tests green, and is invisible
  unless you read the diff, and a second PowerShell pass trying to repair it
  mangles the repair the same way. This repo's prose uses `—` throughout, so any
  script-driven edit to a comment or doc hits it. Make text edits with the Edit
  tool, or keep the script strictly ASCII. (`server/src/db/seed.ts:31`)

- **2026-08-03** — There is **no `.gitattributes`**, so nothing normalises line
  endings: any edit made by a tool that rewrites a whole file with platform
  defaults (Python's `io.open(..., 'w')` on Windows translates `\n` to `\r\n`)
  silently converts the file to CRLF, and the change lands as a **whole-file
  diff** — a 6-line edit showed up as 324 changed lines. It type-checks and
  tests green, so only the diff reveals it. Check `git diff --stat` for a file
  whose line count dwarfs the edit before committing, and prefer restoring a
  backup with `cp` (byte-for-byte) over rewriting it. To repair: `git checkout
  --` the file if the edit is unwanted, else rewrite in binary
  (`open(p,'rb')` → `replace(b'\r\n', b'\n')` → `open(p,'wb')`).

## Open questions
