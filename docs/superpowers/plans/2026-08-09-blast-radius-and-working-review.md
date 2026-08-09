# Blast Radius + `devdigest review --mode working` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a blast-radius map for a PR from the existing repo-intel index (server endpoint + Overview card with Tree|Graph views + real MCP tool), and add a CLI that reviews the local working tree through the same Structured Reviewer via a new stateless server endpoint.

**Architecture:** All blast facts come from `container.repoIntel.getBlastRadius` (already implemented, zero consumers) — a new thin `blast` module maps them to a wire contract with an `ok|partial|degraded` status and owns the one optional LLM summary, cached in a new `blast_summary` table by `head_sha`. The CLI lives in `mcp/`, collects `git diff HEAD`, and POSTs it to `POST /reviews/adhoc`, which composes the same exported bricks the PR path uses (`parseUnifiedDiff` → `reviewPullRequest` → `countBlockers`) with no persistence.

**Tech Stack:** Fastify + Drizzle + Zod (server), React + TanStack Query + next-intl + d3-scale/d3-shape (client), MCP SDK + tsx (mcp), reviewer-core engine.

**Spec:** `docs/superpowers/specs/2026-08-09-blast-radius-and-working-review-design.md` — read it before starting; acceptance table §10 is the definition of done.

## Global Constraints

- Package managers differ: `server/`, `client/` **and `mcp/`** use **pnpm** (mcp was switched from npm during design — its lockfile is `pnpm-lock.yaml`); `reviewer-core/` and `e2e/` use **npm**. Never run the wrong one (it writes a second lockfile).
- `@devdigest/shared` is **two physical copies**: `server/src/vendor/shared/` and `client/src/vendor/shared/`. Every contract edit lands in **both**, and both packages must typecheck.
- `pnpm arch:check` (in `server/`) must keep reporting exactly the frozen violation count — never regenerate `.dependency-cruiser-known-violations.json`.
- No raw Drizzle outside a module's `repository.ts`; a module never imports another module's `repository.ts`; services take a `Deps`/ports object, **never** `Container`.
- No `response:` schemas on routes (repo convention — responses typed by handler return type only).
- Client: components under `pulls/[number]/_components/` style with inline `CSSProperties` `s` objects (NOT Tailwind, despite client CLAUDE.md); no `data-testid`; tests use `fireEvent` (no user-event); every data access goes hook → `api` (no `fetch` in components).
- Migrations: change `src/db/schema/*.ts`, run `pnpm db:generate`, commit the SQL. Never edit an applied migration. Migration must be additive-only (one new table) to avoid the interactive `db:generate` prompt trap.
- MCP tool registry invariants (pinned in `mcp/test/tools.test.ts:16-33`): tool names start `devdigest_`, ≤6 input args, description length > 80.
- CLI/MCP: stdout is machine-readable output only; all diagnostics to stderr.
- Conventional commits with scope; commit per task; do not commit to `main` (work stays on `feat/blast-radius`).
- Verification is batched at task end: run the touched package's typecheck + the task's suite **once per task**, not between steps.

---

### Task 1: Wire contract + feature-model registry (both shared copies)

**Files:**
- Create: `server/src/vendor/shared/contracts/blast.ts`
- Create: `client/src/vendor/shared/contracts/blast.ts` (identical content)
- Modify: `server/src/vendor/shared/contracts/platform.ts` (+ same edit in `client/src/vendor/shared/contracts/platform.ts`) — extend `FeatureModelId` enum and `FEATURE_MODELS`
- Modify: both copies' contracts barrel (find the file that re-exports `./contracts/brief` — likely `index.ts` — and add `./contracts/blast`)
- Test: `server/test/contracts.test.ts` (add cases)

**Interfaces (produces — later tasks import these exact names from `@devdigest/shared`):**

```ts
// contracts/blast.ts — zod, snake_case wire fields, mirroring brief.ts style
export const BlastStatus = z.enum(['ok', 'partial', 'degraded']);
export const BlastCallerC = z.object({
  file: z.string(), line: z.number().int(), symbol: z.string(),
  rank: z.number(),                     // 0..1 percentile from file_rank
});
export const BlastSymbolC = z.object({
  name: z.string(), kind: z.string(), file: z.string(),
  line: z.number().int().nullable(),
  callers: z.array(BlastCallerC),       // ≤20, rank-descending
  endpoints: z.array(z.string()),       // attributed via this symbol's caller files
  crons: z.array(z.string()),
});
export const BlastRadiusResponse = z.object({
  status: BlastStatus,
  reason: z.string().nullable(),        // null iff status === 'ok'
  head_sha: z.string(),
  changed_symbols: z.array(BlastSymbolC),
  endpoints: z.array(z.string()),       // BFS-widened union, "METHOD /path"
  crons: z.array(z.string()),
  summary: z.string().nullable(),
});
export type BlastStatus / BlastCallerC / BlastSymbolC / BlastRadiusResponse (z.infer exports)
```

`FeatureModelId` gains `'blast_summary'`; `FEATURE_MODELS` gains (copy the `file_summary` entry shape at `platform.ts:45+` verbatim as template):
`{ id: 'blast_summary', label: 'PR Review · Blast summary', description: 'Explains the blast-radius map in one paragraph, on demand.', defaultProvider: 'openrouter', defaultModel: 'google/gemini-2.5-flash-lite' }`.

**Do NOT touch** `contracts/brief.ts` (`BlastRadius` there is PR-Brief scaffolding).

- [ ] **Step 1:** Add failing round-trip cases to `server/test/contracts.test.ts`: (a) a full `BlastRadiusResponse` sample parses and round-trips; (b) `status: 'ok'` with empty arrays parses; (c) `FeatureModelId.parse('blast_summary')` succeeds and `FEATURE_MODELS.find(f => f.id === 'blast_summary')` is defined with the default provider/model above.
- [ ] **Step 2:** Create `contracts/blast.ts` in the server copy; wire the barrel export; append the enum member + registry entry in `platform.ts`.
- [ ] **Step 3:** Mirror both files byte-identically into the client copy (`client/src/vendor/shared/contracts/`), including its barrel and `platform.ts`.
- [ ] **Step 4:** Verify (batched): `cd server && pnpm exec vitest run test/contracts.test.ts && pnpm typecheck`, then `cd client && pnpm typecheck`.
- [ ] **Step 5:** Commit: `feat(shared): add blast wire contract and blast_summary feature model`

