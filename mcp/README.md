# `@devdigest/mcp` — the MCP server

Exposes DevDigest to MCP clients (Claude Code, Claude Desktop) as five
task-shaped tools. It is a **thin adapter over the DevDigest HTTP API** — no
database access, no `server/src` imports, no business logic.

```
MCP client ──stdio──▶ @devdigest/mcp ──HTTP──▶ DevDigest API :3001 ──▶ reviewer-core ──▶ LLM
```

Because reviews run in the API process, a review started from an MCP client
streams live into the DevDigest studio exactly as one started from the UI.

Before working here, read [`INSIGHTS.md`](INSIGHTS.md) — the non-obvious things
earlier sessions learned in this package. Append to it via the
`engineering-insights` skill.

## It is NOT part of the app lifecycle

This is the thing to get right, because the two look connected and are not:

| | Starts what | Started by | Lives as long as |
|---|---|---|---|
| [`scripts/dev.sh`](../scripts/dev.sh) | Postgres, API `:3001`, web `:3002` | you, in a terminal | the terminal |
| [`.mcp.json`](../.mcp.json) | this MCP server | your **MCP client** (Claude Code), per session | the client session |

`scripts/dev.sh` does **not** start the MCP server and must never be changed to
— it is a stdio process owned by whichever client spawned it, not a daemon.
Bringing the app up leaves this package untouched; the MCP server is brought up
separately, on demand, by the flow below.

The dependency runs one way: this server is useless without the API on `:3001`,
but the API neither knows nor cares that this package exists.

## From zero

Assumes a clone with nothing installed and nothing running.

### 1. Bring up the app the MCP server talks to

```bash
./scripts/dev.sh            # docker → migrate → seed → API :3001 + web :3002
./scripts/dev.sh --no-client   # same without Next.js — enough for MCP
```

Leave this running in its own terminal. Confirm before going further:

```bash
curl -s http://localhost:3001/agents | head -c 200
```

A JSON array means you are ready. Connection refused means the API is not up,
and every MCP tool will return the same "API is not reachable" error.

> `dev.sh` runs `db:seed`. On a database that already holds your work, use
> `./scripts/dev.sh --no-seed`.

### 2. Install this package

```bash
cd mcp && pnpm install
```

**pnpm, not npm** — this package has its own `pnpm-lock.yaml`, like `server/`
and `client/`. Running `npm install` here writes a second lockfile.

### 3. Check it in isolation, before wiring any client

The server speaks JSON-RPC over stdio, so you can drive it by hand. This is the
fastest way to tell "the server is broken" apart from "the client config is
wrong":

```bash
cd mcp
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"devdigest_list_agents","arguments":{}}}' \
  | npx tsx src/main.ts
```

Expected: three JSON-RPC responses on **stdout**, one `[devdigest-mcp] ready`
line on **stderr**, and the `tools/call` result listing your configured agents.
`tools/list` must name all five `devdigest_*` tools.

For the same check with a UI — browse the tool schemas, fill arguments in a form,
re-run a call without retyping the frame — use the MCP Inspector:

```bash
cd mcp && pnpm run inspect
```

It spawns its own copy of the server, opens a browser, and speaks the same stdio
protocol the printf check does. The Inspector is **not** a dependency of this
package: the script fetches it with `npx --yes` so `pnpm install` — and CI — stay lean.
The server itself still resolves from the local `tsx`, so the thing you inspect
is the version in your working tree.

Reach for the printf check when you want to know whether the server answers at
all, and the Inspector when you want to explore what it answers.

### 4. Wire it into a client

[`.mcp.json`](../.mcp.json) at the repo root already declares the server, so
Claude Code picks it up when you open this repo and asks you to approve it once.
Nothing else to do.

For a client that wants an explicit command, the equivalent is:

```
command: npx
args:    --yes tsx mcp/src/main.ts     # cwd = repo root
env:     DEVDIGEST_API_URL=http://localhost:3001
timeout: 180000                        # ms — see Configuration
```

