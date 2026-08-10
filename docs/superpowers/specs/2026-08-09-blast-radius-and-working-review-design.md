# Design — Blast Radius + `devdigest review --mode working`

Date: 2026-08-09
Status: approved, not yet implemented

## Problem

A reviewer looking at a diff can see what changed; they cannot see what the
change *touches*. "Who calls this helper, and which endpoints sit downstream?"
is answered today by grepping — or not at all. Meanwhile nearly everything
needed to answer it mechanically is already in the product and already unused:

- **The facade method exists and nothing calls it.**
  `RepoIntel.getBlastRadius(repoId, changedFiles)` is fully implemented in
  [`repo-intel/service.ts`](../../../server/src/modules/repo-intel/service.ts)
  (persistent-index path `tryPersistentBlast`, ripgrep fallback that is always
  `degraded`), declared in
  [`repo-intel/types.ts`](../../../server/src/modules/repo-intel/types.ts) —
  and has **zero production callers**. Only a degraded-shape test touches it.
- **The reverse index exists and nothing reads it.**
  `file_edges_repo_to_idx` on `(repo_id, to_file)` was created — per the schema
  comment in
  [`db/schema/repo-intel.ts`](../../../server/src/db/schema/repo-intel.ts) —
  precisely so blast can walk "who depends on this file?" in O(degree). No
  query uses it; the only edge reader pulls all edges and walks forward.
- **The MCP tool is a declared stub.**
  [`mcp/src/tools/get-blast-radius.ts`](../../../mcp/src/tools/get-blast-radius.ts)
  is registered with its **final** argument schema (`repo` slug + `pr` number)
  and a handler that always fails with "not implemented yet". Three tests in
  `mcp/test/tools.test.ts` pin that behaviour and must flip when this lands.
- **The strings exist and nothing renders them.**
  [`client/messages/en/blast.json`](../../../client/messages/en/blast.json)
  already carries the stat labels (symbols / callers / endpoints / crons) and
  view-toggle strings.

The second half of the task extends the same review flow *backwards in time*:
today a review can only happen after a PR exists. A `devdigest review --mode
working` CLI runs the **same** Structured Reviewer over the local working tree
before `git push` — reusing the engine and the domain logic, not re-implementing
them.

## Goal

1. Serve a deterministic blast-radius map for a PR — changed symbols, their
   callers, and potentially affected HTTP endpoints / crons — **read entirely
   from the persisted index**, no AST rebuild, no import-graph rebuild, no
   model call on the read path. Degrade visibly (`partial` / `degraded` with a
   reason), never mask missing data with an empty array. Offer a one-paragraph
   model explanation as an **explicit click**, exactly one call, cached at the
   head SHA.
2. Ship a CLI command in the `mcp/` package that collects the working tree's
   diff, sends it to a new server endpoint that runs the same
   `reviewPullRequest` + `countBlockers` path the web UI uses, prints findings
   with severity and `file:line`, and exits with a documented code.

## 1. Scope

**In scope**

- Extensions inside `repo-intel` (the only module allowed to read the index
  tables): per-symbol caller cap, declaration-file exclusion where missing, and
  a 2-level reverse-BFS over `file_edges` feeding endpoint/cron attribution.
- A new `blast` server module: `GET /pulls/:id/blast` (no model) and
  `POST /pulls/:id/blast/summary` (one model call, cached), plus a
  `blast_summary` table.
- A new wire contract `contracts/blast.ts`, applied to **both** vendor copies.
- A `BlastCard` on the PR Overview tab (per the decision taken during design:
  card on Overview, **not** a fourth tab), with clickable `file:line` links and
  a **Tree | Graph** view toggle — the graph laid out with d3 and rendered as
  React-owned SVG over the same response (§3.4).
- The real implementation of the MCP `devdigest_get_blast_radius` tool.
- `POST /reviews/adhoc` in the reviews module: synchronous, stateless review of
  a posted diff via the existing engine.
- The `devdigest review --mode working` CLI in `mcp/`, with `--mode` left open
  for `staged` / `branch` later.
- Seed rows that make the demo PR demonstrate ≥2 real callers and ≥1 endpoint
  with no clone and no model key.

**Out of scope**

- Feeding blast into the review prompt, `PrBrief` (L05), or CI export (L06).
  The unused LLM-facing `BlastRadius` contract in `contracts/brief.ts` is
  **not touched** — it is PR-Brief scaffolding, and its shape (no `file:line`,
  no rank, no status) cannot carry this endpoint's payload.