---

### Task 2: repo-intel repository — decl-file exclusion + reverse BFS

**Files:**
- Modify: `server/src/modules/repo-intel/repository.ts` (`getResolvedCallers` at :503; new method)
- Modify: `server/src/modules/repo-intel/constants.ts` (add `BLAST_BFS_DEPTH = 2`)
- Test: `server/test/repo-intel-reverse-bfs.it.test.ts` (new, DB-backed)

**Interfaces:**
- Consumes: existing `fileEdges` schema (`from_path`/importer → `to_file`/imported; reverse index `file_edges_repo_to_idx (repo_id, to_file)`), `t.references`.
- Produces:
  ```ts
  // repository.ts
  async getReverseDependents(repoId: string, files: string[], maxDepth = BLAST_BFS_DEPTH): Promise<string[]>
  // returns files that (transitively, ≤maxDepth) import any of `files`,
  // EXCLUDING the input files themselves; cycle-safe; deterministic order (sorted).
  ```
- `getResolvedCallers` gains one predicate: `notInArray(t.references.fromPath, declFiles)` in the existing `and(...)` — verification confirmed self-file references currently leak through as callers.

**Behaviour contract for the BFS:** iterative, one query per level (`select fromPath from fileEdges where repoId = ? and toFile in (<frontier>)`), visited-set dedup, frontier = newly discovered files only. Level 1 = direct importers of the changed files; level 2 = importers of those. No recursion, no per-file queries.

- [ ] **Step 1:** Write the failing it-test. Seed inside the test (pattern: any existing `*.it.test.ts` using `test/helpers/pg.ts`) a repo row + `file_edges` rows forming: `a.ts ← b.ts ← c.ts ← d.ts` (arrows = imports) plus a cycle `x.ts ↔ y.ts` where `x.ts` imports `a.ts`'s file. Cases: depth-1 from `[a.ts]` yields `[b.ts, x.ts, y.ts?]` — assert exact sorted arrays for depth 1 and depth 2 (`c.ts` appears at depth 2, `d.ts` never); input files excluded; cycle terminates. Plus a `getResolvedCallers` case: a reference row whose `fromPath` is itself a decl file is no longer returned.
- [ ] **Step 2:** Implement the predicate and `getReverseDependents`.
- [ ] **Step 3:** Verify (batched): `cd server && pnpm exec vitest run test/repo-intel-reverse-bfs.it.test.ts && pnpm typecheck` (needs Docker; the suite self-skips without it — run with Docker up).
- [ ] **Step 4:** Commit: `feat(repo-intel): reverse-dependency BFS and self-file caller exclusion`

---

### Task 3: repo-intel service — per-symbol cap, BFS union, crons, symbol line

**Files:**
- Modify: `server/src/modules/repo-intel/types.ts` (additive fields)
- Modify: `server/src/modules/repo-intel/service.ts` (`tryPersistentBlast` :315-391, degraded path :~300)
- Test: `server/test/repo-intel-facade-degraded.test.ts` (extend), new hermetic cases if the file's harness allows stubbing the repository — otherwise extend `server/test/repo-intel-rank-map.test.ts`'s pattern into a new `server/test/repo-intel-blast.test.ts`

**Interfaces:**
- Produces (additive to `BlastResult` in `types.ts:74-87` — nothing existing changes shape):
  ```ts
  export interface BlastChangedSymbol { file: string; name: string; kind: string; line?: number }  // + line
  export interface BlastResult { /* existing */; impactedCrons: string[] }                          // + impactedCrons
  ```
- Facade signature `getBlastRadius(repoId, changedFiles)` unchanged.

**Behaviour contract (in `tryPersistentBlast`):**
1. `changedSymbols` entries carry `line` from the symbol row (`getSymbolRows` rows already have it — verify the row type field name and use it).
2. Caller cap becomes **per `viaSymbol`**: group the deduped callers by `viaSymbol`, sort each group by `rank` desc, keep ≤`MAX_CALLERS_PER_SYMBOL` per group; the flat `callers` array is the concatenation (replaces the current global `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` at :386).
3. `const dependents = await this.repo.getReverseDependents(repoId, changedFiles)`; facts are fetched over `union(callerFiles, dependents)` instead of `callerFiles` alone; `impactedEndpoints` and new `impactedCrons` are the unions over that widened set; `factsByFile` covers the widened set.
4. The ripgrep/degraded path returns `impactedCrons: []` (it never extracted crons — stay honest).

- [ ] **Step 1:** Write failing tests: (a) with a stubbed repository returning 25 callers for symbol A and 3 for symbol B, the result keeps 20 for A (rank-desc) and 3 for B; (b) facts from a depth-2 dependent file appear in `impactedEndpoints`/`impactedCrons` even when that file has no direct reference row; (c) `changedSymbols[].line` populated; (d) degraded path result has `impactedCrons: []`.
- [ ] **Step 2:** Implement types + service changes.
- [ ] **Step 3:** Verify (batched): `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck` (full hermetic lane — this touches a shared facade).
- [ ] **Step 4:** Commit: `feat(repo-intel): per-symbol caller cap, BFS-widened facts, crons in blast result`

---

### Task 4: `blast_summary` table + migration

**Files:**
- Modify: `server/src/db/schema/reviews.ts` (per-PR derived artifacts live here — `prIntent`, `prFileSummary` are the neighbours; copy the `prFileSummary` definition at `reviews.ts:106-121` as the template)
- Modify: `server/src/db/schema.ts` (all **three** places: `export * from` already covers reviews; add the named import at :32 and the `schema` object member at :64)
- Create: generated SQL under `server/src/db/migrations/` via `pnpm db:generate`

**Interfaces (produces):**
```ts
export const blastSummary = pgTable('blast_summary', {
  prId: uuid('pr_id').primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  headSha: text('head_sha').notNull(),   // cache key — one row per PR, latest head only
  summary: text('summary').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  createdAt: now(),
});
```

- [ ] **Step 1:** Add the table + barrel wiring; run `cd server && pnpm db:generate`; inspect the generated SQL (must be a single additive `CREATE TABLE`).
- [ ] **Step 2:** Apply locally: `pnpm db:migrate` (Docker Postgres up). Verify: `pnpm typecheck`.
- [ ] **Step 3:** Commit (schema + generated SQL together): `feat(db): add blast_summary table`

