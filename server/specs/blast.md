# Spec — Blast Radius: what a change touches, read from the index

**Status:** DONE (2026-08-09)
**Owner:** server · **Consumers:** client, mcp
**Design:** [`docs/superpowers/specs/2026-08-09-blast-radius-and-working-review-design.md`](../../docs/superpowers/specs/2026-08-09-blast-radius-and-working-review-design.md)
**Plan:** [`docs/superpowers/plans/2026-08-09-blast-radius-and-working-review.md`](../../docs/superpowers/plans/2026-08-09-blast-radius-and-working-review.md)
**Related:** `contracts/blast.ts` (`BlastStatus`, `BlastCallerC`, `BlastSymbolC`,
`BlastRadiusResponse`, `BlastSummaryResponse`), `contracts/platform.ts`
(`FeatureModelId`, `FEATURE_MODELS`), `server/specs/smart-diff.md` (the sibling
per-PR derived artifact, same cache-at-head shape), `client/specs/finding-deep-links.md`
(the `file:line` linking rules this feature reuses)

A reviewer looking at a diff can see what changed; they cannot see what the
change *touches*. "Who calls this helper, and which endpoints sit downstream?"
was answered by grepping, or not at all — while `RepoIntel.getBlastRadius` had
been fully implemented with zero production callers and
`file_edges_repo_to_idx` had been created for exactly this walk with no query
reading it. This module serves that map from the persisted index: no AST
rebuild, no import-graph rebuild, and no model call on the read path. It
degrades **visibly** — an empty map says whether it is empty because there is
nothing, or because we could not see.

## 1. Scope

**In scope**

- Extensions inside `repo-intel` (the only module allowed to read the index
  tables): per-symbol caller cap, declaration-file exclusion, and a 2-level
  reverse BFS over `file_edges` feeding endpoint/cron attribution.
- The `blast` module: `GET /pulls/:id/blast` (no model) and
  `POST /pulls/:id/blast/summary` (one model call, cached).
- The `blast_summary` table.
- A new wire contract `contracts/blast.ts`, applied to **both** vendor copies.

**Out of scope**

- Feeding blast into the review prompt, `PrBrief` (L05), or CI export (L06).
  The unused LLM-facing `BlastRadius` in `contracts/brief.ts` is **not touched**
  — it is PR-Brief scaffolding, and its shape (no `file:line`, no rank, no
  status) cannot carry this endpoint's payload.
- Symbol-level *edit* detection (which lines of a symbol changed). File-level
  granularity, as the index provides.
- "Prior PRs touching these files" — mockup content owned by a later lesson.

## 2. Contract

The Zod definitions in `src/vendor/shared/contracts/blast.ts` are the source of
truth, and `@devdigest/shared` is **two physical copies** — this file landed
byte-identically in the client's copy.

| Contract | Shape |
|---|---|
| `BlastStatus` | closed enum `ok \| partial \| degraded` ([`contracts/blast.ts:21`](../src/vendor/shared/contracts/blast.ts)) |
| `BlastCallerC` | `{ file, line, symbol, rank }` — `symbol` is the **enclosing** symbol at the call site, not the one called; `rank` is the caller file's `file_rank` percentile, 0..1 ([`blast.ts:25-34`](../src/vendor/shared/contracts/blast.ts)) |
| `BlastSymbolC` | `{ name, kind, file, line: int\|null, callers, endpoints, crons }` ([`blast.ts:37-51`](../src/vendor/shared/contracts/blast.ts)) |
| `BlastRadiusResponse` | `{ status, reason: string\|null, head_sha, changed_symbols, endpoints, crons, summary: string\|null }` ([`blast.ts:53-67`](../src/vendor/shared/contracts/blast.ts)) |
| `BlastSummaryResponse` | `{ summary, head_sha }` ([`blast.ts:69-74`](../src/vendor/shared/contracts/blast.ts)) |
| `FeatureModelId` + `FEATURE_MODELS` | gained a `blast_summary` member and registry entry, flash-class default (`openrouter` / `google/gemini-2.5-flash-lite`) ([`contracts/platform.ts:22`](../src/vendor/shared/contracts/platform.ts), [`platform.ts:95-103`](../src/vendor/shared/contracts/platform.ts)) |

`reason` is **nullable, never optional**: a producer that omits it is a bug the
schema should catch, and `null` is the affirmative statement "there is nothing
wrong". It is null if and only if `status === 'ok'`.

`line` on `BlastSymbolC` is nullable because `symbols.line` is a nullable
column ([`db/schema/context.ts:71`](../src/db/schema/context.ts)), not because
the field is optional in the response.

