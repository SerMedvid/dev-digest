# `@devdigest/mcp` — engineering insights

Durable, non-obvious knowledge about this package, accumulated across sessions.
Read it before working here. Append via the
[`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md) skill:
append-only, and correct a wrong entry with a newer dated one rather than
editing it.

This package has no `CLAUDE.md` — its standing rules are in
[`README.md`](README.md) ("Rules that are easy to break", "Design rules") and the
repo's [`../CLAUDE.md`](../CLAUDE.md). This file is observations, and an entry can
age — verify before relying on one.

Three entries in the root [`../INSIGHTS.md`](../INSIGHTS.md) were learned *here*
but constrain the whole repo, so they live there rather than being copied down.
Read them too:

- **2026-08-09** — `npx` from the repo root resolves a different vitest major and
  still reports green; `cd mcp` for every invocation.
- **2026-08-09** — `process.exit(code)` in a `tsx` CLI loses the exit code on
  Windows (reports 127); set `process.exitCode` instead. Applies to both entry
  points here.
- **2026-08-09** — `pnpm review -- --mode working` forwards the `--` verbatim, so
  a hand-rolled argv parser must skip a bare `--`.

## What works

## What doesn't work

## Codebase patterns & tool notes

- **2026-08-11** — **No test in this package can catch a client-side timeout, and
  the tools are built to sit right at one.** Every suite drives the handlers as
  plain functions with `deps()`'s `waitSeconds: 1, pollIntervalMs: 1`
  (`test/tools.test.ts:13`), so nothing here ever speaks stdio to a real client
  or waits a real budget — a green `pnpm test` says nothing about whether
  `run_agent_on_pr`'s 120s default wait survives the caller's clock. What makes
  that budget legal at all is specific to stdio and easy to mis-assume: Claude
  Code applies **no per-request timer** to a stdio server (that 60s timer is
  HTTP/SSE/ws only), and the 30-minute stdio idle window is not reached — which
  matters because this server sends **no progress notifications** during the
  wait, and progress would not extend the wall-clock limit anyway. So the wall
  clock is the *only* bound, and it comes from `timeout` in
  [`../.mcp.json`](../.mcp.json) (see README → Configuration). Consequences: a
  client other than Claude Code brings its own default — the MCP TypeScript
  SDK's is 60s, `DEFAULT_REQUEST_TIMEOUT_MSEC` in
  `@modelcontextprotocol/sdk/shared/protocol.js`, which is what `pnpm run
  inspect` inherits — and the only way to observe any of this is the printf
  smoke path or the Inspector, driving a real review. Authoritative reference for
  the client-side clocks: `code.claude.com/docs/en/mcp` → Timeouts.
  (`test/tools.test.ts:13`)

## Decisions

## Recurring errors & fixes

## Open questions