---

### Task 5: blast module — ports, mapping, status derivation, `get()`

**Files:**
- Create: `server/src/modules/blast/ports.ts`, `helpers.ts`, `service.ts`, `constants.ts`
- Test: `server/test/blast-service.test.ts` (hermetic, stub ports)

**Interfaces:**
- Consumes: `BlastRadiusResponse` from Task 1; the `BlastResult`/`IndexState` **shapes** from Task 3 — declared *structurally* in `ports.ts` (mirror the fields; do NOT import `modules/repo-intel/types.ts` — the smart-diff `domain.ts` precedent, keeps the container closure assignable and the module decoupled).
- Produces:
  ```ts
  // ports.ts
  export interface BlastPullHead { id: string; repoId: string; headSha: string }
  export interface BlastStorePort {
    getPull(workspaceId: string, prId: string): Promise<BlastPullHead | undefined>;
    getPrFilePaths(prId: string): Promise<string[]>;
  }
  export interface BlastIntelPort {
    blastRadius(repoId: string, files: string[]): Promise<BlastResultShape>;   // structural mirror
    indexState(repoId: string): Promise<IndexStateShape>;                      // structural mirror
  }
  export interface BlastSummaryPort {      // implemented in Task 6's repository
    get(prId: string): Promise<{ headSha: string; summary: string } | undefined>;
    put(row: { prId: string; headSha: string; summary: string; provider: string; model: string }): Promise<void>;
  }
  export interface BlastSummaryModelPort {   // declared here so Deps compiles; implemented in Task 6
    readonly provider: string; readonly model: string;
    explain(mapJson: string): Promise<{ summary: string }>;
  }
  export interface BlastServiceDeps {
    store: BlastStorePort; intel: BlastIntelPort; summaries: BlastSummaryPort;
    model: (workspaceId: string) => Promise<BlastSummaryModelPort>;
    log?: { warn(obj: unknown, msg?: string): void };
  }
  // service.ts
  export class BlastService {
    constructor(private deps: BlastServiceDeps) {}
    async get(workspaceId: string, prId: string): Promise<BlastRadiusResponse>   // throws NotFoundError on unknown PR
    async summarize(workspaceId: string, prId: string): Promise<{ summary: string; head_sha: string }>  // Task 6
  }
  // helpers.ts — pure
  export function toWire(result: BlastResultShape, state: IndexStateShape | { degraded: true },
                         headSha: string, summary: string | null): BlastRadiusResponse
  ```
- Status derivation in `toWire` — the spec §2.3 table verbatim:
  - facade `degraded: true` → `status: 'degraded'`, `reason` = facade reason (`no_data` fallback);
  - zero changed files (service short-circuits before the facade) → `'degraded'`, `reason: 'no_files'`;
  - index state `status === 'partial'` **or** `state.lastIndexedSha !== headSha` → `'partial'`, `reason: 'index_partial' | 'index_stale'`;
  - otherwise `'ok'`, `reason: null` — including zero symbols over a full index (true empty).
- Grouping in `helpers.ts`: facade's flat `callers[]` (each `{file, symbol, viaSymbol, line, rank}`) grouped by `viaSymbol` into `BlastSymbolC.callers` (`symbol` field = the *enclosing* caller symbol); per-symbol `endpoints`/`crons` from `factsByFile` over that symbol's caller files; top-level `endpoints`/`crons` = the facade's widened unions (already BFS-widened by Task 3 — a superset of per-symbol attributions).

- [ ] **Step 1:** Write failing `blast-service.test.ts` with stubbed ports: (a) full index + matching sha → `ok`, grouped symbols, per-symbol endpoints ⊆ top-level; (b) `partial` state → `status partial/index_partial`; (c) state sha ≠ headSha → `partial/index_stale`; (d) facade degraded → `degraded` + reason passthrough; (e) empty `getPrFilePaths` → `degraded/no_files` **and the intel port was never called**; (f) full index, zero symbols → `ok` with empty arrays; (g) unknown PR → `NotFoundError`; (h) cached summary at matching head attached, at stale head → `summary: null`.
- [ ] **Step 2:** Implement `ports.ts`, `constants.ts`, `helpers.ts`, `service.get()` (leave `summarize` throwing `new Error('not implemented')` until Task 6).
- [ ] **Step 3:** Verify (batched): `cd server && pnpm exec vitest run test/blast-service.test.ts && pnpm typecheck`.
- [ ] **Step 4:** Commit: `feat(blast): blast service with status derivation and wire mapping`

---

### Task 6: blast summary — prompt, model, repository, `summarize()`

**Files:**
- Create: `server/src/modules/blast/prompt.ts`, `model.ts`, `repository.ts`
- Modify: `server/src/modules/blast/service.ts` (implement `summarize`), `constants.ts`
- Test: `server/test/blast-summary.test.ts` (hermetic)

**Interfaces:**
- Consumes: `blastSummary` table (Task 4), `wrapUntrusted` from `@devdigest/reviewer-core`, `LLMProvider.completeStructured`.
- Produces:
  ```ts
  // (BlastSummaryModelPort is already declared in ports.ts by Task 5 — implement it here)
  // model.ts — mirror smart-diff/model.ts exactly:
  export class BlastSummaryModel implements BlastSummaryModelPort {
    constructor(private llm: LLMProvider, readonly provider: string, readonly model: string) {}
    // completeStructured({ model, schema: BlastSummaryOutput, schemaName: BLAST_SUMMARY_SCHEMA_NAME, temperature: 0, messages: buildBlastSummaryPrompt(mapJson) })
  }
  // prompt.ts
  export const BlastSummaryOutput = z.object({ summary: z.string() });
  export const BLAST_SUMMARY_SCHEMA_NAME = 'BlastSummary';
  export function buildBlastSummaryPrompt(mapJson: string): ChatMessage[]  // same message type smart-diff's prompt.ts uses
  // repository.ts
  export class BlastRepository implements BlastSummaryPort {
    constructor(private db: Db) {}
    get(prId) / put(row)          // put = delete-then-insert (replace wholesale)
    featureModelChoice(workspaceId): Promise<{provider,model} | undefined>  // settings key 'feature_models', member 'blast_summary' — copy smart-diff/repository.ts:64-74
  }
  ```