- Implementing `--mode staged` / `--mode branch`. The mode table exists; both
  return a "not implemented" error with exit code 2.
- Reviewing untracked files in the CLI (decision taken during design: honestly
  excluded — counted, warned about, documented in `--help`).
- Persisting adhoc CLI reviews (no runs, no findings rows, no SSE).
- Symbol-level *edit* detection (which lines of the symbol changed). File-level
  granularity, as the index provides.

## 2. Blast Radius — server

### 2.1 What `repo-intel` gains

All index tables (`symbols`, `references`, `file_edges`, `file_facts`,
`file_rank`) are private to `repo-intel/repository.ts`; a module never imports
another module's repository. So the three gaps in today's implementation are
closed **inside** repo-intel, and the facade signature
`getBlastRadius(repoId, changedFiles)` does not change:

1. **Per-symbol caller cap.** `MAX_CALLERS_PER_SYMBOL = 20` exists in
   [`repo-intel/constants.ts`](../../../server/src/modules/repo-intel/constants.ts)
   but is applied as `callers.slice(0, 20)` — a cap on the *whole list*. It
   becomes a cap per `viaSymbol` group, sorted by `rank` descending inside each
   group, which is what the constant's name already promises.
2. **Declaration-file exclusion.** `getResolvedCallers` already returns
   cross-file callers only (the changed files themselves are excluded as caller
   files). The plan verifies this against the SQL; if any self-file rows leak
   through, they are filtered in `tryPersistentBlast`, not in the new module.
3. **Reverse BFS for endpoint attribution.** A new repository method

   ```
   getReverseDependents(repoId, files, maxDepth = 2): Promise<string[]>
   ```

   walks `file_edges` backwards (`to_file → from_file`) from the changed files,
   breadth-first, bounded at 2 levels, using the existing
   `file_edges_repo_to_idx` index — one query per level, not per file.
   `tryPersistentBlast` then unions `file_facts` over **caller files ∪ reverse
   dependents** instead of caller files alone, so an endpoint two imports away
   from the changed helper is attributed even when the route file never calls
   the changed symbol directly.

`BlastResult` gains two additive fields: `impactedCrons: string[]` (today crons
ride only in `factsByFile` and are never surfaced) and `line` on
`BlastChangedSymbol` (the symbol row already carries it; the UI needs it for
the declaration link). Nothing existing changes shape, so the degraded-shape
test keeps passing unedited.

The ripgrep fallback path is untouched: it exists for unindexed repos, is
always `degraded: true`, and this feature's honest answer there is "the index
is not ready", not a better grep.

### 2.2 The `blast` module

`server/src/modules/blast/` — `routes.ts` (HTTP + zod only), `service.ts`
(composition), `ports.ts` (structural deps, no `db/` import), `repository.ts`
(`blast_summary` only), `model.ts` (the summary call), `helpers.ts`
(pure mapping `BlastResult` → wire contract), `constants.ts`. One import + one
entry in [`modules/index.ts`](../../../server/src/modules/index.ts). The
service is built in a lazy memoised container getter with ports as closures —
the `smart-diff` pattern
([`container.ts`](../../../server/src/platform/container.ts)), never
`constructor(container)` (that is the repo-intel cycle
`server/INSIGHTS.md` 2026-08-02 warns against).

Ports:

- `pull(workspaceId, prId)` → `{ repoId, headSha, fullName } | null` — via
  `container.reviewRepo`, the shared aggregate.
- `prFilePaths(prId)` → `string[]` — the persisted `pr_files` paths. They are
  refreshed by `GET /pulls/:id` on every PR page load, which always precedes a
  blast request in the UI flow; a stale list degrades to a stale map, never an
  error.
- `blastRadius(repoId, files)` → `container.repoIntel.getBlastRadius`.
- `indexState(repoId)` → `container.repoIntel.getIndexState` — for the status
  header.
- `summaryModel` — the bound LLM port (see §2.5).