### 5. Confirm the client sees it

In Claude Code, `/mcp` lists connected servers and their tools. `devdigest`
should appear with five tools.

## Running it only when you want it

`.mcp.json` is committed, so it applies to everyone who opens the repo. To keep
the server from starting in **your** sessions without changing that shared file,
put the choice in `.claude/settings.local.json` — that file is local-only and
never committed:

```json
{ "disabledMcpjsonServers": ["devdigest"] }
```

Remove the entry (or list it in `enabledMcpjsonServers`) when you want it back;
either way it takes effect on the next client session. Related key:
`enableAllProjectMcpServers` approves every `.mcp.json` server without asking.

Starting `pnpm start` in a terminal is **not** a way to "have it running" — with
no client on the other end of stdin it idles and serves nobody. A client always
spawns its own process.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | DevDigest API base URL |
| `DEVDIGEST_WAIT_SECONDS` | `120` | How long `run_agent_on_pr` waits before handing back a run id |
| `DEVDIGEST_POLL_INTERVAL_MS` | `2000` | Poll cadence while waiting |

A trailing slash on `DEVDIGEST_API_URL` is stripped; a non-numeric or
non-positive value for either number falls back to its default rather than
failing at boot.

### The client's tool timeout has to outlast the wait budget

`run_agent_on_pr` blocks for up to `DEVDIGEST_WAIT_SECONDS` before it gives up
and hands the run id back. That budget and the client's per-call timeout are two
independent clocks, and the client's wins: if it fires first the model gets a
timeout it cannot act on, while the review keeps running in the API process and
still lands in the studio.

So [`.mcp.json`](../.mcp.json) pins `"timeout": 180000` — the 120s budget plus
headroom for the start call, the last poll and the findings fetch. It is a
per-server override of Claude Code's `MCP_TOOL_TIMEOUT`, in **milliseconds**, and
a value below 1000 is ignored rather than honoured. Raising
`DEVDIGEST_WAIT_SECONDS` means raising this alongside it.

Other clients neither read `.mcp.json` nor share that default — the MCP
TypeScript SDK's own is 60s (`DEFAULT_REQUEST_TIMEOUT_MSEC`), which is what the
Inspector uses, so a review driven from `pnpm run inspect` gives up client-side
at 60s while the API keeps working.

## Tools

| Tool | Writes? | Purpose |
|---|---|---|
| `devdigest_list_agents` | no | The configured reviewers; the source of a valid `agent` name |
| `devdigest_run_agent_on_pr` | **yes** | Start a review, wait for it, return the findings — one call |
| `devdigest_get_findings` | no | Read a review that already ran |
| `devdigest_get_conventions` | no | The repository's extracted house rules |
| `devdigest_get_blast_radius` | no | What a PR's changes reach: changed symbols, their callers, the endpoints and jobs downstream |

Only `devdigest_run_agent_on_pr` costs money and takes minutes; everything else
is a read.

`devdigest_get_blast_radius` always carries a `status`. `ok` means the map is
complete; `partial` means the index is incomplete or behind the PR's head, so
callers may be missing; `degraded` means the index could not be read at all —
its empty arrays mean *unknown*, never *nothing calls this*. The projection
spells that out in a `note` rather than leaving the model to infer it.

## The CLI — `devdigest review`

A second entry point in this package, sharing `src/api.ts`, `src/config.ts` and
`src/errors.ts` with the MCP server. `.mcp.json` and the server itself are
untouched.

```bash
cd mcp
pnpm review -- --mode working              # the workspace's default agent
pnpm review -- --mode working --agent "Security Reviewer"
```

It reviews your **local working tree** with the same reviewer, the same
grounding gate and the same blocker count DevDigest runs on a pull request —
before you push. There is no PR, and nothing is persisted: no runs, no reviews,
no findings.

### What is reviewed, and what is not