- `constants.ts`: `MAX_SUMMARY_INPUT_CHARS = 8_000`, `MAX_SUMMARY_CHARS = 600`.

**Behaviour contract for `summarize(workspaceId, prId)`:**
1. Load pull (404 if missing). If a `blast_summary` row exists with `headSha === pull.headSha` → return it, **zero model calls**.
2. Recompute the map via `get()`'s internals; if `status === 'degraded'` → `throw new AppError('blast_degraded', 'Blast map is degraded — nothing to explain', 422)` (verify `AppError`'s constructor arg order in `server/src/platform/errors.ts` and match it).
3. In-flight guard: module-level `Set<string>` keyed by `prId` → concurrent call throws `AppError('conflict', ..., 409)`; `finally`-released.
4. Prompt input: `JSON.stringify` of the wire response minus `summary`, truncated at `MAX_SUMMARY_INPUT_CHARS` with a `…[truncated N chars]` marker line; wrapped `wrapUntrusted('blast-map', …)` with the trusted instruction outside the wrap. Instruction states: explain the given nodes/edges in one paragraph; do not invent files, symbols, endpoints.
5. Output truncated at `MAX_SUMMARY_CHARS` **before** storage; row replaced wholesale; return `{ summary, head_sha }`.

- [ ] **Step 1:** Write failing `blast-summary.test.ts` (stub ports + a counting fake `BlastSummaryModelPort`): (a) fresh derive → one `explain` call, row `put` with provider/model, truncation applied on an over-long summary; (b) second call same head → zero calls, cached value; (c) head changed → re-derives, replaces; (d) degraded map → throws 422-coded error **before** any model call; (e) concurrent → 409-coded error; (f) prompt input contains the truncation marker when the map JSON exceeds the cap.
- [ ] **Step 2:** Implement prompt/model/repository/`summarize`.
- [ ] **Step 3:** Verify (batched): `cd server && pnpm exec vitest run test/blast-summary.test.ts test/blast-service.test.ts && pnpm typecheck`.
- [ ] **Step 4:** Commit: `feat(blast): one-call cached summary with head_sha freshness`

---

### Task 7: routes, container getter, registration, spec, route it-tests

**Files:**
- Create: `server/src/modules/blast/routes.ts`
- Modify: `server/src/platform/container.ts` (getter + private field), `server/src/modules/index.ts` (import + registry entry)
- Create: `server/specs/blast.md`
- Test: `server/test/blast-routes.it.test.ts` (DB-backed)

**Interfaces:**
- Consumes: `BlastService` (Tasks 5-6), `container.reviewRepo` (`getPull`, `getPrFiles`), `container.repoIntel` (`getBlastRadius`, `getIndexState`), `BlastRepository`, `FEATURE_MODELS` `blast_summary` entry.
- Produces: `GET /pulls/:id/blast`, `POST /pulls/:id/blast/summary` (no body), and `container.blastService`.

**routes.ts** — copy `smart-diff/routes.ts:19-39` shape: `withTypeProvider<ZodTypeProvider>()`, `schema: { params: IdParams }`, `getContext(container, req)`, handlers delegate to `container.blastService.get(...)` / `.summarize(...)`.

**Container getter** — copy `get smartDiffService()` (`container.ts:221-248`) including the registry-default pattern (`container.ts:55-60`): `BLAST_SUMMARY_REGISTRY_ENTRY = FEATURE_MODELS.find(f => f.id === 'blast_summary')!`; ports as closures: `store.getPull` → `this.reviewRepo.getPull` projected to `{id, repoId, headSha}`, `store.getPrFilePaths` → `this.reviewRepo.getPrFiles(prId).then(rows => rows.map(r => r.path))`, `intel.blastRadius`/`intel.indexState` → `this.repoIntel.*`, `summaries` → a memoised `BlastRepository`, `model` → workspace choice via `blastRepo.featureModelChoice` else registry default, resolved through `this.llm(...)` into a `BlastSummaryModel`.

**`server/specs/blast.md`** — follow the format of `server/specs/smart-diff.md` (read it first): contract (both endpoints, the wire schema), behaviour (§2.2-2.5 of the design spec), degradation table (§7), acceptance checklist. Link it from `server/README.md`'s specs list if one exists (check how smart-diff is linked and mirror).

