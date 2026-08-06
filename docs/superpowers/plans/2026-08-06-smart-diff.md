# Smart Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `GET /pulls/:id/smart-diff` (deterministic core/wiring/boilerplate grouping with finding marks, no model call) plus an on-demand per-file summary, and render it as the default Files changed tab.

**Architecture:** A new `server/src/modules/smart-diff/` module holds a pure path classifier and composes `pr_files` + non-dismissed findings + cached `pr_file_summary` rows into the existing `SmartDiff` contract. The client extends the existing diff-viewer (never forks it) and mounts `SmartDiffViewer` as the default order of the Files changed tab, `?order=original` falling back to today's flat list.

**Tech Stack:** Fastify + Drizzle + Zod (server), Next 15 + TanStack Query + vitest/jsdom (client), testcontainers Postgres for `*.it.test.ts`.

**Design:** [`docs/superpowers/specs/2026-08-06-smart-diff-design.md`](../specs/2026-08-06-smart-diff-design.md) — section references (§) below point there.

## Global Constraints

- Package managers: `server/` and `client/` use **pnpm**; never npm there.
- `@devdigest/shared` is **two physical copies** — every contract edit lands in `server/src/vendor/shared/` AND `client/src/vendor/shared/`, and both packages must typecheck. `FEATURE_MODELS` additionally has a **third**, client-local runtime copy in `client/src/lib/feature-models.ts`.
- `GET /pulls/:id/smart-diff` must never call a model, on any path (design §5).
- Every pattern, threshold and cap lives in `modules/smart-diff/constants.ts`; tests import them rather than restating numbers (design acceptance #4).
- Every route calls `getContext(container, req)` and scopes by `workspaceId`; another workspace's PR is **404, never 403**.
- Onion layering per `server/CLAUDE.md`: routes = HTTP+zod only; no raw Drizzle outside `repository.ts`; the module never imports another module's repository — cross-aggregate reads go through `container.reviewRepo`.
- `cd server && pnpm arch:check` must still report exactly **24** known violations — never regenerate the baseline.
- Migrations via `pnpm db:generate` only; never hand-edit an applied migration; never migrate on boot.
- diff-viewer styles are `CSSProperties` objects in `client/src/components/diff-viewer/styles.ts` (NOT Tailwind strings) — match that file, not the general client rule.
- Client strings go through `useTranslations("prReview")` → `messages/en/prReview.json` `smartDiff` block; no hardcoded UI copy.
- Conventional commits with scope, imperative, body explains *why*.
- Never `docker compose down -v`. Never commit without running the named verify commands first.

## File Structure

```
server/src/db/schema/reviews.ts                  + prFileSummary table (Task 2)
server/src/db/migrations/0016_*.sql              generated (Task 2)
server/src/modules/smart-diff/
  constants.ts     every pattern list + threshold + cap (Tasks 3, 6)
  helpers.ts       classifyPath / groupFiles / splitSuggestion — pure (Task 3)
  domain.ts        structural row/port types, no cross-module imports (Task 4)
  repository.ts    pr_file_summary reads/writes + featureModelChoice (Tasks 4, 6)
  service.ts       SmartDiffService: get() + summarize() (Tasks 4, 6)
  model.ts         FileSummaryModel — the one structured LLM call (Task 6)
  prompt.ts        the summary feature prompt (Task 6)
  routes.ts        GET smart-diff, POST smart-diff/summary (Tasks 4, 6)
server/src/modules/index.ts                      + smartDiff entry (Task 4)
server/src/platform/container.ts                 + smartDiffRepo/-Service (Task 4)
server/src/db/seed.ts                            9-file seed (Task 5)
client/src/lib/hooks/smart-diff.ts               useSmartDiff/useFileSummary (Task 7)
client/src/components/diff-viewer/               FileCard/CodeLine extensions (Task 7)
client/.../DiffTab/_components/SmartDiffViewer/  + GroupSection/SplitBanner/SummaryPill (Task 8)
e2e/specs/09-pr-smart-diff.flow.json             (Task 9)
server/specs/smart-diff.md, client/specs/smart-diff-display.md (Task 9)
```

---

### Task 1: Contracts — three additive edits, in every copy

**Files:**
- Modify: `server/src/vendor/shared/contracts/brief.ts` (add `FindingMark`, `SmartDiffFile.finding_marks`)
- Modify: `server/src/vendor/shared/contracts/review-api.ts` (add `PrFileSummaryRecord`)
- Modify: `server/src/vendor/shared/contracts/platform.ts` (extend `FeatureModelId`, `FEATURE_MODELS`)
- Modify: `client/src/vendor/shared/contracts/brief.ts`, `client/src/vendor/shared/contracts/review-api.ts`, `client/src/vendor/shared/contracts/platform.ts` — byte-identical edits
- Modify: `client/src/lib/feature-models.ts` (the third registry copy)
- Test: `server/test/contracts.test.ts` (extend)

**Interfaces (Produces):**
- `FindingMark` = `z.object({ line: z.number().int(), severity: Severity, finding_id: z.string() })`, exported from `brief.ts` (import `Severity` from `./findings.js` as `review-api.ts` does).
- `SmartDiffFile` gains `finding_marks: z.array(FindingMark).nullish()`. **No other field changes** — the existing `SmartDiff` round-trip case in `contracts.test.ts` must keep passing unedited (design §4).
- `PrFileSummaryRecord` = `z.object({ pr_id, path, head_sha, summary, provider, model: z.string(), created_at: z.string() })` (all strings), exported from `review-api.ts` next to `PrIntentRecord`.
- `FeatureModelId` gains `'file_summary'`; `FEATURE_MODELS` gains `{ id: 'file_summary', label: 'PR Review · File summary', description: 'Summarises one changed file on demand.', defaultProvider: 'openrouter', defaultModel: 'google/gemini-2.5-flash-lite' }` — flash-class, same reasoning comment as `review_intent`. Identical entry in all **three** registry copies.
- Barrel exports: check each `vendor/shared/index.ts` re-exports the contracts files (they already re-export `brief`/`review-api`/`platform` wholesale — verify, don't assume).

**Skills:** `zod`, `typescript-expert`.

- [ ] **Step 1: Write the failing tests** — extend `server/test/contracts.test.ts` with two cases: (a) `SmartDiff` parses a payload where a file carries `finding_marks: [{ line: 28, severity: 'WARNING', finding_id: 'f1' }]` and round-trips it; (b) `PrFileSummaryRecord` parses a full record and rejects a missing `summary`. Also assert `FeatureModelId.parse('file_summary')` succeeds.
- [ ] **Step 2: Run to verify failure** — `cd server && pnpm exec vitest run test/contracts.test.ts`. Expected: FAIL (unknown export / unrecognized key).
- [ ] **Step 3: Apply the six file edits** listed above. The server and client vendor copies must be byte-identical for the changed regions; `client/src/lib/feature-models.ts` mirrors the registry entry with double quotes per that file's style.
- [ ] **Step 4: Verify** — `cd server && pnpm exec vitest run test/contracts.test.ts` (PASS), then `pnpm typecheck`; `cd client && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(contracts): finding marks, file-summary record and its model registry entry`.

---

### Task 2: `pr_file_summary` table + migration

**Files:**
- Modify: `server/src/db/schema/reviews.ts` (after `prBrief`)
- Create: `server/src/db/migrations/0016_*.sql` via `pnpm db:generate`
- Verify barrel: `server/src/db/schema.ts` re-exports domain files wholesale — confirm `reviews.ts` is already covered (it is, via the barrel's existing re-export).

**Interfaces (Produces):**
- Drizzle table `prFileSummary` (`pr_file_summary`): `prId` uuid FK → `pullRequests.id` `ON DELETE CASCADE`; `path` text notNull; `headSha` text notNull; `summary` text notNull; `provider` text notNull; `model` text notNull; `createdAt` via the file's existing `now()` helper; **composite primary key `(prId, path)`** using drizzle's `primaryKey({ columns: [...] })` in the table's third argument — mirror how other composite constraints in the schema folder are declared.

**Skills:** `drizzle-orm-patterns`, `postgresql-table-design`.

- [ ] **Step 1: Add the table** to `server/src/db/schema/reviews.ts` with a doc comment stating the §3.1 fact: it cannot live on `pr_files` because `GET /pulls/:id` deletes and re-inserts those rows.
- [ ] **Step 2: Generate** — `cd server && pnpm db:generate --name smart_diff_summaries`. Inspect the SQL: one `CREATE TABLE` with the composite PK and the cascade FK, nothing else. Commit the generated SQL as-is.
- [ ] **Step 3: Verify** — `pnpm typecheck`; `pnpm db:migrate` against the local dev DB applies cleanly.
- [ ] **Step 4: Commit** — `feat(db): pr_file_summary keyed on (pr_id, path) with head_sha freshness`.

---

### Task 3: The pure classifier — patterns, ordering, splits

**Files:**
- Create: `server/src/modules/smart-diff/constants.ts`
- Create: `server/src/modules/smart-diff/helpers.ts`
- Test: `server/test/smart-diff-classify.test.ts` (hermetic — no DB, no app)

**Interfaces (Produces):**
```ts
// helpers.ts — pure, no imports outside constants + @devdigest/shared types
export interface FileStat { path: string; additions: number; deletions: number }
export function classifyPath(path: string): SmartDiffRole
export function groupFiles(
  files: FileStat[],
  marksByPath: Map<string, FindingMark[]>,
  summaryByPath: Map<string, string>,
): SmartDiffGroup[]
export function splitSuggestion(files: FileStat[]): SmartDiff['split_suggestion']
```
- `constants.ts` exports (names fixed, values from design §2): `LOCK_FILES`, `GENERATED_DIR_SEGMENTS` (with a comment naming `repo-intel/constants.ts` `EXCLUDED_DIRS` as the deliberately-unshared original), `SNAPSHOT_PATTERNS`, `GENERATED_FILE_PATTERNS`, `BINARY_ASSET_EXTENSIONS`, `WIRING_BARRELS`, `WIRING_ENTRYPOINTS`, `WIRING_CONFIG_PATTERNS`, `SPLIT_LINES_MAX = 400`, `SPLIT_FILES_MAX = 20`, `MAX_PROPOSED_SPLITS = 4`, `FALLBACK_SPLIT_NAME = 'everything else'`, `ROOT_SPLIT_NAME = 'root'`, plus Task 6's `MAX_PATCH_CHARS = 8000`, `MAX_SUMMARY_CHARS = 280`.
- Behaviour contract (design §2, binding): boilerplate is tested **before** wiring; tests are core; `*.md` and `docs/` are boilerplate; `**/migrations/**/*.sql` is boilerplate, other `.sql` core; `package.json` is wiring; groups emit `core → wiring → boilerplate`, present-only; in-group order = finding count desc → changed lines desc → path asc; `finding_lines` = sorted de-duplicated projection of `finding_marks`, derived here and nowhere else; `finding_marks` always an array (empty when none); `pseudocode_summary` from `summaryByPath` or null. Splits per §2.3: `total_lines` over ALL files; `too_big` on either threshold; two-segment prefix over core+wiring only (one segment → that segment; root file → `ROOT_SPLIT_NAME`); ordered by lines desc; capped at `MAX_PROPOSED_SPLITS` with the remainder folded into `FALLBACK_SPLIT_NAME`; fewer than two splits → `[]`.

**Skills:** `typescript-expert`.

- [x] **Step 1: Write the failing tests** — table-driven over the acceptance rows. Minimum cases, importing every threshold from `constants.ts`:
  - `classifyPath`: `pnpm-lock.yaml`→boilerplate, `dist/index.js`→boilerplate (not wiring — evaluation order), `src/__snapshots__/a.snap`, `assets/logo.png`, `README.md`, `docs/guide.md`, `server/src/db/migrations/0001_x.sql`→boilerplate; `scripts/query.sql`→core; `src/index.ts`, `src/server.ts`, `src/config.ts`, `vitest.config.ts`, `package.json`, `.github/workflows/ci.yml`→wiring; `src/api/users.ts`, `src/api/users.test.ts`→core.
  - `groupFiles`: three-role fixture asserting group order, present-only groups, the three-key sort incl. path tiebreak (two identical-stat files), marks/`finding_lines` projection equality, empty-marks array when no findings.
  - `splitSuggestion`: `total_lines` includes boilerplate; `too_big` on each threshold independently (401 lines / 21 files); a >`SPLIT_LINES_MAX` PR across ≥3 prefixes yields prefix splits ordered by size with no boilerplate member; 6 prefixes → 4 splits + `everything else` holding the rest; one-prefix large PR → `[]`; small PR → `too_big: false`, `[]`.
- [x] **Step 2: Run to verify failure** — `cd server && pnpm exec vitest run test/smart-diff-classify.test.ts`. Expected: FAIL (module not found).
- [x] **Step 3: Implement** `constants.ts` + `helpers.ts` against the contract above.
- [x] **Step 4: Verify** — the test file PASSes; `pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(smart-diff): pure path classifier, deterministic ordering and split arithmetic`.

---

### Task 4: Read path — module, GET route, container wiring

**Files:**
- Create: `server/src/modules/smart-diff/domain.ts`, `repository.ts`, `service.ts`, `routes.ts`
- Modify: `server/src/modules/index.ts` (one import + `smartDiff` entry), `server/src/platform/container.ts`
- Test: `server/test/smart-diff-routes.it.test.ts`

**Interfaces:**
- Consumes: Task 3's `classifyPath`/`groupFiles`/`splitSuggestion`; `container.reviewRepo.getPull(workspaceId, prId)`, `.getPrFiles(prId)`, `.reviewsForPull(prId)` (all exist — verified); Task 2's `prFileSummary` table.
- Produces:
```ts
// domain.ts — structural, no imports from modules/reviews (mirrors intent/domain.ts)
export interface PullHead { id: string; headSha: string }
export interface PrFileRow { path: string; additions: number; deletions: number }
export interface FindingLite { id: string; file: string; startLine: number; severity: string; dismissedAt: Date | null }
export interface SmartDiffStorePort {
  getPull(workspaceId: string, prId: string): Promise<PullHead | undefined>
  getPrFiles(prId: string): Promise<PrFileRow[]>
  findingsForPull(prId: string): Promise<FindingLite[]>
}
// service.ts
export class SmartDiffService {
  constructor(deps: { store: SmartDiffStorePort; repo: SmartDiffRepository; log?: ... })
  get(workspaceId: string, prId: string): Promise<SmartDiff>   // NotFoundError('Pull request not found') on unknown/foreign PR
}
// repository.ts — the ONLY file touching pr_file_summary
export class SmartDiffRepository {
  constructor(db: Db)
  summariesForPr(prId: string): Promise<{ path: string; headSha: string; summary: string }[]>
}
```
- The container builds `store` inline over `reviewRepo` (as `intentService`'s deps are built): `findingsForPull` flat-maps `reviewsForPull` findings into `FindingLite`. The **service** filters `dismissedAt == null`, builds `marksByPath` (`line` = `startLine`, `finding_id` = the finding row `id`), drops marks whose `file` is not in `pr_files` (§7), and passes only summaries where `headSha === pull.headSha` (§7 staleness). Findings-fetch failure degrades to empty marks + `log.warn` (§7); pr-files/pull failures do not degrade — a missing pull is 404.
- `routes.ts`: `GET /pulls/:id/smart-diff`, `schema: { params: IdParams }`, returns `Promise<SmartDiff>` — shape mirrors `intent/routes.ts` exactly.
- Container: `get smartDiffRepo()`, `get smartDiffService()` lazy getters, following `intentRepo`/`intentService` shape (no `ContainerOverrides` key needed — nothing to mock beyond `llm`, which already has one).

**Skills:** `onion-architecture`, `fastify-best-practices`.

- [ ] **Step 1: Write the failing it-test** — copy `intent-routes.it.test.ts`'s harness shape (`startPg`/`dockerAvailable` gate, `seed`, `buildApp` with `MockLLMProvider`/`MockGitClient`/`MockGitHubClient` overrides, own `setupRepoAndPr` fixture with a fresh repo per case). Cases:
  - grouping: fixture PR with `pr_files` rows spanning three roles → groups in fixed order with correct membership;
  - marks: one review with a dismissed and a non-dismissed finding on the same file → only the non-dismissed becomes a mark; `finding_lines` equals the mark-line projection; a finding citing a path not in `pr_files` produces nothing;
  - pre-review: a PR with zero reviews → all `finding_marks: []`, grouping intact (acceptance #5);
  - `split_suggestion` numbers match the fixture arithmetic;
  - foreign-workspace PR → 404; non-uuid id → 422 (`/pulls/not-a-uuid/smart-diff`);
  - **the whole file asserts `llm.calls.length === 0` in an `afterAll`** — acceptance #3 as a test;
  - plus one hermetic case in the same file's describe (no DB needed): construct `SmartDiffService` directly with a stub store whose `findingsForPull` throws → `get()` resolves with every `finding_marks: []` and groups intact (§7 degradation).
- [ ] **Step 2: Run to verify failure** — `cd server && pnpm exec vitest run test/smart-diff-routes.it.test.ts` (Docker up). Expected: FAIL (404 route not found).
- [ ] **Step 3: Implement** the four module files + the two wiring edits.
- [ ] **Step 4: Verify** — the it-test PASSes; `pnpm exec vitest run --exclude '**/*.it.test.ts'` still green; `pnpm typecheck && pnpm arch:check` (exactly 24 known violations).
- [ ] **Step 5: Commit** — `feat(smart-diff): serve GET /pulls/:id/smart-diff — grouping, marks, splits, no model`.

---

### Task 5: Seed — the nine files that make the criteria demonstrable

**Files:**
- Modify: `server/src/db/seed.ts`
- Test: extend `server/test/smart-diff-routes.it.test.ts` (a seeded-PR describe block)

**Interfaces:**
- Consumes: Task 4's endpoint. Produces: the seeded PR #482 whose `GET .../smart-diff` yields 3 core / 4 wiring / 2 boilerplate and `split_suggestion { too_big: false, total_lines: 285 }`.
- The nine rows are the design §8 table verbatim (paths, +/−; Σ = 247/38). `src/config.ts` and `src/api/users.ts` get minimal unified-diff `patch` text whose hunks cover the line numbers the seeded findings already cite — read those numbers from the findings block in `seed.ts` itself, don't restate them. Other rows keep `patch: null`.
- Idempotency per §8: the `pr_files` block moves **outside** the `if (!pr)` branch; when the PR's existing file rows number fewer than nine, delete-and-insert the full set (`pr_files` has no `(pr_id, path)` unique index, so upsert is impossible). `pull_requests` row values (247/38/9) already match — assert, don't change.

**Skills:** `drizzle-orm-patterns`.

- [ ] **Step 1: Write the failing test** — new describe in `smart-diff-routes.it.test.ts`: resolve the seeded PR (repo `acme/payments-api`, number 482) from the already-run `seed()`, hit the endpoint, assert group sizes 3/4/2, `package-lock.json` in boilerplate (acceptance #1 server half), `total_lines: 285`, `too_big: false` (acceptance #7, #13), and that `src/config.ts`'s marks include the seeded CRITICAL's line.
- [ ] **Step 2: Run to verify failure** — seeded PR currently has 4 files → membership assertions FAIL.
- [ ] **Step 3: Implement the seed change**, then run the test twice against the same container (idempotency: second `seed()` call in the test must not duplicate or zero the rows).
- [ ] **Step 4: Verify** — it-file PASSes; existing `intent-review.it.test.ts` / other seed consumers still green: `pnpm exec vitest run .it.test`.
- [ ] **Step 5: Commit** — `feat(db): seed the demo PR's full nine-file diff so smart-diff criteria are demonstrable`.

---

### Task 6: Summary write path — prompt, model, POST route

**Files:**
- Create: `server/src/modules/smart-diff/prompt.ts`, `model.ts`
- Modify: `server/src/modules/smart-diff/{repository,service,routes,domain}.ts`, `server/src/platform/container.ts`
- Test: `server/test/smart-diff-summary.it.test.ts`

**Interfaces:**
- Consumes: `wrapUntrusted`, `INJECTION_GUARD` from `@devdigest/reviewer-core` (exported — verified); `LLMProvider.completeStructured({ model, schema, schemaName, messages, ... })`; `FeatureModelChoice` parsing pattern from `intent/repository.ts:54-64` (settings key `feature_models`, subkey `file_summary`); registry default read from `FEATURE_MODELS.find(f => f.id === 'file_summary')` — never restated (§4).
- Produces:
```ts
// prompt.ts
export const FILE_SUMMARY_SCHEMA_NAME = 'FileSummary'          // MockLLMProvider keys structuredBySchema by this
export const FileSummaryOutput = z.object({ summary: z.string() })  // module-local, NOT a shared contract
export function buildFileSummaryPrompt(path: string, patch: string): ChatMessage[]
// model.ts
export class FileSummaryModel {
  constructor(llm: LLMProvider, readonly provider: string, readonly model: string)
  summarize(path: string, patch: string): Promise<{ summary: string }>
}
// service.ts additions
summarize(workspaceId: string, prId: string, path: string): Promise<PrFileSummaryRecord>
// repository.ts additions
upsertSummary(prId: string, rec: { path; headSha; summary; provider; model }): Promise<void>  // onConflictDoUpdate on (prId, path), replaces wholesale incl. createdAt
featureModelChoice(workspaceId: string): Promise<{ provider; model } | undefined>
```
- Prompt contract (§5.1): system = a fixed instruction ("one sentence, what this change does, no preamble") + `INJECTION_GUARD`; user = trusted header naming the file + `wrapUntrusted('diff', patch)`. Patch truncated at `MAX_PATCH_CHARS` with an appended `… diff truncated (N more characters)` marker line when cut; returned summary sliced to `MAX_SUMMARY_CHARS` before persisting.
- `summarize` behaviour (§5): resolve pull (404 `Pull request not found`); `path` must be among `getPrFiles(prId)` paths **before any model call** (else same 404 error class, message `File not part of this pull request`); cached row with `headSha === pull.headSha` returns with no model call; in-flight `Set` keyed `` `${prId}:${path}` `` → `AppError('conflict', …, 409)` (mirror `IntentService`'s guard, including the `finally` release); provider failure propagates after the guard releases — nothing persisted. Route: `POST /pulls/:id/smart-diff/summary`, `schema: { params: IdParams, body: z.object({ path: z.string().min(1) }) }`; composition facts (provider, model, chars in/out) go to `app.log.info`, mirroring `intent/routes.ts`'s POST.
- Container: extend the `smartDiffService` getter with a `model` factory closure resolving `featureModelChoice(workspaceId) ?? registry default` → `this.llm(provider)` → `new FileSummaryModel(...)` — the exact shape of `intentService`'s `model` dep.

**Skills:** `onion-architecture`, `fastify-best-practices`, `zod`, `claude-api` (already loaded context: provider-agnostic structured call — no direct Anthropic SDK use here).

- [ ] **Step 1: Write the failing it-test** — harness as Task 4, `MockLLMProvider('openai', { structuredBySchema: { FileSummary: { summary: 'Adds a token-bucket limiter.' } } })` wired into the `openrouter` slot (the registry default's provider). Cases:
  - first POST for a seeded-fixture file → 200, record fields incl. `head_sha` = PR head, `model` = `google/gemini-2.5-flash-lite`; row present in `pr_file_summary`; exactly one `completeStructured` call;
  - second POST, same head → 200 from cache, **call count unchanged**; subsequent `GET /pulls/:id/smart-diff` carries the summary on that file (acceptance #8);
  - bump the PR's `head_sha` in the DB → GET no longer serves it; POST re-derives and replaces the row (call count +1);
  - `path` not in the PR → 404, call count unchanged;
  - provider failure (`structuredError` / throwing mock per `MockLLMOptions` — check its options surface) → 5xx, no row persisted (acceptance #9);
  - a model-choice case mirroring `intent-model-choice.it.test.ts`: write `settings.feature_models.file_summary = { provider, model }`, assert the returned record reports it (acceptance #10).
- [ ] **Step 2: Run to verify failure** — `pnpm exec vitest run test/smart-diff-summary.it.test.ts`. Expected: FAIL (no route).
- [ ] **Step 3: Implement** prompt, model, repository/service/route/container additions.
- [ ] **Step 4: Verify** — summary + routes + classify files all PASS; `pnpm typecheck && pnpm arch:check` (24).
- [ ] **Step 5: Commit** — `feat(smart-diff): on-demand per-file summary, cached on head_sha, 409 while in flight`.

---

### Task 7: Client plumbing — hooks + diff-viewer extensions

**Files:**
- Create: `client/src/lib/hooks/smart-diff.ts`; export from `client/src/lib/hooks/index.ts`
- Modify: `client/src/components/diff-viewer/FileCard/FileCard.tsx`, `CodeLine/CodeLine.tsx`, `diff-viewer/index.ts` (export `FileCard`), `diff-viewer/styles.ts` (mark styles)
- Test: `client/src/components/diff-viewer/FileCard/FileCard.test.tsx` (new)

**Interfaces (Produces):**
```ts
// hooks/smart-diff.ts — mirrors hooks/intent.ts shapes
export function useSmartDiff(prId: string | null | undefined)
  // useQuery, queryKey ["pr-smart-diff", prId], api.get<SmartDiff>(`/pulls/${prId}/smart-diff`), enabled: !!prId
export function useFileSummary(prId: string | null | undefined)
  // useMutation, mutationFn: (path: string) => api.post<PrFileSummaryRecord>(`/pulls/${prId}/smart-diff/summary`, { path })
  // onSuccess: setQueryData(["pr-smart-diff", prId], patch pseudocode_summary into the matching group file)
// FileCard — every prop optional, absent ⇒ today's behaviour byte-for-byte
open?: boolean; onToggle?: () => void        // controlled mode; uncontrolled state preserved when absent
marks?: FindingMark[]                        // type from @devdigest/shared
onMarkClick?: (findingId: string) => void
scrollToLine?: number | null                 // when set and open, scrollIntoView the matching new-side line once
headerExtra?: React.ReactNode                // the SummaryPill slot, rendered after the +/- stat
preBody?: React.ReactNode                    // the "What this does:" line, rendered above the lines when open
// CodeLine
mark?: FindingMark; onMarkClick?: (findingId: string) => void
```
- A mark anchors to a line where `ln.newNo === mark.line` and `ln.kind !== 'del'` (`Line` from `diff-viewer/helpers.ts` — `newNo` exists on add/ctx). The chip renders the severity (reuse the severity colour vars the findings surfaces use — read `FindingCard`'s styles for the variable names rather than inventing new ones) and calls `onMarkClick(mark.finding_id)`.
- SummaryPill/GroupSection do NOT live here — diff-viewer stays smart-diff-agnostic; the slots (`headerExtra`, `preBody`) are the boundary.

**Skills:** `react-best-practices`, `frontend-architecture`, `react-testing-library`.

- [ ] **Step 1: Write the failing tests** — `FileCard.test.tsx` (jsdom, no fetch needed): default uncontrolled render unchanged (header toggles body); controlled `open`+`onToggle` respected; a `marks` entry on a patched fixture renders one chip on the right line and click reports the `finding_id`; `scrollToLine` calls `scrollIntoView` (spy on `Element.prototype.scrollIntoView` — jsdom doesn't implement it) exactly once even after a re-render (latch); `headerExtra`/`preBody` render. Use `fireEvent` (no user-event in this repo — `client/INSIGHTS.md`).
- [ ] **Step 2: Run to verify failure** — `cd client && pnpm exec vitest run src/components/diff-viewer/FileCard/FileCard.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the extensions + hooks + barrel export.
- [ ] **Step 4: Verify** — file PASSes; full `pnpm test` still green (no regression in DiffTab/e2e-adjacent tests); `pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(client): diff-viewer mark/slot/controlled extensions + smart-diff hooks`.

---

### Task 8: SmartDiffViewer — the tab itself

**Files:**
- Create: `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/_components/SmartDiffViewer/` — `SmartDiffViewer.tsx`, `helpers.ts`, `constants.ts`, `styles.ts`, `index.ts`, `SmartDiffViewer.test.tsx`, `_components/{GroupSection,SplitBanner,SummaryPill}/` (each: component + `styles.ts` + `index.ts`)
- Modify: `DiffTab/DiffTab.tsx` (order toggle + conditional render), `[number]/page.tsx` (pass `order` from `?order=`, `onSetOrder` via existing `setParam`), `client/messages/en/prReview.json` (extend `smartDiff` block)
- Test: `SmartDiffViewer.test.tsx`

**Interfaces:**
- Consumes: `useSmartDiff`/`useFileSummary` (Task 7), extended `FileCard` (Task 7), `files: PrFile[]` already passed to `DiffTab`, existing `smartDiff` i18n keys.
- Produces:
```ts
// SmartDiffViewer.tsx
export function SmartDiffViewer(props: {
  prId: string | null
  files: PrFile[]                 // patches — SmartDiff carries none; joined by path in helpers.ts
  onOpenFinding: (findingId: string) => void   // page-level: setParam("tab","findings") + setParam("finding", id)
})
// helpers.ts
export function joinFilesWithGroups(groups: SmartDiffGroup[], files: PrFile[]): ...  // path → patch lookup
export function initialOpenState(groups: SmartDiffGroup[]): Record<string, boolean>  // §6.2 precedence: boilerplate closed even with findings; finding-bearing else open; else AUTO_EXPAND_MAX_LINES rule
```
- `DiffTab` renders a `Smart order | Original order` toggle in `SectionLabel`'s `right` slot (next to the existing comments button); `order === "original"` renders today's `DiffViewer` unchanged; default renders `SmartDiffViewer`. Order state lives in the URL (`?order=original`), owned by `page.tsx` like `?tab=`.
- GroupSection: role label from `smartDiff.{core,wiring,boilerplate}Label`, description line, `filesCount` count, per-file badge `{count} findings` (new key `findingsBadge`) whose click sets that file open + `scrollToLine` = first mark line — **latched in a ref keyed by a click counter, not by value** (client/INSIGHTS.md 2026-08-02).
- SplitBanner: renders only when `too_big`; `largeTitle`/`largeBody` keys + one line per proposed split (new key `splitFiles`: `"{name} — {count} files"`). Empty `proposed_splits` renders title+body only.
- SummaryPill (per file, in `headerExtra`): idle `✨ summary` button → `useFileSummary.mutate(path)`; pending state; on success the summary text renders via `preBody` ("What this does:" prefix, key `whatThisDoes`); on `ApiError` → `notify.error(err.message)` and pill returns to idle (the toast pattern `DiffTab` already uses). New i18n keys (add to the existing `smartDiff` block): `orderSmart`, `orderOriginal`, `findingsBadge`, `summarize`, `summarizing`, `whatThisDoes`, `splitFiles`, plus group descriptions `coreDesc`/`wiringDesc`/`boilerplateDesc` (§2.1 wording: boilerplate = "Generated, vendored or peripheral — skim").
- Loading state: `Skeleton`; error state: `ErrorState` with retry (both from `@devdigest/ui`, as `page.tsx` uses); `groups: []` → the existing "no changed files" empty copy.

**Skills:** `react-best-practices`, `frontend-architecture`, `react-testing-library`, `next-best-practices`.

- [x] **Step 1: Write the failing tests** — `SmartDiffViewer.test.tsx` with a mocked fetch returning a three-group `SmartDiff` fixture + matching `files`. QueryClient with `retry: false` for the error case (client/INSIGHTS.md 2026-08-03). Cases: three groups render in fixed order with labels and counts; boilerplate file collapsed even though it carries a mark, but badged (§6.2 precedence); finding-bearing core file open; badge click opens the file and calls `scrollIntoView`; chip click calls `onOpenFinding` with the id; summary pill: click → POST body `{ path }`, pending label, success renders the sentence; failure (stubbed `{ ok: false, status: 500, json: async () => ({ error: { message } }) }` — the `apiFetch` shape) → toast + idle; `DiffTab` with `order="original"` renders the flat `DiffViewer` (assert a `SmartDiffViewer`-only element is absent).
- [x] **Step 2: Run to verify failure** — `cd client && pnpm exec vitest run "src/app/repos/[repoId]/pulls/[number]/_components/DiffTab"`. Expected: FAIL.
- [x] **Step 3: Implement** components, DiffTab/page wiring, i18n keys.
- [x] **Step 4: Verify** — suite PASSes; `pnpm test` fully green; `pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(client): SmartDiffViewer as the default Files changed order`.

---

### Task 9: e2e flow + per-package specs

**Files:**
- Create: `e2e/specs/09-pr-smart-diff.flow.json` (the `NN-name.flow.json` convention — the runner globs this shape)
- Create: `server/specs/smart-diff.md`, `client/specs/smart-diff-display.md`
- Modify: `server/specs/README.md`? — no: check both `specs/README.md` files for an index list; add a line only if one exists. Link the new specs from `server/README.md` / `client/README.md` only where sibling specs (e.g. `intent.md`) are already linked — mirror, don't invent.

**Interfaces:**
- Consumes: Task 5's seed (PR #482, 9 files), Task 8's rendered copy (labels are uppercased by CSS — match rendered case, per `08-pr-intent.flow.json`'s note).
- Produces: a model-free flow: open app → PR list → PR #482 → click the Files changed tab → wait for the three group labels (rendered case: "Core", "Wiring", "Boilerplate" as CSS renders them — verify against the built UI, the 08 flow warns about text-transform) → assert `package-lock.json` visible with its diff body NOT rendered (`get count` on a lock-file-only patch string = 0) → click the findings badge on `src/config.ts` → wait for the CRITICAL line text to be visible. No summary click (needs a model key — same rule as 08).
- Spec files follow their folders' README conventions (read both READMEs first): `server/specs/smart-diff.md` = contract, behaviour (§2 classification tables, §5 endpoints, §7 degradation), acceptance mapped to the tests Tasks 3–6 wrote, and a Status/Design/Plan header like `intent.md`; `client/specs/smart-diff-display.md` = journey + states (loading/error/empty/pre-review/order-toggle), acceptance mapped to Tasks 7–8's tests.

**Skills:** `doc-writer` conventions apply, but the implementer writes these (they're per-task deliverables, not post-hoc docs).

- [ ] **Step 1: Write the flow** against a locally running hermetic stack (see `e2e/README.md` for the runner command) and run it: `cd e2e && npm ci` (first time) then the README's run command filtered to `09`. Expected: PASS against a freshly-seeded DB.
- [x] **Step 2: Write both spec files**, checking every behavioural claim against the shipped code (`file:line` where the spec convention uses them).
- [ ] **Step 3: Verify** — full gate: `cd server && pnpm typecheck && pnpm arch:check && pnpm exec vitest run --exclude '**/*.it.test.ts'` + `pnpm exec vitest run .it.test` (Docker); `cd client && pnpm typecheck && pnpm test`; e2e flow 09 green.
- [ ] **Step 4: Commit** — `feat(smart-diff): e2e flow and per-package specs` — then run the `pr-self-review` skill before any PR.

---

## Self-review notes (already applied)

- **Spec coverage:** §2→Task 3; §3.1→Task 2; §3.2→Task 4; §4→Task 1; §5→Tasks 4+6; §5.1→Task 6; §6→Tasks 7+8; §7→Tasks 4/6/8 tests; §8→Task 5; §9/§10 acceptance rows → named in the task whose test covers each. Acceptance #10 (Settings shows the feature) is Task 1's third registry copy (the Settings screen maps `FEATURE_MODELS` generically — verified) + Task 6's model-choice test. Acceptance #11 (original order identical) is Task 7's "absent props ⇒ today's behaviour" contract + Task 8's toggle test.
- **Known repo traps carried in:** three `FEATURE_MODELS` copies; `pr_files` wiped on every detail GET; `MockLLMProvider` keyed by `schemaName`; jsdom lacks `scrollIntoView` (spy it); no `user-event`; QueryClient `retry: false` for error tests; e2e text matched in rendered case; `arch:check` baseline stays at 24.
