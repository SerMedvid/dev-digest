# Design — Conventions Extractor: repo house-rules → an accepted, evidence-backed Skill

Date: 2026-08-03
Status: approved, not yet implemented

## Problem

A skill is the only way to teach a reviewer a house rule, and today every skill
is typed by hand. The rules are already in the repo — in the eslint config, in
the shape of every route handler, in how errors are wrapped — but getting them
into a skill means a human reading the codebase and paraphrasing it.

The scaffolding for the answer is in the repo, unfinished and disconnected:

- **The table exists and is empty.** `conventions` — `rule`, `evidence_path`,
  `evidence_snippet`, `confidence`, `accepted` — is defined in
  [`server/src/db/schema/knowledge.ts`](../../../server/src/db/schema/knowledge.ts).
  Zero code references it.
- **A contract exists.** `ConventionCandidate` in
  [`contracts/knowledge.ts`](../../../server/src/vendor/shared/contracts/knowledge.ts).
- **A sampler entrypoint exists.** `repoIntel.getConventionSamples(repoId, n)`
  ([`repo-intel/service.ts`](../../../server/src/modules/repo-intel/service.ts)),
  a pass-through to `getTopFilesByRank` — top-ranked files minus tests, configs
  and migrations.
- **A model slot exists.** `FEATURE_MODELS` carries a `conventions` entry, and
  Settings → Feature Models already renders it
  ([`contracts/platform.ts`](../../../server/src/vendor/shared/contracts/platform.ts)).
  The resolver, [`settings/feature-models.ts`](../../../server/src/modules/settings/feature-models.ts),
  has zero importers and its docstring names conventions explicitly.
- **The LLM mocks anticipate the flow.** `MockLLMProvider.structuredBySchema`
  documents a two-step dialogue: `ConventionFileSelection`, then
  `ConventionExtraction` ([`adapters/mocks.ts`](../../../server/src/adapters/mocks.ts)).
- **The copy exists.** [`client/messages/en/conventions.json`](../../../client/messages/en/conventions.json)
  is an i18n catalogue for a screen that was never built.
- **The consumer is finished.** Skills shipped: seven endpoints, versioning,
  ordered agent links, and injection into the review prompt
  ([`server/specs/skills.md`](../../../server/specs/skills.md)). `skills.source`
  already has an `'extracted'` variant and `skills.evidence_files` already
  exists — both unused.

What is missing is the middle: no `conventions` module, no route, no screen, and
nothing that turns an accepted candidate into a skill.

## Goal

One flow: **scan a cloned repo → review the candidates it found → accept, reject
or edit each → merge the accepted ones into a skill → optionally link that skill
to an agent.** Every candidate carries evidence that was verified in code, not
taken on the model's word.

The secondary goal is honesty about yield. A naive version of this feature
produces a handful of generic platitudes with hallucinated line numbers. Several
decisions below exist only to raise the count of *usable* candidates, and the
scan records why each rejected candidate was dropped.

## 1. Scope

**In scope**

- A `conventions` module owning the `conventions` table and a new
  `convention_scans` table.
- Five endpoints: extract, read, patch one candidate, read the skill draft,
  create the skill.
- A two-step LLM extraction behind a deterministic code-built file pool.
- Code-side evidence verification, deduplication and per-category quotas.
- One repo-scoped screen with accept / reject / edit and a create-skill modal.
- One paragraph appended to [`server/specs/skills.md`](../../../server/specs/skills.md)
  recording that `source: 'extracted'` now exists (see §7).

**Out of scope**

- Multiple skills from one scan. One merged skill per repo, matching the design
  mockups.
- Preserving accept/reject decisions across a re-scan. A scan replaces the
  repo's candidates wholesale (§5).
- Measuring how often a rule actually holds across the repo. This is the single
  strongest quality lever available and it is deliberately deferred — see §10.
- Any change to `reviewer-core`. The `skills` prompt slot already exists and is
  untouched.
- Any change to `POST /skills`. Its contract keeps `source: 'manual'`.

## 2. Data model

Both migrations are additive-or-empty: `conventions` has never held a row, so
there is no backfill anywhere in this design.

### 2.1 `conventions` — four changes

| Change | Why |
|---|---|
| `+ category text` (enum, see below) | the model must return a category; there is no column for it |
| `+ evidence_line integer` | evidence is a file **and a line**; only `evidence_path` exists |
| `− accepted boolean` → `+ status text` | a boolean cannot distinguish *rejected* from *not yet decided*, and the screen has three states |
| `+ created_at` | stable ordering |

