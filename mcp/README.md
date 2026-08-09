# `@devdigest/mcp` — the MCP server

Exposes DevDigest to MCP clients (Claude Code, Claude Desktop) as five
task-shaped tools. It is a **thin adapter over the DevDigest HTTP API** — no
database access, no `server/src` imports, no business logic.

```
MCP client ──stdio──▶ @devdigest/mcp ──HTTP──▶ DevDigest API :3001 ──▶ reviewer-core ──▶ LLM
```

Because reviews run in the API process, a review started from an MCP client
streams live into the DevDigest studio exactly as one started from the UI.

## Prerequisites

The API must be running and its database migrated and seeded:

```bash
docker compose up -d                 # never `down -v` — it drops the data volume
cd server && pnpm db:migrate && pnpm db:seed && pnpm dev
```

## Install and run

```bash
cd mcp && npm ci     # npm, not pnpm — this package has its own package-lock.json
npm start            # stdio; a client normally spawns this for you
```

`.mcp.json` at the repo root wires it into Claude Code automatically.

| Env var | Default | Meaning |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | DevDigest API base URL |
| `DEVDIGEST_WAIT_SECONDS` | `120` | How long `run_agent_on_pr` waits before handing back a run id |
| `DEVDIGEST_POLL_INTERVAL_MS` | `2000` | Poll cadence while waiting |

## Tools

| Tool | Writes? | Purpose |
|---|---|---|
| `devdigest_list_agents` | no | The configured reviewers; the source of a valid `agent` name |
| `devdigest_run_agent_on_pr` | **yes** | Start a review, wait for it, return the findings — one call |
| `devdigest_get_findings` | no | Read a review that already ran |
| `devdigest_get_conventions` | no | The repository's extracted house rules |
| `devdigest_get_blast_radius` | no | **Not implemented** — returns an error by design |

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

## Testing

```bash
npm test           # vitest, hermetic — the API is faked (test/helpers/fake-api.ts)
npm run typecheck
```

There is no integration lane: this package's only dependency is the HTTP
contract, which `test/api.test.ts` pins against a stub `fetch`.

> **stdout is the JSON-RPC channel.** Never `console.log` here — use
> `console.error`. A stray stdout write corrupts the protocol stream.

> **`ToolResult` is a `type`, not an `interface`.** The SDK's `CallToolResult`
> carries an index signature, and TypeScript grants implicit index signatures
> only to type aliases. Converting it back to an `interface` breaks the
> `registerTool()` call in `src/main.ts`.