Both routes call `getContext(container, req)` and scope by `workspaceId`; a PR
in another workspace is a **404, never a 403**.

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/pulls/:id/blast` | **200** `BlastRadiusResponse`. Reads `pr_files` paths, calls the facade, maps to the wire contract, attaches a cached summary whose `head_sha` matches the PR's current head (else `summary: null`). **Never calls a model.** **404** unknown PR / other workspace. **422** non-uuid `:id` |
| `POST` | `/pulls/:id/blast/summary` | **200** `{ summary, head_sha }`. A cached row at the current head returns **with no model call**. Otherwise recomputes the map, makes **exactly one** structured model call, replaces the row wholesale, returns it. **404** unknown PR. **409** while a summary for the same PR is already in flight (in-process `Set`, the `IntentService` pattern). **422** non-uuid, and **422** with code `blast_degraded` when the map's status is `degraded` — explaining a map that says "no data" is a hallucination invitation, so the model is never called for one |

### 2.3 Status derivation — `ok | partial | degraded`

The response always carries `status` and, when not `ok`, a machine `reason`:

| Condition | `status` | `reason` |
|---|---|---|
| Facade returned `degraded: true` (no usable index, ripgrep fallback) | `degraded` | the facade's own reason (`no_data`, …) |
| Index state is `partial`, or `last_indexed_sha` ≠ the PR's `head_sha` | `partial` | `index_partial` / `index_stale` |
| `pr_files` is empty (PR never imported) | `degraded` | `no_files` |
| Changed files yield zero indexed symbols (e.g. docs-only PR) | `ok` | — (an empty map over a full index is a true answer, not a failure) |
| Otherwise | `ok` | — |

The distinction the task requires — *empty because there is nothing* vs *empty
because we cannot see* — is exactly `ok`-with-empty-arrays vs
`partial`/`degraded`, and the client renders them differently (§3).

### 2.4 Wire contract — `contracts/blast.ts`, both copies

New file in `server/src/vendor/shared/contracts/` **and**
`client/src/vendor/shared/contracts/` (the two copies must not drift further):

```
BlastCallerC     { file, line, symbol, rank }            // rank: 0..1 percentile
BlastSymbolC     { name, kind, file, line: int|null,
                   callers: BlastCallerC[],
                   endpoints: string[], crons: string[] } // attributed via factsByFile