`status`: `pending` (default) · `accepted` · `rejected`.

`category`, a closed enum: `naming` · `structure` · `error-handling` ·
`api-shape` · `testing` · `imports` · `typing` · `tooling`.

Dropping `accepted` rather than keeping it alongside `status` is deliberate: two
columns encoding one decision is how they drift.

### 2.2 `convention_scans` — new, one row per repo

Mirrors [`repo_index_state`](../../../server/src/db/schema/repo-intel.ts): a
single row per repo, primary-keyed on `repo_id`, kept current by the worker.

| Column | Meaning |
|---|---|
| `repo_id` | PK → `repos.id`, cascade |
| `status` | `queued` · `running` · `done` · `failed` |
| `pool_count` | code-file paths offered to step 1 (configs are not in the pool — §4) |
| `sample_count` | files actually read and sent to step 2, configs included |
| `candidate_count` | candidates that survived verification |
| `dropped` | jsonb, drop reason → count |
| `provider`, `model` | what actually ran, for cost attribution |
| `error` | `failed` only |
| `started_at`, `finished_at` | the "last scan 1h ago" line |

`pool_count` and `sample_count` are both stored because their ratio is the only
evidence that step 1 is doing anything. `dropped` is the feature's own feedback
loop: without it, a scan that yields two candidates is indistinguishable from a
scan that yielded twenty and threw eighteen away.

## 3. Contract

The Zod definitions in `contracts/knowledge.ts` are the source of truth, and
`@devdigest/shared` is **two physical copies that have already drifted** — every
edit lands in `client/src/vendor/shared/` too, and both packages type-check.

| Contract | Change |
|---|---|
| `ConventionCategory` (new) | the eight-value enum |
| `ConventionStatus` (new) | `pending \| accepted \| rejected` |
| `ConventionCandidate` | `+ category`, `+ evidence_line`; `accepted: boolean` → `status: ConventionStatus` |
| `ConventionScan` (new) | the row above, minus `repo_id` |
| `ConventionsView` (new) | `{ scan: ConventionScan \| null, candidates: ConventionCandidate[] }` |
| `ConventionSkillDraft` (new) | `{ name, description, type, body, token_estimate }` |

### Endpoints