The registry is **three** physical copies, not two: both vendored `shared`
trees plus [`client/src/lib/feature-models.ts`](../../client/src/lib/feature-models.ts),
which exists because the client can only import *types* from the vendored
package (importing a runtime value pulls `vendor/shared/index.ts` into the
webpack bundle). All three carry the `blast_summary` entry.

Schema: `blast_summary` — `pr_id` (PK, FK `pull_requests`, cascade),
`head_sha`, `summary`, `provider`, `model`, `created_at`
([`db/schema/reviews.ts:123-144`](../src/db/schema/reviews.ts)). One row per
PR: the summary describes the map at one head, not a history. It cannot be a
column on `pr_files` for the same reason `pr_file_summary` is its own table —
`GET /pulls/:id` deletes and re-inserts every `pr_files` row on each request.

### Endpoints

Both call `getContext(container, req)` and scope by `workspaceId`
([`modules/blast/routes.ts:23,31`](../src/modules/blast/routes.ts)). A PR in
another workspace is a **404, never a 403**.

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/pulls/:id/blast` | **200** `BlastRadiusResponse`. Reads `pr_files` paths, calls the repo-intel facade, maps to the wire contract, attaches a cached summary whose `head_sha` matches the PR's current head (else `summary: null`). **Never calls a model on any path.** **404** unknown PR or another workspace's ([`service.ts:41`](../src/modules/blast/service.ts)). **422** non-uuid `:id` |
| `POST` | `/pulls/:id/blast/summary` | no body. **200** `BlastSummaryResponse`. A cached row at the current head returns **with no model call and without even resolving the model** ([`service.ts:56-59`](../src/modules/blast/service.ts)). Otherwise recomputes the map, makes **exactly one** structured call, replaces the row wholesale. **404** unknown PR. **409** (`conflict`) while a summary for the same PR is already in flight. **422** non-uuid `:id`, and **422** with code `blast_degraded` when the map's status is `degraded`. A provider failure propagates to the shared error handler |

The POST takes **no body**: the map to explain is whatever the PR's current
head yields, never caller-supplied. There is no "Regenerate" at the same head —
that would be a paid call producing the cached answer.

The in-flight guard is an in-process `Set` keyed by `prId`
([`service.ts:22,73-77`](../src/modules/blast/service.ts)), like
`SmartDiffService`'s and `RunBus`'s cancel set — it does not survive a restart,
and the cost of that is one duplicate summary. It is released in a `finally`,
so a failed derivation does not leave the PR stuck at 409.

## 3. Behaviour

### 3.1 What `repo-intel` gained

All index tables (`symbols`, `references`, `file_edges`, `file_facts`,
`file_rank`) are private to `repo-intel/repository.ts` — a module never imports
another module's repository — so all three gaps were closed **inside**
repo-intel and the facade signature `getBlastRadius(repoId, changedFiles)` did
not change.

1. **Per-symbol caller cap.** `MAX_CALLERS_PER_SYMBOL` (20) was applied as
   `callers.slice(0, 20)` over the flat rank-sorted list — a cap on the whole
   result rather than what the constant's name promises. A PR touching one hot
   symbol and one cold one therefore returned twenty callers of the hot one and
   **zero** of the cold one, which reads as "nothing calls it". It is now a cap
   per `viaSymbol` group ([`repo-intel/service.ts:378-386`](../src/modules/repo-intel/service.ts)).
2. **Declaration-file exclusion.** `getResolvedCallers` filtered by `decl_file`
   and `to_symbol` but never excluded the declaration files themselves, so a
   recursive call or a re-export inside the changed file came back as its own
   caller. One predicate closes it — `ne(references.fromPath,
   references.declFile)`, compared **column to column**
   ([`repo-intel/repository.ts:527-540`](../src/modules/repo-intel/repository.ts)).

   > Not `notInArray(fromPath, declFiles)`, which is what this looked like at
   > first. `declFiles` is the PR's whole changed-file list, so excluding it
   > drops every caller that the PR *also* touches — on the seeded nine-file
   > demo PR that took `rateLimit` from four callers to one. Only `decl_file`
   > names the file that actually declares the symbol. Recorded in
   > [`INSIGHTS.md`](../INSIGHTS.md).

3. **Reverse BFS.** `getReverseDependents(repoId, files, maxDepth = BLAST_BFS_DEPTH)`
   ([`repository.ts:551-587`](../src/modules/repo-intel/repository.ts)) is the
   first reader of `file_edges_repo_to_idx`. Breadth-first, **one query per
   level** (never per file), inputs pre-seeded into the visited set so they are
   never their own dependents and cycles terminate, sorted output so the same
   graph always yields the same array. `tryPersistentBlast` then unions
   `file_facts` over **changed files ∪ caller files ∪ reverse dependents**
   ([`service.ts:394`](../src/modules/repo-intel/service.ts)), so an endpoint two
   imports above the changed helper is attributed even though the route file
   never names the changed symbol — and a changed file that declares an endpoint
   or cron of its own is attributed too. The changed files have to be added back
   explicitly because the BFS excludes its own inputs by contract.

`BlastResult` gained two additive fields — `impactedCrons` (crons rode only in
`factsByFile` and were never surfaced) and `line` on `BlastChangedSymbol`.
Nothing existing changed shape, so the degraded-contract test keeps passing
unedited.

The ripgrep fallback is untouched: it exists for unindexed repos, is always
`degraded: true`, and returns `impactedCrons: []` because it never extracted
crons — saying so beats implying a repo has none.

### 3.2 Status derivation

The one decision this module exists to make, in
[`helpers.ts:24-53`](../src/modules/blast/helpers.ts):

| Condition | `status` | `reason` |
|---|---|---|
| Facade returned `degraded: true` (no usable index, ripgrep fallback) | `degraded` | the facade's own reason (`no_data`, …) |
| `pr_files` is empty (PR never imported) | `degraded` | `no_files` |
| Index state is `partial` | `partial` | `index_partial` |
| `last_indexed_sha` ≠ the PR's `head_sha` | `partial` | `index_stale` |
| Otherwise, including zero symbols over a full index | `ok` | `null` |

Order matters. The facade's verdict wins over index metadata: if it fell back
to ripgrep, no amount of `repo_index_state` makes its arrays mean anything. And
`partial` **serves the map** with a warning rather than blanking it —
downgrading a real-but-incomplete map to an empty `ok` is the one thing this
feature exists to prevent.

The `no_files` case short-circuits **before** repo-intel is called at all
([`service.ts:52`](../src/modules/blast/service.ts)): asking the facade about
zero changed files would answer a repo-wide question nobody asked.

### 3.3 Grouping and attribution

The facade hands back one flat `callers[]` tagged with `viaSymbol`; the wire
groups it under the symbol each caller reaches
([`helpers.ts:55-93`](../src/modules/blast/helpers.ts)). Order inside a group is
preserved, which is rank-descending — the facade sorted it that way, so the
tree and the graph agree on prominence.

Per-symbol `endpoints`/`crons` come from `factsByFile` over **that symbol's own
caller files**; the top-level unions are the BFS-widened set. The per-symbol
lists are therefore a strict subset, which is deliberate: the card can say
"this symbol reaches that endpoint" without overclaiming, while the header
counters still show everything the change can touch.

### 3.4 The summary prompt

A **feature prompt in code** ([`modules/blast/prompt.ts`](../src/modules/blast/prompt.ts)),
like smart-diff's — not an agent `system_prompt`, so
[`docs/agent-prompts/`](../../docs/agent-prompts/) conventions do not apply,
except the two that always do. The output shape is enforced out of band by
structured output (`{ summary: string }`), and the map is wrapped
`wrapUntrusted('blast-map', …)` with only the fixed instruction outside the
wrap: the map is built from repository file paths and symbol names, which a PR
author fully controls.

The instruction forbids naming any file, symbol, endpoint or job that does not
appear in the map. Everything the card shows is computed from the index, so a
summary inventing a filename would be the one part of this feature that
hallucinates. Input is the wire response minus `summary`, truncated at
`MAX_SUMMARY_INPUT_CHARS` (8 000) with a `…[truncated N chars]` marker so a cut
map cannot read as a complete one; output is capped at `MAX_SUMMARY_CHARS`
(600) **before** storage.

The model is the workspace's Settings choice for `blast_summary`
([`repository.ts:52-68`](../src/modules/blast/repository.ts)), falling back to
the `blast_summary` entry in `FEATURE_MODELS`, read from the registry and never
restated locally ([`container.ts:63-68`](../src/platform/container.ts)) —
Settings can never advertise one model while another runs
(INSIGHTS 2026-08-03).

## 4. Degradation

The house rule: degrade visibly, never fail the read.

| Situation | Behaviour |
|---|---|
| Repo never indexed / index `failed` | **200** `status: degraded, reason: no_data` — the card explains, the MCP tool passes it through |
| Index `partial` or behind the PR's head | **200** `status: partial`, map served, warning rendered |
| PR not imported (`pr_files` empty) | **200** `status: degraded, reason: no_files`, repo-intel never called |
| Docs-only PR / no indexed symbols | **200** `status: ok`, empty arrays — a true empty, not a failure |
| Summary requested on a degraded map | **422** `blast_degraded`, nothing persisted, **no model call and no model resolution** |
| Summary provider fails | error propagates; nothing persisted; the in-flight guard is released so a retry is not stuck at 409 |
| Cached summary at an older head | not served; `summary: null`; Explain offered again |
| A summary is already in flight for this PR | **409** `conflict` |
| PR in another workspace | 404 on both routes |

## 5. Acceptance

| # | Item | Covered by |
|---|---|---|
| 1 | A changed shared helper shows ≥2 real callers and ≥1 endpoint | [`blast-routes.it.test.ts`](../test/blast-routes.it.test.ts) ("resolves real callers", "unions endpoints and crons") |
| 2 | No AST or import-graph rebuild at request time | `blast-routes.it.test.ts` runs with **no clone on disk** — every fixture is a persisted index row |
| 3 | The read path calls no LLM | `blast-routes.it.test.ts` asserts the `MockLLMProvider` call count is unchanged across every GET, and `blast-service.test.ts` gives the service a `model` dep that throws if resolved |
| 4 | Empty-because-nothing vs empty-because-blind are distinct | [`blast-service.test.ts`](../test/blast-service.test.ts) ("zero symbols over a full index is ok-and-empty, not degraded" vs the degraded cases) |
| 5 | `partial` and `degraded` are distinct, and `partial` still serves the map | `blast-service.test.ts` ("a partial index serves the map", "an index built at another commit is partial/index_stale") |
| 6 | The optional summary is exactly one call, cached at the head | [`blast-summary.test.ts`](../test/blast-summary.test.ts) + `blast-routes.it.test.ts` ("derives once, caches, and serves the cached value") |
| 7 | A degraded map is never explained | `blast-summary.test.ts` ("refuses a degraded map … before any model call" — asserts model *resolutions* is 0, not just calls) |
| 8 | The reverse BFS is bounded, cycle-safe and deterministic | [`repo-intel-reverse-bfs.it.test.ts`](../test/repo-intel-reverse-bfs.it.test.ts) |
| 9 | A self-file reference is not a caller | `repo-intel-reverse-bfs.it.test.ts` + `blast-routes.it.test.ts` ("never reports a reference from the declaration file itself") |
| 10 | The per-symbol cap does not erase a cold symbol's callers | [`repo-intel-blast.test.ts`](../test/repo-intel-blast.test.ts) ("caps each viaSymbol group … not the flat list") |
| 11 | Both vendor copies of the contract agree; both packages type-check | [`test/contracts.test.ts`](../test/contracts.test.ts) + the typecheck gates |
| 12 | A caller that is *also* a changed file is still reported | `repo-intel-reverse-bfs.it.test.ts` ("keeps a caller that is itself one of the changed files") — the §3.1 regression |
| 13 | A changed file's own endpoints and crons are attributed | `repo-intel-blast.test.ts` ("attributes a changed file's own endpoints and crons") + the seeded demo's cron, which only the depth-2 hop reaches |

Client-side coverage for the display rules — SHA-pinned links, plain text when
`full_name` is unknown, the four card states, the Explain button's absence once
a summary exists, and the Tree|Graph toggle costing no request — lives in
`client/.../BlastCard/BlastCard.test.tsx` and `.../BlastGraph/BlastGraph.test.tsx`.
The MCP tool's degraded-passthrough is `mcp/test/tools.test.ts`.

No e2e flow ships for this card. The existing `e2e/` runner has a known
Windows defect recorded against the smart-diff work, and the acceptance items
above are all covered hermetically or against a real database — so this is a
deliberate gap, not an oversight.

## 6. Known gaps

- **`getReverseDependents` runs on every GET, uncached.** Two queries at depth
  2, both index-served, so it is cheap — but a hub file changed in a PR can
  have a wide level-1 frontier, and nothing bounds the frontier's *width* (only
  its depth). If a repo ever shows a slow blast read, that is the first place
  to look.
- **The map is recomputed on the POST path** even when the only thing that
  changed is that the user clicked Explain — `summarize()` calls `computeMap`
  again rather than accepting the map the client already has. That is
  deliberate (trusting a client-supplied map would let the caller choose what
  the model explains), but it does mean an Explain click costs the read work
  twice.
- **`status: 'partial'` collapses two different situations** — an incomplete
  index and a complete index at the wrong commit — into one status with
  different `reason`s. The client renders one warning for both. If they ever
  need different remediation copy, `reason` already carries the distinction.