BlastRadiusResponseC {
  status: 'ok' | 'partial' | 'degraded',
  reason: string | null,
  head_sha: string,
  changed_symbols: BlastSymbolC[],
  endpoints: string[],                                    // union, "METHOD /path"
  crons: string[],
  summary: string | null,
}
```

`helpers.ts` groups the facade's flat `callers[]` by `viaSymbol` into
`BlastSymbolC.callers`, and attributes each symbol's `endpoints`/`crons` from
`factsByFile` over that symbol's caller files. The top-level `endpoints` /
`crons` are the BFS-widened union — a superset of the per-symbol attributions.

### 2.5 The summary — one cheap call, cached at head

- New table, owned by the blast module's own `repository.ts`:

  ```
  blast_summary
    pr_id      uuid PK, FK pull_requests ON DELETE CASCADE
    head_sha   text
    summary    text
    provider   text
    model      text
    created_at timestamptz
  ```

  A column on `pr_files` is impossible for the same reason `pr_file_summary`
  exists: `GET /pulls/:id` deletes and re-inserts every `pr_files` row per page
  load. `head_sha` is the freshness key; a cached row at an older head is **not
  served** and the next explicit click replaces it. One row per PR — the
  summary describes the map at one head, not a history.
- Migration is additive (one new table), which avoids the interactive
  `db:generate` trap recorded in `server/INSIGHTS.md` 2026-08-03.
- `FeatureModelId` in `contracts/platform.ts` gains a `blast_summary` member
  with a flash-class default, mirroring how `file_summary` was added for
  smart-diff — the module reads the default from the registry, never restates
  it, so Settings shows the model that actually runs. Both vendor copies.
- The prompt is a **feature prompt in code** (`model.ts` + a prompt constant),
  not an agent `system_prompt` — `docs/agent-prompts/` conventions do not
  apply, except the two that always do: output shape enforced by structured
  output (`{ summary: string }`), and every node/edge fed to the model comes
  **verbatim from the computed map** — the prompt instructs the model to
  explain the given nodes and forbids inventing new ones. Input is the wire
  response minus `summary`, serialised and truncated at `MAX_SUMMARY_INPUT_CHARS`
  (8 000) with a truncation marker; output capped at `MAX_SUMMARY_CHARS` (600 —
  one paragraph) before storage.

## 3. Blast Radius — client

### 3.1 `BlastCard` on Overview

`OverviewTab/_components/BlastCard/` — a folder component beside `IntentCard`,
following its four-state model exactly (loading keeps the card footprint;
load-error shows the `ApiError` message + a GET-retry; empty; data), styled the
way its neighbours actually are (inline `CSSProperties` `s` objects — the
2026-08-06 INSIGHTS entry, not the `CLAUDE.md` Tailwind claim). Strings go
through the existing `blast` message block; missing keys are added there.

Rendered states on top of the four:

- `status: 'partial'` — the map renders **plus** a warning line with the
  reason ("index is stale / partial — some callers may be missing").
- `status: 'degraded'` — no fake tree: an explanatory block ("index not
  usable: *reason*") with a link to the repo's index state. Empty arrays never
  render as "0 callers, all clear".
- `status: 'ok'` with zero symbols — the true empty state ("no indexed symbols
  in the changed files").

Content: header counters (symbols / callers / endpoints / crons — the
`blast.json` labels) and the **Tree | Graph** toggle from the same message
block, then the active view. Tree: changed symbol → its callers (`file:line`)
→ endpoint/cron chips, collapsed beyond the first symbol when the list is
long. The toggle is plain local component state, Tree by default — no URL
param; the choice is presentation, not a shareable location. A "Prior PRs
touching these files" row is **not** in this change (mockup content owned by a
later lesson).

### 3.2 Clickable `file:line`

The rules of
[`client/specs/finding-deep-links.md`](../../../client/specs/finding-deep-links.md)
apply verbatim: `githubBlobUrl(fullName, head_sha, file, line)` — SHA-pinned so
the line number stays right; opens in a new tab; when the repo `full_name` is
unknown the row renders as plain text, never a dead link. Callers are usually
*outside* the diff, so the in-app scroll-to-line flow is not an option; the
blob link is the honest target. Dense rows use a plain `<a className="mono">`
(the `FindingRow` precedent), not `MonoLink` with its hardcoded font size.

### 3.3 The Explain button

"Explain" → `useBlastSummary(prId)` mutation → `POST /pulls/:id/blast/summary`
→ the paragraph renders under the tree; the button carries the derive-button
states from `IntentCard` (idle / pending / error inline with `role="alert"`).
When `GET` already returned a cached `summary`, the paragraph is there on load
and the button is **absent** — there is no "Regenerate" at the same head,
because that would be a paid call producing the same cached answer. One click,
one call, and the card never calls the model on its own.

### 3.4 The Graph view

The graph renders the **same response** — no second endpoint, no refetch on
toggle — as a three-column layered DAG in inline SVG:

- **Columns:** changed symbols → callers → endpoints/crons. Every edge in the
  data flows left-to-right (caller → symbol reversed to symbol → caller for
  reading order), so a layered layout is exact, not approximate — there is
  nothing to iterate or force-direct.
- **d3 does the math, React owns the DOM** (decision taken during design: use
  d3). New client deps are the scoped modules only — `d3-scale` (column /
  stacking scales) and `d3-shape` (`linkHorizontal` for the curved edge
  paths), plus their `@types` — **not** the monolithic `d3` bundle, and no
  `d3-selection`: d3 computes positions and path strings inside the pure
  layout helper (`BlastGraph/helpers.ts`); React renders every `<g>`, `<path>`
  and `<a>` itself. Mixing d3's enter/exit DOM mutation with React ownership
  is the classic footgun the react-best-practices split avoids, and a
  helper that returns plain data stays testable in jsdom without rendering.
- **Layout stays layered and deterministic**: columns at fixed x, nodes
  stacked by the tree's own ordering (rank descending) via `scalePoint`/
  `scaleBand`, so the graph and the tree agree on prominence and two renders
  of the same data are identical — no force simulation, nothing iterative.
  Height grows with node count; the card scrolls vertically beyond a cap
  rather than shrinking text. Node counts are bounded by the contract
  (symbols × ≤20 callers + endpoint/cron union), well inside static-SVG
  territory.
- **Nodes are the same links** as the tree rows: caller and symbol nodes wrap
  in SVG `<a>` with the identical SHA-pinned `githubBlobUrl` (plain,
  non-linked nodes when `full_name` is unknown — same rule, one code path for
  building hrefs shared with the tree via the card's helpers). Endpoint/cron
  nodes are not links.
- **Accessibility:** the SVG takes `role="img"` and the existing
  `blast.json` "Blast radius graph" aria label; the toggle buttons are real
  buttons with pressed state. The tree remains the accessible-first view; the
  graph never carries information the tree lacks.
- `partial` / `degraded` / empty states belong to the card, not the view:
  the toggle renders only when there is a map to draw, so the graph needs no
  degraded variant of its own.

### 3.5 Data access

`client/src/lib/hooks/blast.ts`: `useBlastRadius(prId)` on
`["pr-blast", prId]`, `useBlastSummary(prId)` patching the summary into the
cached response via `setQueryData` — the `hooks/intent.ts` shape. New `api.ts`
methods; no `fetch` in components.

## 4. MCP — `devdigest_get_blast_radius` for real

The argument schema (`repo`, `pr`) is final and unchanged. The handler becomes
the standard pipeline: `Args.parse` → `resolveRepo` → `resolvePull` → new
`ApiClient.getBlastRadius(prId)` (`GET /pulls/:id/blast`) → `projectBlastRadius`
in `src/project.ts` → `ok(...)`. The projection is compact: `status` + reason,
per-symbol caller counts with the top callers as `file:line (rank)`, the
endpoint/cron unions, and the cached summary when present — structured for an
agent, no prose padding. Description, title and the "do not call" warning flip
to live wording; `readOnlyHint`/`idempotentHint` stay. The three pinned stub
tests in `mcp/test/tools.test.ts` are rewritten against a fake API payload,
including one `degraded` case asserting the status is passed through, not
laundered into an empty success.

## 5. Working-tree review — server

### 5.1 `POST /reviews/adhoc`

In the existing `reviews` module (it owns the engine's server side), rate
limited like `POST /pulls/:id/review` (10/min):

Body: `{ diff: string, agent?: string }` — `diff` is raw unified-diff text,
capped at `MAX_ADHOC_DIFF_BYTES` (1 MB) → **413** beyond it; empty/whitespace
diff → **422**. `agent` is an agent **name**; unknown name → **404**. Omitted →
the workspace's enabled agent with the earliest `created_at` — deterministic,
documented, and the same agent a fresh seed creates first; no enabled agents →
**409** with a message naming the fix.

Behaviour — the same bricks as `runOneAgent`, composed without the PR-shaped
persistence:

1. `parseUnifiedDiff(body.diff)` — the same parser
   ([`adapters/git/diff-parser.ts`](../../../server/src/adapters/git/diff-parser.ts))
   the PR path uses; a diff that parses to zero files → **422**.
2. `reviewPullRequest({ systemPrompt, model, diff, llm, strategy })` — the
   engine call site identical to
   [`run-executor.ts`](../../../server/src/modules/reviews/run-executor.ts)'s,
   with the PR-context slots (`intent`, `repoMap`, `callers`, `prDescription`)
   simply absent — by the engine's contract an omitted slot renders no section,
   so this is the same reviewer, minus context it cannot have.
3. `countBlockers(kept, agent.ciFailOn)` — the same deterministic gate.
4. Respond **200**:

   ```
   { review, blockers: int, dropped: string[], scope_dropped: string[],
     agent: { name, ci_fail_on }, model, tokens_in, tokens_out, cost_usd }
   ```

Nothing is persisted — no `runs`, no `reviews`, no `findings`, no
`run_traces`; token counts go to the route log. Grounding still applies (the
engine grounds against the posted diff), so a hallucinated `file:line` is
dropped and reported in `dropped`, same as the web flow. A provider failure
propagates to the shared error handler (502 for `ExternalServiceError`, 500
otherwise) — the CLI maps any non-200 to exit 2.

The extraction is deliberately minimal: `runOneAgent` is **not** refactored
into a shared core in this change; the adhoc path composes the same exported
pieces (`parseUnifiedDiff`, `reviewPullRequest`, `countBlockers`). If a later
lesson makes the two paths drift, that is the moment to extract — not before.

## 6. Working-tree review — CLI

### 6.1 Invocation

Lives in `mcp/` (pnpm — the package was switched from npm to pnpm during
design). `package.json` gains `"bin": { "devdigest": "bin/devdigest.mjs" }` — a
small Node wrapper that registers tsx (`tsx/esm/api`) and imports
`src/cli/main.ts`, so the package-manager bin shim works on every OS without
emitting JS. Also `pnpm review` for the no-install path. `.mcp.json` and the MCP server are untouched — the CLI is a
second entry point in the same package, sharing `src/api.ts` (`HttpApiClient`
gains `reviewAdhoc(diff, agent?)`), `src/config.ts` (`DEVDIGEST_API_URL`, same
default `http://localhost:3001`) and `src/errors.ts`.