All workspace-scoped through `getContext`. A repo or candidate in another
workspace is a **404, never a 403**.

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/repos/:id/conventions/extract` | Sets the scan row to `queued`, enqueues a `conventions.extract` job, returns **202** + `jobId`. **409** when a scan for that repo is already `queued`/`running`. |
| `GET` | `/repos/:id/conventions` | `ConventionsView`. Always succeeds; a repo that was never scanned returns `{ scan: null, candidates: [] }`. The poll target. |
| `PATCH` | `/conventions/:id` | Partial patch of `status`, `rule`, `evidence_path`, `evidence_line`, `evidence_snippet`. Serves both accept/reject and editing a candidate. |
| `GET` | `/repos/:id/conventions/skill-draft` | The merged body assembled from the repo's `accepted` candidates, plus a token estimate. **409** when nothing is accepted. |
| `POST` | `/repos/:id/conventions/skill` | Creates the skill through `SkillsService` with `source: 'extracted'` and `evidence_files` = the accepted candidates' paths. With `agent_id`, links it in the same request. **201**. The body is the client's, edits included — the server does not re-derive it — but the call still **409**s when the repo has no accepted candidates, so an extracted skill always has evidence behind it. |

### Validation

Rejected at the route with a **422**:

| Field | Rule |
|---|---|
| `rule` | 1–300 characters |
| `evidence_path` | 1–400 characters |
| `evidence_line` | integer ≥ 1 |
| `evidence_snippet` | ≤ 2 000 characters |
| `status` | the enum |
| skill fields on `POST …/skill` | the limits already in [`skills.md`](../../../server/specs/skills.md) — name 1–80, body 1–20 000, description ≤ 300 |
| `:id` | uuid (a non-uuid is a 422, not a 404) |

### Why the skill gets its own endpoint

`POST /skills` could take an optional `source`, but
[`skills.md §3.4`](../../../server/specs/skills.md) pins `source` to `'manual'`
and rests a security decision on it. A dedicated endpoint keeps that contract
intact and makes "create the skill and link it to the agent" one call instead of
two client round-trips that can half-fail.

### Why the draft is assembled server-side

The merged body is prompt text: it has a format worth testing, and
`container.tokenizer` lives on the server. The client fetches it, then owns it
as local state — the `unsaved` badge in the mockup is exactly that.

## 4. The pipeline

`modules/conventions/`, layered per
[`server/CLAUDE.md`](../../../server/CLAUDE.md): `routes.ts` · `service.ts` ·
`repository.ts` · `sampler.ts` · `verify.ts` · `skill-body.ts` · `prompts.ts` ·
`constants.ts`. No raw Drizzle outside `repository.ts`; adapters come off the
container.

It is a new module rather than an extension of `repo-intel` because `repo-intel`
is a tenant-agnostic indexer with no LLM and no user-owned state. Conventions
needs workspace scoping, a model call, and CRUD over a human's decisions. It
*consumes* `container.repoIntel`.

### Step 0 — the pool, entirely in code

Two parts, and they are not equals.

**Configs always go in and never pass through model selection.**
`eslint.config.*` / `.eslintrc*`, `tsconfig.json`, `.prettierrc*` /
`prettier.config.*`, `biome.json`, `.editorconfig`, `package.json`. They are the
densest source of real, already-agreed rules in any repo; letting a model decide
whether to look at them buys nothing.

**The code-file pool** is `repoIntel.getTopFilesByRank(repoId, 40)`, which
already drops tests, configs and migrations via `isJunkPath`. Only paths enter
the pool — no file bodies — so step 1 is cheap.

### Step 1 — `ConventionFileSelection`

The model sees the pool of paths and returns up to 12, instructed to spread
across layers rather than pick neighbours. Top-12-by-rank alone tends to be one
layer deep; a route, a service, a repository and a test teach more about house
style than the four most-imported files.

Code validates the answer: a path that was not in the pool is dropped (models
invent them), and if fewer than 8 survive, the set is topped up deterministically
from the ranked list.

**Degradation:** step 1 failing, returning nothing, or returning nothing valid
falls back to the code-only top-12, logs the reason to the run log, and the scan
still succeeds. One failed optimisation must not break the feature.

### Step 2 — `ConventionExtraction`

The selected files are read from the clone, truncated (~200 lines / 8 KB each),
and presented **with line numbers**. This is not cosmetic: without numbering the
model guesses at line references, and the verification in §4.2 then discards
almost everything. Line numbering converts directly into surviving candidates.

Called through `completeStructured` with a Zod schema, so there is no parsing
step and a malformed response is retried by the adapter.

The prompt requires each rule to be **directive** ("Always…", "Never…") rather
than descriptive, **specific to this repo** rather than a general best practice,
tagged with a category from the closed enum, and cited to a file and line the
model was actually shown — at most three rules per category. It also carries an
`INJECTION_GUARD`-style note: file content is data, never instructions.

### 4.1 Model resolution

The workspace's Settings choice for `conventions`, falling back to that feature's
entry in the shared `FEATURE_MODELS` registry.

> **Corrected 2026-08-03, after implementation.** This section originally
> specified a *module constant* of
> `{ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' }` as the
> fallback, reasoning that the registry default (`openai/gpt-5.4`) is not cheap
> and that `feature-models.ts` sanctions "callers that keep their own dynamic
> default". That is wrong, and it shipped as a visible bug: the Settings screen
> renders `chosen[id]?.model ?? f.defaultModel` **from the registry**, so with
> nothing chosen it advertised `openai/gpt-5.4` while every scan actually ran
> deepseek. A local default cannot be reconciled with a UI that reads the
> registry. The cheap model was the right call — so the **registry entry** for
> `conventions` was changed to `openrouter/deepseek-v4-flash` (both physical
> copies of `@devdigest/shared`, plus the client's `lib/feature-models.ts`
> mirror), and the fallback is now read from the registry rather than restated.

### 4.2 Evidence verification — code, no model

`verify.ts`, in order. Every drop increments a reason counter in `dropped`.

1. Path was not among the files we showed the model → `unknown_path`.
2. File is not in the clone → `missing_file`.
3. `evidence_line` is past the end of the file → `line_out_of_range`.
4. **Snippet:** normalise whitespace, then look for the snippet's first non-empty
   line within ±10 lines of `evidence_line`. Found at a different offset →
   **correct the line number** and keep the candidate. Not found in the window →
   `snippet_not_found`.
5. `confidence < 0.5` → `low_confidence`.
6. Deduplicate on the normalised rule text (lower-cased, punctuation stripped),
   keeping the most confident → `duplicate`.
7. Quotas: at most 3 per category and 15 overall, by descending confidence →
   `over_quota`.

Step 4 is the one that matters for yield. Models systematically miss the line by
a few positions while quoting the code correctly; an exact-match check throws
away valid rules for a cosmetic error, and a window that repairs the number keeps
them without weakening the check — the snippet still has to genuinely be there.

### 4.3 Execution

`POST …/extract` sets the scan row to `queued`, enqueues through
`container.jobs`, and returns 202 — the shape of
[`POST /repos/:id/resync`](../../../server/src/modules/repo-intel/routes.ts). The
worker moves to `running`, runs steps 0–2, replaces the repo's candidates in one
transaction, and writes `done` with its statistics. Every failure path writes
`failed` plus `error`: a scan must never be left `running` forever. The handler
registers once at plugin boot, like `registerIndexJobHandlers`.

## 5. Degradation

| Situation | Behaviour |
|---|---|
| Repo not indexed | Pool is empty → configs only. The screen says so and links to resync rather than showing an empty list. |
| No index and no configs | Scan completes `done` with 0 candidates and a reason. Not an error. |
| Step 1 fails or returns junk | Falls back to code-only top-12; scan succeeds. |
| No API key for the resolved provider | Scan is `failed` with a readable `error`. |
| Every candidate fails verification | `done`, `candidate_count: 0`, and `dropped` explains it. The screen shows the reasons. |
| `extract` while a scan is `running` | 409. Two concurrent scans would overwrite each other's rows. |
| Re-scan after decisions were made | **Replaces all candidates for the repo.** Accepted and rejected decisions are lost — see below. |
| Repo or candidate in another workspace | 404 on every route. |

**On replace-all.** Upserting by normalised rule text would preserve decisions,
at the cost of a normalisation key and a unique index. Replace-all was chosen
for simplicity, which means rejected noise returns on every scan and accepted
edits are lost. The mitigation is that the loss is never silent: Re-scan asks for
confirmation and names the count — *"This discards 2 accepted and 5 rejected
conventions."* A skill already created from a previous scan is unaffected; it is
an independent row in `skills`.

## 6. UI

The feature is repo-scoped — the mockup reads "Conventions in `payments-api`" —
so the route is `/repos/:repoId/conventions`.

[`nav.ts`](../../../client/src/vendor/ui/nav.ts) gains one entry in the
`SKILLS LAB` group (`href: "/repos/:repoId/conventions"`, `gKey: "c"`) and one
`SHORTCUTS` row. `nav.ts` is vendored, but it is a data registry, not a
primitive: adding a record is in bounds, restructuring the file is not.

Components follow the folder-per-component convention, with Tailwind strings in
`styles.ts`:

```
app/repos/[repoId]/conventions/page.tsx        thin; composition only
  _components/ConventionsView/
    ScanHeader/                    "Detected from N sample files · last scan X ago" + Re-scan
    SelectionBar/                  "Deselect all · 3 of 3 accepted" + Create skill
    ConventionCard/                rule · path:line · snippet · confidence · Accept/Reject · inline edit
    CreateConventionSkillModal/    prefilled from skill-draft + agent picker
```

Data goes through one path only — component → hook → `api`. New file
`lib/hooks/conventions.ts`: `useConventions(repoId)` with a 2.5 s
`refetchInterval` while `scan.status` is `queued` or `running` and no polling
otherwise, plus `useExtractConventions`, `usePatchConvention`,
`useConventionSkillDraft`, `useCreateConventionSkill`, each with explicit
`invalidateQueries`.

**Six states the screen must cover:** repo not indexed · never scanned (CTA) ·
scanning · finished with zero candidates (the drop reasons, not a blank slate) ·
candidates present · `failed` with its error.

**Re-scan confirms** and names what it will destroy, per §5.

**The modal** follows the mockup: "Merged from N accepted conventions in
`<repo>`", then Name / Description / Type / Enabled / Skill body with the token
count, and the footer note "Saved as v1 · added to Skills Lab". It adds one field
the mockup lacks: `Link to agent (optional)`, which is what closes the loop from
extraction to a review prompt.

**Copy** extends the existing [`messages/en/conventions.json`](../../../client/messages/en/conventions.json)
rather than introducing a second catalogue; its terminology ("house-rules",
"grounded against sampled files") is the wording to keep.

## 7. Trust: what `source: 'extracted'` costs

[`skills.md §3.4`](../../../server/specs/skills.md) renders skill bodies
**verbatim as trusted instructions, not delimiter-wrapped**, and justifies that
solely by `source` always being `'manual'`. It then requires the decision to be
revisited *before* any other source merges. This section is that revisit.

An extracted skill's body derives from repository content, including code
snippets. A file in the repo can contain "ignore previous instructions", a model
can surface it as a convention, and it would then enter every review prompt as a
trusted instruction.

**Decision: keep the verbatim rendering.** The trust boundary here is a person,
not a parser. What holds it up:

- No candidate reaches a skill without an explicit accept.
- The full merged body is visible and editable before it is saved.
- Evidence snippets are capped at 10 lines and fenced; whole files never reach
  the body.

This is a procedural guarantee, not a technical one, and the spec should not
pretend otherwise. Accordingly, `server/specs/skills.md` gains a paragraph
recording that `'extracted'` now exists, what backs it, and a link here — so the
next reader does not assume `'manual'` is still the only source.

## 8. Testing

**Server, hermetic** (`*.test.ts`, adapters mocked via `adapters/mocks.ts`):

- `sampler` — config discovery, truncation, empty index.
- Step-1 validation — path not in pool, top-up to 8, fallback path.
- `verify.ts` — one case per drop reason, plus the ±10 line repair, dedup, and
  quotas.
- `skill-body.ts` — the merged body format.

**Server, DB-backed** (`*.it.test.ts`, testcontainers):

- `extract` → 202 and a scan row; a second call while `running` → 409.
- `GET` returns scan + candidates; never-scanned → `{ scan: null, … }`.
- `PATCH` — accept, reject, and editing each field.
- `POST …/skill` → `source: 'extracted'`, `evidence_files` populated, the agent
  linked, and **the agent's version bumped** (per `skills.md §3.3`).
- Every route 404s for another workspace.
- The LLM is `MockLLMProvider` driven by `structuredBySchema` — both schema names
  are already documented there.

**Client** (vitest + jsdom, fetch mocked): all six `ConventionsView` states,
card accept/reject/edit, the Re-scan confirmation, modal prefill and creation.

**Gates before this is called done:** `pnpm typecheck` in `server/` and
`client/`, `pnpm arch:check`, and both copies of `@devdigest/shared` edited in
step.

## 9. Acceptance

1. `POST /repos/:id/conventions/extract` returns 202 with a `jobId` and leaves a
   `queued` scan row; a second call while it runs returns 409.
2. After the worker finishes, `GET /repos/:id/conventions` returns `done`, a
   `sample_count`, a `pool_count`, and candidates each carrying a category and a
   line that exists in the file named.
3. A candidate whose snippet is absent from its file within ±10 lines does not
   appear, and `dropped.snippet_not_found` counts it.
4. A candidate whose snippet is present but at a different line appears with the
   corrected line number.
5. Two candidates with the same normalised rule collapse to the more confident.
6. `PATCH /conventions/:id` accepts, rejects, and edits a candidate's rule and
   evidence.
7. `GET …/skill-draft` returns a body containing a section per accepted
   candidate and 409s when none are accepted.
8. `POST …/skill` creates a skill with `source: 'extracted'` and
   `evidence_files`; with `agent_id`, the skill is linked and the agent's version
   is bumped.
9. A review run by that agent contains the merged conventions in
   `## Skills / rules`.
10. Re-scan asks for confirmation naming the decisions it discards, and after it
    completes the repo's previous candidates are gone.
11. An unindexed repo scans configs only and says so on screen.

## 10. Yield: what is in, what is deferred

**In this iteration:** configs always sampled · model-chosen files spread across
layers · line-numbered prompt · line repair instead of rejection · dedup and
per-category quotas · `dropped` telemetry by reason.

**Deferred, in rough order of value:**

1. **Count real occurrences with `container.astgrep`.** Turning a rule into a
   pattern and counting how often the repo obeys it would make `confidence`
   *measured* rather than model-asserted, and would let the screen sort by "holds
   in 34 of 36 places" — which is what a reviewer actually wants to know. This
   is the strongest available quality lever and the obvious next step.
2. **A judge pass** that drops non-directive or generic rules before a human ever
   sees them.
3. **Mine code review history** from git — the rules a team actually enforces are
   in its review comments, not only in its code.
4. **Per-category extraction calls** instead of one, for depth over breadth.
5. **Multiple skills** instead of one merged body, once there are enough
   candidates per category to justify it.

## 11. Follow-up work this unblocks

`ConventionFileSelection` and `ConventionExtraction` are the two schema names
already documented in `adapters/mocks.ts`; implementing them makes that fixture
map real. The `conventions` entry in `FEATURE_MODELS` and the `feature-models.ts`
resolver both stop being dead code. Neither is a goal of this design, but both
should be noted as no longer orphaned when the module lands.