- [ ] **Step 1:** Write failing `blast-routes.it.test.ts` (pattern: an existing routes it-test for app building + seeding; remember auth needs the seeded workspace row — call the seed or insert the rows the way `smart-diff-routes.it.test.ts` does). Insert fixture rows for a test repo: `repo_index_state` (`status 'full'`, `lastIndexedSha` = the PR's `headSha`, `indexerVersion 2`), `symbols`, `references`, `file_edges`, `file_rank`, `file_facts`, a PR + `pr_files`. Cases: (a) GET → 200, `status 'ok'`, expected symbols/callers/endpoints from the fixtures, **and the LLM override mock recorded zero calls**; (b) GET for a PR of an unindexed repo → 200 `degraded/no_data`; (c) cross-workspace PR → 404; (d) non-uuid → 422; (e) POST summary with `ContainerOverrides.llm` structured mock → 200, second POST → same summary, mock called once total; (f) POST summary on the unindexed repo's PR → 422.
- [ ] **Step 2:** Implement `routes.ts`, container getter, `modules/index.ts` entry.
- [ ] **Step 3:** Write `server/specs/blast.md`.
- [ ] **Step 4:** Verify (batched): `cd server && pnpm exec vitest run test/blast-routes.it.test.ts && pnpm typecheck && pnpm arch:check` (violation count unchanged).
- [ ] **Step 5:** Commit: `feat(blast): GET /pulls/:id/blast and POST summary routes`

---

### Task 8: seed index slice + demo acceptance test

**Files:**
- Modify: `server/src/db/seed.ts`
- Test: extend `server/test/blast-routes.it.test.ts` with a seeded-demo case (or a focused `server/test/blast-seed.it.test.ts` if the seed can be invoked from tests the way other it-tests do — check how existing tests call `seed()` and follow that)

**Interfaces:**
- Consumes: demo repo `acme/payments-api` (`repoId` at `seed.ts:158`), PR #482 (`headSha 'a1b2c3d4e5f6'`), `SMART_DIFF_SEED_FILES` paths (the nine-file diff).
- Produces: `BLAST_SEED` constants + idempotent insertion of `repo_index_state`, `symbols`, `references`, `file_edges`, `file_rank`, `file_facts` for the demo repo.

**Seed content (aligned with the smart-diff nine files and the mockup):**
- `repo_index_state`: `status 'full'`, `lastIndexedSha 'a1b2c3d4e5f6'`, `indexerVersion 2` (restate `2` with a comment naming `INDEXER_VERSION` — do not import module code into the seed unless the seed already imports module constants; check and match).
- `symbols`: `rateLimit` (line 12) and `bucketKey` (line 41) in `src/middleware/ratelimit.ts`, `exported: true`, kind `function`.
- `references`: callers of `rateLimit` from `src/api/public/index.ts:23`, `src/api/public/webhooks.ts:45`, `src/api/public/health.ts:11`, `src/server.ts:88`; callers of `bucketKey` from two files — all with `decl_file: 'src/middleware/ratelimit.ts'`.
- `file_edges`: each caller file → `src/middleware/ratelimit.ts`; plus `src/server.ts` → `src/api/public/index.ts` (gives BFS a depth-2 hop).
- `file_rank`: rows for every referenced file (any deterministic percentiles; caller files distinct so ordering is stable).
- `file_facts`: `src/api/public/index.ts` → `["GET /api/public/items"]`; `src/api/public/webhooks.ts` → `["POST /api/public/webhooks"]`; `src/api/public/health.ts` → `["GET /api/public/health"]`; `src/server.ts` → crons `["job:reset-rate-buckets"]`.
- Idempotency: the smart-diff pattern (`seed.ts:233-256`) — count existing `symbols` rows for the repo; when fewer than expected, delete this repo's rows across all six tables and re-insert. Placed **outside** `if (!pr)`.

**Note:** `src/api/public/health.ts` is not among the nine `SMART_DIFF_SEED_FILES` — callers may live outside the PR's diff; that is the point of blast. Do not add it to `pr_files`.

- [ ] **Step 1:** Write the failing demo case: after running the seed against the test DB, `GET /pulls/<pr482>/blast` returns `status 'ok'`, ≥2 callers under the `rateLimit` symbol, ≥1 endpoint, and ≥1 cron — the spec's acceptance #1.
- [ ] **Step 2:** Implement the seed slice.
- [ ] **Step 3:** Verify (batched): `cd server && pnpm exec vitest run test/blast-routes.it.test.ts && pnpm typecheck`. Also run `pnpm db:seed` twice against the dev DB and confirm no duplicate rows (count `symbols` for the repo).
- [ ] **Step 4:** Commit: `feat(db): seed blast index slice for the demo PR`

---

### Task 9: client — hooks, i18n, prop threading, BlastCard (tree)

**Files:**
- Create: `client/src/lib/hooks/blast.ts`; add `export * from "./blast";` to `client/src/lib/hooks/index.ts`
- Modify: `client/messages/en/blast.json` (add card keys — keep every existing key untouched)
- Modify: `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx` (+ its props) and `page.tsx:151-154` (thread `repoFullName={repoFullName}` and `prNumber={pr.number}` into `OverviewTab`)
- Create: `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BlastCard/` — `BlastCard.tsx`, `BlastCard.test.tsx`, `helpers.ts`, `styles.ts`, `constants.ts`, `index.ts` (folder convention; `index.ts` = one-line re-export)
- Test: `BlastCard.test.tsx`

**Interfaces:**
- Consumes: `BlastRadiusResponse` from `@devdigest/shared` (Task 1, client copy); `api.get/post`; `githubBlobUrl(repoFullName, sha, file, startLine?)`; `useTranslations("blast")`; primitives `SectionLabel`, `Skeleton`, `Button` (import paths as `IntentCard` does).
- Produces:
  ```ts
  // hooks/blast.ts — mirror hooks/intent.ts exactly
  export function useBlastRadius(prId: string | null | undefined)
    // useQuery, queryKey ["pr-blast", prId], api.get<BlastRadiusResponse>(`/pulls/${prId}/blast`), enabled: !!prId
  export function useBlastSummary(prId: string | null | undefined)
    // useMutation → api.post<{summary: string; head_sha: string}>(`/pulls/${prId}/blast/summary`)
    // onSuccess: qc.setQueryData(["pr-blast", prId], (prev) => prev ? { ...prev, summary: rec.summary } : prev)
  // BlastCard.tsx
  export function BlastCard({ prId, headSha, repoFullName }: { prId: string | null; headSha: string; repoFullName: string | null })
  // helpers.ts
  export function callerHref(repoFullName: string | null, headSha: string, file: string, line: number): string | null
    // null when repoFullName is null → caller renders plain text (finding-deep-links rule)
  ```
- `OverviewTabProps` gains `repoFullName: string | null` and `prNumber: number`; `OverviewTab` renders `<BlastCard prId={prId} headSha={headSha} repoFullName={repoFullName} />` after `IntentCard`.

**i18n keys to add** (namespace `blast`): `title`, `loadError`, `retry`, `empty` ("No indexed symbols in the changed files."), `partialWarning` (takes `{reason}`), `degradedTitle`, `degradedBody` (takes `{reason}`), `explain`, `explaining`, `summaryTitle`.

**Card behaviour** — the `IntentCard` four-branch skeleton verbatim (loading with `Skeleton`s keeping footprint → error + GET-retry `Button` → content), then:
- `status 'degraded'` → `degradedTitle`/`degradedBody`, **no tree, no counters, no Explain**;
- `status 'partial'` → warning line (`role` none, visible text) above the tree;
- `ok` + zero symbols → `empty` text;
- tree: per changed symbol — header `name` + `file:line` (declaration link via `callerHref`), then its callers as rows `file:line` (link or plain per `callerHref`), then endpoint/cron chips from the symbol's own arrays; counters row on top from `blast.stat.*` keys;
- Explain `Button`: rendered only when `summary === null` **and** status ≠ degraded; pending label `explaining`; mutation error inline with `role="alert"` (the `deriveError` pattern); when `summary` present → paragraph under `summaryTitle`, no button.
- Links: `<a className="mono" target="_blank" rel="noopener noreferrer">` (the `FindingRow` precedent — not `MonoLink`).

- [ ] **Step 1:** Write failing `BlastCard.test.tsx` — copy the harness from `IntentCard.test.tsx` (QueryClient `retry: false`, `NextIntlClientProvider` with `{ blast: messages }` imported by relative path, `stubFetch` helpers, `afterEach` cleanup+unstub). Cases: loading; load error + retry refetches; `ok` with data (symbol header, caller rows with `href` containing `/blob/<headSha>/<file>#L<line>`, endpoint chip text); `repoFullName: null` → caller row is plain text with no `<a>`; `partial` shows the warning and still the tree; `degraded` shows no tree and no Explain; `ok`-empty shows `empty`; Explain click POSTs once and renders the returned summary; summary present on load → no Explain button.
- [ ] **Step 2:** Implement hooks, i18n keys, threading, card.
- [ ] **Step 3:** Verify (batched): `cd client && pnpm exec vitest run BlastCard && pnpm typecheck`.
- [ ] **Step 4:** Commit: `feat(client): blast radius card on PR overview`

---

### Task 10: client — BlastGraph + Tree|Graph toggle

**Files:**
- Modify: `client/package.json` via `cd client && pnpm add d3-scale d3-shape && pnpm add -D @types/d3-scale @types/d3-shape`
- Create: `.../BlastCard/_components/BlastGraph/` — `BlastGraph.tsx`, `BlastGraph.test.tsx`, `helpers.ts`, `constants.ts`, `styles.ts`, `index.ts`
- Modify: `BlastCard.tsx` (toggle + conditional view)
- Test: `BlastGraph.test.tsx`

**Interfaces:**
- Consumes: `BlastRadiusResponse`, `callerHref` from Task 9's `BlastCard/helpers.ts`, `blast.view.tree` / `blast.view.graph` / `blast.graph.ariaLabel` / `blast.graph.empty` i18n keys (already present).
- Produces:
  ```ts
  // BlastGraph/helpers.ts — pure, d3 does math only (no d3-selection anywhere)
  export interface GraphNode { id: string; col: 0 | 1 | 2; label: string; sub?: string;
                               x: number; y: number; href: string | null;
                               kind: 'symbol' | 'caller' | 'endpoint' | 'cron' }
  export interface GraphEdge { id: string; path: string }   // SVG path d, via d3-shape linkHorizontal
  export function layoutBlastGraph(data: BlastRadiusResponse,
                                   href: (file: string, line: number) => string | null,
                                   width: number): { nodes: GraphNode[]; edges: GraphEdge[]; height: number }
  // BlastGraph.tsx
  export function BlastGraph({ data, headSha, repoFullName }: {...})  // renders <svg role="img" aria-label=…>
  ```
- Layout contract: columns at fixed x (symbols | callers | endpoints+crons); within a column, order = the order the data already carries (rank-desc callers, symbols in response order) via `scalePoint`; same input → identical output (pure function, no randomness); `height` grows with `max` column length; card wraps the svg in a vertically scrollable div beyond `GRAPH_MAX_HEIGHT` (constant, 420).
- Toggle: local `useState<'tree' | 'graph'>('tree')` in `BlastCard`; two buttons with pressed state (`aria-pressed`); rendered **only** when status ≠ degraded and there is ≥1 changed symbol; labels from `blast.view.*`.
- Node rendering: React maps `nodes`/`edges` to `<g>`/`<path>`/`<a href>`; caller/symbol nodes link via the shared `href` builder (plain `<text>` when null); endpoint/cron nodes never link.

- [ ] **Step 1:** Write failing `BlastGraph.test.tsx`: (a) `layoutBlastGraph` is deterministic — two calls, deep-equal results; (b) three distinct column x positions in ascending order; (c) caller node order follows the input (rank-desc) order; (d) node hrefs equal `callerHref(...)` output for the same inputs, null → no `<a>` in render; (e) rendered svg has `role="img"` and the aria label; (f) toggle in `BlastCard.test.tsx` (add there): graph hidden by default, click shows it, hidden entirely on `degraded` and on zero symbols.
- [ ] **Step 2:** Install the four packages (pnpm, from `client/`); implement helpers + component + toggle.
- [ ] **Step 3:** Verify (batched): `cd client && pnpm exec vitest run && pnpm typecheck` (full client lane — new dependency touched the build).
- [ ] **Step 4:** Commit: `feat(client): d3-laid-out blast radius graph view`

---

### Task 11: MCP — implement `devdigest_get_blast_radius`

**Files:**
- Modify: `mcp/src/types.ts` (add `BlastRadiusRef` — structural, do NOT import from shared), `mcp/src/api.ts` (interface + method), `mcp/src/project.ts` (projection), `mcp/src/tools/get-blast-radius.ts` (handler + description + title), `mcp/test/helpers/fake-api.ts` (seed + method)
- Test: `mcp/test/tools.test.ts` (rewrite the three stub cases), `mcp/test/api.test.ts` (add one method case following its pattern), `mcp/test/project.test.ts` (projection cases)

**Interfaces:**
- Consumes: `GET /pulls/:id/blast` (Task 7); `resolveRepo(api, slug)` / `resolvePull(api, repo, number)`; `ok`/`toToolResult`.
- Produces:
  ```ts
  // types.ts — mirror the wire contract structurally
  export interface BlastCallerRef { file: string; line: number; symbol: string; rank: number }
  export interface BlastSymbolRef { name: string; kind: string; file: string; line: number | null;
                                    callers: BlastCallerRef[]; endpoints: string[]; crons: string[] }
  export interface BlastRadiusRef { status: 'ok' | 'partial' | 'degraded'; reason: string | null;
                                    head_sha: string; changed_symbols: BlastSymbolRef[];
                                    endpoints: string[]; crons: string[]; summary: string | null }
  // api.ts
  getBlastRadius(prId: string): Promise<BlastRadiusRef>   // request<BlastRadiusRef>(`/pulls/${prId}/blast`)
  // project.ts — follow projectConventions' total/shown/note convention
  export interface BlastProjection {
    status: string; reason?: string; head_sha: string;
    symbols: { name: string; file: string; line: number | null; caller_count: number;
               top_callers: string[];        // "file:line (enclosingSymbol)", ≤5, note when truncated
               endpoints: string[]; crons: string[] }[];
    endpoints: string[]; crons: string[]; summary?: string; note?: string;
  }
  export function projectBlastRadius(res: BlastRadiusRef): BlastProjection
  ```
- Handler shape = `get-findings.ts:41-92`: parse → resolve → `api.getBlastRadius(pull.id)` → `ok(projectBlastRadius(res) as unknown as Record<string, unknown>)`, `catch → toToolResult(err)`. Args schema **unchanged**. New description (>80 chars, no "not implemented"): what the map is, that `status` may be `partial`/`degraded` and what that means. Annotations title: `"Map a pull request's blast radius"`.
- `fake-api.ts`: `FakeApiSeed` gains `blast: BlastRadiusRef`; `DEFAULT_SEED.blast` = an `ok` sample with one symbol/two callers/one endpoint; method records `` `getBlastRadius:${prId}` `` in `calls`.

- [ ] **Step 1:** Rewrite/extend failing tests: (a) happy path — resolves `acme/payments-api#482`, calls `getBlastRadius:pr-1`, result not `isError`, `structuredContent.symbols[0].caller_count === 2`; (b) degraded seed → result not `isError`, `structuredContent.status === 'degraded'` with `reason` passed through (never laundered into an empty success); (c) unknown repo slug → `isError` with the resolver's hint; (d) description no longer contains "not implemented" and length > 80; (e) registry invariants still pass; (f) `projectBlastRadius` truncation: 25 callers → `caller_count 25`, `top_callers.length 5`, `note` present.
- [ ] **Step 2:** Implement types/api/projection/handler/fake-api.
- [ ] **Step 3:** Verify (batched): `cd mcp && pnpm test && pnpm typecheck`.
- [ ] **Step 4:** Commit: `feat(mcp): implement devdigest_get_blast_radius`

---

### Task 12: server — `POST /reviews/adhoc`

**Files:**
- Modify: `server/src/modules/reviews/routes.ts`, `server/src/modules/reviews/service.ts`, `server/src/modules/reviews/constants.ts` (or create the constant where the module keeps literals)
- Test: `server/test/reviews-adhoc.it.test.ts` (DB-backed — route tests need the seeded workspace; LLM mocked via `ContainerOverrides.llm`)

**Interfaces:**
- Consumes: `parseUnifiedDiff(raw: string): UnifiedDiff` from `adapters/git/diff-parser.ts`; `reviewPullRequest`, `countBlockers` from `@devdigest/reviewer-core` (exact import: `run-executor.ts:3`); `container.agentsRepo.listEnabled(workspaceId)`; `container.llm(agent.provider)`.
- Produces:
  ```ts
  // routes.ts
  const AdhocBody = z.object({ diff: z.string().min(1), agent: z.string().min(1).optional() });
  app.post('/reviews/adhoc',
    { schema: { body: AdhocBody },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      bodyLimit: MAX_ADHOC_DIFF_BYTES },          // 1_048_576 → Fastify replies 413 beyond it
    handler → service.runAdhocReview(workspaceId, req.body, req.log))
  // service.ts
  async runAdhocReview(workspaceId: string, body: { diff: string; agent?: string }, log: FastifyBaseLogger):
    Promise<{ review: Review; blockers: number; dropped: string[]; scope_dropped: string[];
              agent: { name: string; ci_fail_on: CiFailOn }; model: string;
              tokens_in: number; tokens_out: number; cost_usd: number | null }>
  ```
- Behaviour contract:
  1. Agent resolution: `agent` name given → case-insensitive match over `listEnabled(workspaceId)`; no match → `NotFoundError('Agent not found', …)` (reuse the service's existing error classes/messages style). Omitted → enabled agent with earliest `createdAt` (tiebreak by `id`); none enabled → `AppError('no_agents', 'No enabled agents — create one in the Agents screen', 409)`.
  2. `parseUnifiedDiff(body.diff)`; zero files → `AppError('empty_diff', 'Diff parsed to zero files', 422)`.
  3. `reviewPullRequest({ systemPrompt: agent.systemPrompt, model: agent.model, diff, llm, strategy: agent.strategy ?? <the module's existing default — reuse the same fallback run-executor uses at :257> })`. No `intent`/`repoMap`/`callers`/`prDescription`/`memory`/`specs` — omitted slots render no section by engine contract.
  4. `countBlockers(outcome.review.findings, agent.ciFailOn)`.
  5. Map `ReviewOutcome` fields to the snake_case response (`dropped`/`scopeDropped` carry the reason strings; `tokensIn/Out`, `costUsd`). **No writes** to `runs`/`reviews`/`findings`/`run_traces`; log tokens via `log.info`.

- [ ] **Step 1:** Write failing `reviews-adhoc.it.test.ts` (structured-mock LLM returning a fixed `Review` with one CRITICAL finding grounded in the posted diff's lines and one ungrounded finding): (a) 200 — shape above, the ungrounded finding in `dropped`, `blockers` respects the agent's `ciFailOn` (seed one agent with `critical`); (b) agent name mismatch → 404; (c) all agents disabled → 409; (d) `diff: ''` → 422 (zod); (e) garbage diff text → 422 `empty_diff`; (f) row counts of `runs`/`reviews`/`findings` identical before/after the 200 call; (g) body over `MAX_ADHOC_DIFF_BYTES` → 413.
- [ ] **Step 2:** Implement route + service method + constant.
- [ ] **Step 3:** Verify (batched): `cd server && pnpm exec vitest run test/reviews-adhoc.it.test.ts && pnpm typecheck && pnpm arch:check`.
- [ ] **Step 4:** Commit: `feat(reviews): stateless adhoc diff review endpoint`

---

### Task 13: MCP — `devdigest review --mode working` CLI

**Files:**
- Create: `mcp/bin/devdigest.mjs`, `mcp/src/cli/main.ts`, `mcp/src/cli/run.ts`, `mcp/src/cli/git.ts`, `mcp/src/cli/render.ts`
- Modify: `mcp/package.json` (`"bin": { "devdigest": "bin/devdigest.mjs" }`, script `"review": "tsx src/cli/main.ts review"`), `mcp/src/api.ts` (+types), `mcp/test/helpers/fake-api.ts`, `mcp/README.md` (CLI section: usage, untracked-files limitation, exit-code contract, `DEVDIGEST_API_URL`)
- Test: `mcp/test/cli-git.test.ts`, `mcp/test/cli-run.test.ts`, `mcp/test/cli-render.test.ts`

**Interfaces:**
- Consumes: `POST /reviews/adhoc` (Task 12); `loadConfig(process.env)`; `HttpApiClient`.
- Produces:
  ```ts
  // api.ts
  export interface AdhocFinding { severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION'; title: string;
                                  file: string; start_line: number; end_line: number }
  export interface AdhocReviewRef { review: { verdict: string; summary: string; score: number;
                                              findings: AdhocFinding[] };
                                    blockers: number; dropped: string[]; scope_dropped: string[];
                                    agent: { name: string; ci_fail_on: string }; model: string }
  reviewAdhoc(diff: string, agent?: string): Promise<AdhocReviewRef>
    // POST /reviews/adhoc, JSON body { diff, ...(agent ? { agent } : {}) }, content-type header
  // cli/git.ts — execFile('git', […], { cwd }) promisified; every fn takes cwd for testability
  export async function repoRoot(cwd: string): Promise<string | null>         // rev-parse --show-toplevel; null on failure
  export async function workingDiff(root: string): Promise<string>            // git diff HEAD
  export async function untrackedCount(root: string): Promise<number>         // ls-files --others --exclude-standard | count lines
  // cli/render.ts — pure
  export function renderReview(res: AdhocReviewRef): string                   // stdout payload
  export function exitCodeFor(res: AdhocReviewRef): 0 | 1                     // blockers === 0 ? 0 : 1
  // cli/run.ts — the orchestrator, fully injectable
  export interface CliDeps { git: { repoRoot; workingDiff; untrackedCount }; api: Pick<ApiClient, 'reviewAdhoc'>;
                             out(line: string): void; err(line: string): void; cwd: string }
  export interface CliOptions { mode: 'working' | 'staged' | 'branch'; agent?: string }
  export async function runReviewCommand(opts: CliOptions, deps: CliDeps): Promise<0 | 1 | 2>
  // cli/main.ts — hand-rolled argv parse (no new dependency): expects `review`, `--mode <m>` (required),
  // `--agent <name>`, `--help`; unknown flag/command → usage on stderr, exit 2.
  ```
- `runReviewCommand` contract (spec §6.2): not a repo → err + **2**; `staged`/`branch` mode → err "not implemented" + **2**; untracked N > 0 → err `N untracked file(s) not reviewed (git diff HEAD does not see them — stage or commit to include)`; empty diff → out `Nothing to review.` + **0**; API/network error (`ApiUnavailableError` → message naming `DEVDIGEST_API_URL` and `cd server && pnpm dev`; any `ApiHttpError` → its message) + **2**; success → `out(renderReview(res))` + `exitCodeFor(res)`.
- `renderReview` format: header `verdict (score) — agent <name>, model <model>`; findings grouped `CRITICAL → WARNING → SUGGESTION`, each `SEVERITY  file:start[-end]  title`; then `dropped: N (grounding)` / `scope_dropped: N` when non-zero; last line `blockers: N (fail on: <ci_fail_on>)`.
- `bin/devdigest.mjs`: `#!/usr/bin/env node`, `import { register } from 'tsx/esm/api'; register(); await import('../src/cli/main.ts');` — the package-manager bin shims make this work cross-platform; `--help` documents modes, untracked exclusion, exit codes.

- [ ] **Step 1:** Write failing tests. `cli-render.test.ts`: fixture `AdhocReviewRef` → exact expected string (severity grouping, ranges, blockers line); `exitCodeFor` 0/1. `cli-run.test.ts` (fake deps, no processes): each branch of the contract above incl. which of out/err received what and the returned code; untracked warning appears while review still runs. `cli-git.test.ts` (real git in `mkdtemp` dirs): init+commit+modify tracked file → `workingDiff` contains the file header; add untracked file → `untrackedCount() === 1`; non-repo dir → `repoRoot === null`.
- [ ] **Step 2:** Implement api method + fake-api extension, `git.ts`, `render.ts`, `run.ts`, `main.ts`, `bin/devdigest.mjs`, `package.json`, README section.
- [ ] **Step 3:** Verify (batched): `cd mcp && pnpm test && pnpm typecheck`. Smoke: with the server running, `pnpm review -- --mode working` inside this repo (expect exit 0/1 and rendered output; without the server, expect the exit-2 message).
- [ ] **Step 4:** Commit: `feat(mcp): devdigest review --mode working CLI`

---

### Task 14: full-gate verification + insights

**Files:** none new (fixes only if gates fail)

- [ ] **Step 1:** Run every gate: `cd server && pnpm typecheck && pnpm arch:check && pnpm exec vitest run --exclude '**/*.it.test.ts'`, then (Docker up) `pnpm exec vitest run` (full incl. it-tests); `cd client && pnpm typecheck && pnpm exec vitest run`; `cd mcp && pnpm typecheck && pnpm test`; `cd reviewer-core && npm run build && npm test` (untouched, but its path filter triggers server CI — confirm green).
- [ ] **Step 2:** Walk the spec's acceptance table (§10, items 1-11) and check each against the shipped tests; fix any gap.
- [ ] **Step 3:** If any durable non-obvious lesson surfaced (it will — e.g. seed/index interplay), record it via the `engineering-insights` skill in the touched package's `INSIGHTS.md`.
- [ ] **Step 4:** Commit any fixes: `test(<scope>): close acceptance gaps` (or scoped fixes).

---

## Self-review notes (already applied)

- Spec coverage: §2.1→T2/T3, §2.2-2.3→T5/T7, §2.4→T1, §2.5→T4/T6, §3.1-3.3/3.5→T9, §3.4→T10, §4→T11, §5→T12, §6→T13, §7→spread across T5/T6/T9/T12/T13 tests, §8→T8, §9 gates→each task + T14, §10→T14 step 2.
- Verified against the repo (not assumed): `getResolvedCallers` lacks self-file exclusion; agents resolve by id (name lookup goes through `listEnabled`); route tests require DB (seeded workspace auth) so adhoc/route suites are `.it.test.ts`; `blast_summary` belongs in `schema/reviews.ts`; no `response:` schemas anywhere; `OverviewTab` currently lacks `repoFullName`/`prNumber`; `blast.json` exists but lacks card-state keys; mcp has no arg parser and no `bin` today.