```
devdigest review --mode working [--agent <name>]
```

`--mode` resolves through a mode table `{ working: collectWorkingDiff }`;
`staged` and `branch` are present in the table's type but map to a "not
implemented in this lesson" error (exit 2), so adding them later is a
one-entry change, not a redesign.

### 6.2 Flow

1. `git rev-parse --show-toplevel` — not a repo → stderr message, **exit 2**.
2. `git diff HEAD` from the repo root — staged + unstaged changes to tracked
   files. This is the *entire* review input.
3. `git ls-files --others --exclude-standard` — untracked files are **counted
   and excluded**: `N untracked file(s) not reviewed (git diff HEAD does not
   see them — stage or commit to include)` on stderr. `--help` states the same
   limitation. (Decision taken during design: honest exclusion over
   `--no-index` synthesis.)
4. Empty diff and zero untracked → `Nothing to review.`, **exit 0**.
5. `POST /reviews/adhoc`. Connection refused → a message naming
   `DEVDIGEST_API_URL` and how to start the server, **exit 2**.
6. Render to stdout: verdict + score line, then one line per finding —
   `SEVERITY  file:start_line[-end_line]  title` — grouped by severity
   descending, followed by `dropped` counts (grounding is not hidden) and the
   blocker total with the agent's `ci_fail_on` threshold named.