`git diff HEAD` — staged **and** unstaged changes to **tracked** files. That is
the entire review input.

**Untracked files are not reviewed.** `git diff HEAD` cannot see them. They are
counted and reported on stderr:

```
2 untracked file(s) not reviewed (git diff HEAD does not see them — stage or commit to include).
```

Stage or commit them to include them. The exclusion is deliberate — synthesising
a diff for them would review something git does not consider part of the change.

### Exit codes

The contract, also printed by `--help`:

| Code | Meaning |
|---|---|
| `0` | the review ran and found no blockers (also: nothing to review) |
| `1` | the review ran and found blockers, per the agent's `ci_fail_on` |
| `2` | the review **could not run** — not a git repo, API unreachable, non-200, unknown agent, bad flags |

The `1` / `2` split is the point: a CI step must be able to tell "your code has
problems" from "this tool did not work".

### Streams

stdout carries the review payload **only**, so a later CI step can parse it.
Every diagnostic — the untracked warning, errors, progress — goes to stderr,
the same discipline the MCP server applies to its JSON-RPC channel.

### Modes

`--mode` is required. Only `working` is implemented; `staged` and `branch` are
accepted by the parser and exit `2` with a message naming them, so adding one
later is a single branch rather than a redesign.

### Configuration

`DEVDIGEST_API_URL` (default `http://localhost:3001`) — the same variable the
MCP server uses. With the API down the CLI exits `2` and names both the URL and
`cd server && pnpm dev`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every tool says "The DevDigest API is not reachable" | the API is not running, or is on another port | start it (step 1); if the port differs, set `DEVDIGEST_API_URL` |
| `list_agents` errors with "No reviewer agents are configured" | database migrated but never seeded | `cd server && pnpm db:seed` |
| Client shows the server as failed, no tools | deps not installed | `cd mcp && pnpm install` |
| A PR resolves but reports "not imported yet" | the PR exists on GitHub but was never opened in the studio | open it once in the studio, then retry |
| Findings come back but `agents` is `["unknown"]` | that review predates agent attribution (seeded/imported rows carry `agent_name: null`) | expected; the `agent` filter cannot narrow such a review |
| Protocol errors / garbled JSON from the client | something wrote to stdout | see the stdout rule below |

## Testing

```bash
cd mcp
pnpm test          # vitest, hermetic — the API is faked (test/helpers/fake-api.ts)
pnpm typecheck
```

Both are hermetic: no Postgres, no Docker, no running API. `mcp.yml` runs
exactly these two in CI, path-filtered to `mcp/**`.

Run them **from `mcp/`**. With no root `package.json`, `npx vitest` from the
repo root resolves a different major version and still reports green — check the
`RUN v<version> <rootdir>` banner if a result looks surprising.

## Rules that are easy to break

> **stdout is the JSON-RPC channel.** Never `console.log` here — use
> `console.error`. A stray stdout write corrupts the protocol stream.

> **`ToolResult` is a `type`, not an `interface`.** The SDK's `CallToolResult`
> carries an index signature, and TypeScript grants implicit index signatures
> only to type aliases. Converting it back to an `interface` breaks the
> `registerTool()` call in `src/main.ts`.

> **No imports from `server/src`.** Request and response shapes are declared
> structurally in `src/types.ts`. Enums mirrored from the server (finding
> severity, convention category) are pinned by tests — keep them in step.

## Design rules

1. **Result, not operation.** `run_agent_on_pr` resolves, starts, waits and
   collects. A run id surfaces only when the wait budget is spent.
2. **Flat arguments.** Human identifiers (`"acme/payments-api"`, `482`,
   `"Security Reviewer"`), all scalars, six at most.
3. **Compact structured answers.** `src/project.ts` is the only place a field
   is allowed to reach the model. A raw finding has ~15 fields; `concise`
   returns five.
4. **Errors lead onward.** Business failures return `isError: true` (never a
   JSON-RPC protocol error) and always end with a concrete next step.
