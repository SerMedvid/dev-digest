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

## Recurring errors & fixes

## Open questions