7. Exit code — **the contract, printed in `--help`**:
   - `0` — review ran, `blockers === 0` (also the empty-diff case);
   - `1` — review ran, `blockers > 0`;
   - `2` — the review could not run (not a git repo, server unreachable,
     non-200, unknown agent, bad flags).

stdout carries only the review output (parseable by a CI step later); all
diagnostics — untracked warning, progress, errors — go to stderr, the same
discipline `src/main.ts` already applies for the JSON-RPC channel.

## 7. Degradation

| Situation | Behaviour |
|---|---|
| Repo never indexed / index `failed` | `GET /blast` **200** `status: degraded, reason: no_data` — the card explains, the MCP tool passes it through |
| Index `partial` or behind the PR's head | **200** `status: partial`, map served, warning rendered |
| PR not imported (`pr_files` empty) | **200** `status: degraded, reason: no_files` |
| Docs-only / no indexed symbols | **200** `status: ok`, empty arrays, true empty state |
| Summary requested on a degraded map | **422** `blast_degraded`, nothing persisted, no model call |
| Summary provider fails | error propagates; client toasts; nothing persisted |
| Cached summary at an older head | not served; `summary: null`; Explain offered again |
| Adhoc: diff > 1 MB / unparseable / empty | 413 / 422 / 422, no model call |
| Adhoc: no enabled agents | 409 with remediation message |
| CLI: server down | exit 2, message names `DEVDIGEST_API_URL` |
| CLI: untracked files present | reviewed set unchanged; counted warning on stderr |

## 8. Seed

The acceptance demo ("a change to a shared helper shows ≥2 real callers and an
HTTP endpoint") must work on a fresh install, where the seeded
`acme/payments-api` has `clone_path: null` and no index — today the card could
only ever show `degraded`. The seed therefore grows a **minimal index slice**
for the demo repo, consistent with the nine `pr_files` the smart-diff seed
already ships:

- `repo_index_state`: `status: 'full'`, `last_indexed_sha` = the demo PR's
  head SHA, current `indexer_version`.
- `symbols`: `rateLimit` and `bucketKey` declared in
  `src/middleware/ratelimit.ts`.
- `references`: ≥4 resolved callers of `rateLimit` (from
  `src/api/public/index.ts`, `src/api/public/webhooks.ts`,
  `src/api/public/health.ts`, `src/server.ts`) and 2 of `bucketKey`, each with
  a real line number and `decl_file` resolved.
- `file_edges`: the caller files importing the middleware, so the reverse BFS
  has something to walk.
- `file_rank`: percentiles making the caller ordering deterministic.
- `file_facts`: endpoints (`GET /api/public/items`,
  `POST /api/public/webhooks`, `GET /api/public/health`) and the
  `reset-rate-buckets` cron on the files that declare them.

Idempotency follows the smart-diff seed lesson: the slice is written outside
the `if (!pr)` branch and replaces the demo repo's index rows when incomplete,
so previously-seeded databases gain it on the next `pnpm db:seed`.

## 9. Testing

| Suite | File | Covers |
|---|---|---|
| server, hermetic | `test/blast-service.test.ts` | ports stubbed: ok / partial / degraded / no_files status derivation; per-symbol grouping and 20-cap; rank ordering; endpoint attribution incl. BFS union superset; empty-vs-degraded distinction |
| server, hermetic | `test/blast-summary.test.ts` | cache hit at same head = zero model calls; head change re-derives and replaces; degraded map → 422 before any model call; in-flight 409; output cap applied before storage |
| server, DB | `test/repo-intel-reverse-bfs.it.test.ts` | `getReverseDependents` over seeded edges: depth-1, depth-2, cycle safety, depth bound respected |
| server, DB | `test/blast-routes.it.test.ts` | end-to-end over the seeded index slice: the demo PR yields ≥2 callers + ≥1 endpoint; cross-workspace 404; non-uuid 422; **LLM mock recorded zero calls on GET** |
| server, hermetic | `test/reviews-adhoc.test.ts` | mock LLM: 200 shape; blockers via `ciFailOn`; grounding drops reported; empty/oversized/unparseable diff 422/413; unknown agent 404; no-enabled-agents 409; **nothing persisted** (repos spied) |
| client | `BlastCard.test.tsx` | four base states + partial warning + degraded block; per-symbol tree; `file:line` link href SHA-pinned, plain text when `full_name` missing; Explain: one POST, pending, inline error, absent when summary cached; toggle renders graph and back, hidden on degraded/empty |
| client | `BlastGraph.test.tsx` (+ layout helper cases) | layout is deterministic (same input → same positions); three columns in order; node order follows rank; node hrefs identical to the tree's; no links when `full_name` missing; aria label present |
| mcp | `test/tools.test.ts` (rewritten cases) | live tool: resolve → GET → projection; degraded passthrough; API error → `isError` |
| mcp | `test/cli.test.ts` | temp git repo fixtures: diff collection; untracked counted + excluded; empty → exit 0; blockers → exit 1; server down / not a repo → exit 2; stdout/stderr split |

Gates: `cd server && pnpm typecheck && pnpm arch:check` (still exactly the
frozen violation count), `cd client && pnpm typecheck`, `cd mcp && pnpm test`,
plus the touched suites. `server/specs/blast.md` and an update to
`mcp/README.md` (CLI section, exit-code contract) ship with the code —
non-trivial behaviour without a spec is invisible per the package rules.

## 10. Acceptance (mapped to the task's criteria)

| # | Criterion | Covered by |
|---|---|---|
| 1 | Demo PR with a changed shared helper shows ≥2 real callers and ≥1 endpoint | seed §8 + `blast-routes.it.test.ts` |
| 2 | Clicking `file:line` opens the right line | SHA-pinned `githubBlobUrl`, `BlastCard.test.tsx` |
| 3 | No AST / import-graph rebuild at request time | the facade reads only persisted tables; `blast-routes.it.test.ts` runs with no clone present |
| 4 | Clear empty state for absent data | §2.3 `ok`-empty vs `degraded`, `BlastCard.test.tsx` |
| 5 | Distinct `partial` / `degraded` states for an incomplete index | §2.3, `blast-service.test.ts` |
| 6 | Main path calls no LLM; optional summary is exactly one call | GET asserted zero-call; POST single structured call, cached |
| 7 | `get_blast_radius` returns a compact structured result over MCP | §4, `tools.test.ts` |
| 8 | CLI reviews the working tree via the same reviewer + domain logic | §5 composes `parseUnifiedDiff` + `reviewPullRequest` + `countBlockers` — no second implementation |
| 9 | Untracked handling is honest and documented | §6.2 step 3, `--help`, `cli.test.ts` |
| 10 | Predictable exit codes, documented | §6.2 step 7, `cli.test.ts` |
| 11 | Tree \| Graph toggle renders both views over one response, no extra fetch | §3.4, `BlastCard.test.tsx`, `BlastGraph.test.tsx` |

## 11. Deferred, deliberately

Prior-PRs-touching-these-files; blast in the review
prompt / `PrBrief` / CI export; `--mode staged` and `--mode branch`; symbol-level
change detection; a shared extraction of `runOneAgent`'s engine-call core;
reviewing untracked files via `--no-index` synthesis. Each has an obvious seam
left for it and none is needed to make the two features honest.
