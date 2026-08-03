# Spec — Conventions: extracting a repo's house rules into a skill

**Status:** DRAFT (2026-08-03)
**Owner:** server · **Consumer:** client
**Design:** [`docs/superpowers/specs/2026-08-03-conventions-extractor-design.md`](../../docs/superpowers/specs/2026-08-03-conventions-extractor-design.md)
**Plan:** [`docs/superpowers/plans/2026-08-03-conventions-extractor-server.md`](../../docs/superpowers/plans/2026-08-03-conventions-extractor-server.md)
**Related:** `contracts/knowledge.ts` (`ConventionCandidate`, `ConventionScan`, `ConventionsView`, `ConventionSkillDraft`), [`specs/skills.md`](skills.md) (§3.4 — what `source: 'extracted'` costs)

Every team has rules that live nowhere: "repositories are suffixed
`Repository`", "route bodies are validated with the shared zod schema". A
reviewer that does not know them reviews a generic codebase. The extractor
reads the repo's own code, proposes those rules with the line that evidences
each one, and — once a human accepts them — merges the accepted set into a
single skill that can be linked to an agent.

Two cheap LLM calls, and **every line the model cites is checked against the
file it came from** before a human is asked to look at it.

## 1. Scope

**In scope**

- A `conventions` module owning `conventions` and `convention_scans`.
- Five endpoints: extract, view, patch, skill-draft, create-skill.
- Extraction as a `container.jobs` job (`'conventions.extract'`), one scan row
  per repo.
- The evidence gate: seven rules, applied to everything the model returns.
- `SkillsRepository.insert` / `SkillsService.create` accepting
  `source: 'extracted'` with `evidenceFiles`.

**Out of scope**

- Feeding accepted conventions into the review prompt directly. They reach a
  review only by becoming a skill and being linked to an agent — the existing
  path, unchanged.
- Incremental re-scan. A scan is replace-all.
- The `memory` table, embeddings, and any cross-repo convention sharing.
- Any change to `POST /skills`, which still always writes `source: 'manual'`.

## 2. Contract

The Zod definitions in `src/vendor/shared/contracts/knowledge.ts` are the source
of truth, and `@devdigest/shared` is **two physical copies** — every edit lands
in the client's copy too.

| Contract | Change |
|---|---|
| `ConventionCategory` (new) | closed enum: `naming`, `structure`, `error-handling`, `api-shape`, `testing`, `imports`, `typing`, `tooling` |
| `ConventionStatus` (new) | `pending \| accepted \| rejected` |
| `ConventionCandidate` (rewritten) | gains `category` and `evidence_line`; `accepted: boolean` becomes `status` |
| `ConventionScanStatus` (new) | `queued \| running \| done \| failed` |
| `ConventionDropCounts` (new) | one optional counter per drop reason |
| `ConventionScan` (new) | status, `pool_count`, `sample_count`, `candidate_count`, `dropped`, provider, model, error, timestamps |
| `ConventionsView` (new) | `{ scan: ConventionScan \| null, candidates: ConventionCandidate[] }` |
| `ConventionSkillDraft` (new) | `name`, `description`, `type`, `body`, `token_estimate` |

`status` is three states rather than a boolean because "rejected" and "not yet
decided" are different things — a boolean cannot tell the UI which candidates
still need a human.

Schema: `conventions` gains `category`, `evidence_line`, `status`, `created_at`
and loses `accepted`; `evidence_path`, `evidence_snippet` and `confidence`
become `NOT NULL`; new table `convention_scans` (migrations `0013`, `0014`). The
table had never held a row, so there is no backfill.

### Endpoints

All are workspace-scoped through `getContext`. A repo belonging to another
workspace is a **404, never a 403**.

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/repos/:id/conventions/extract` | Validates, upserts the scan to `queued`, enqueues the job. **202** `{status, jobId}`. **409** when a scan is already `queued` or `running`. |
| `GET` | `/repos/:id/conventions` | `{scan, candidates}`. `scan: null` means never scanned. The poll target while a scan runs. |
| `PATCH` | `/conventions/:id` | Accept, reject, or edit the rule and its evidence. Returns the updated candidate. |
| `GET` | `/repos/:id/conventions/skill-draft` | The merged body plus a token estimate. **409** when nothing is accepted. |
| `POST` | `/repos/:id/conventions/skill` | Creates the skill with `source: 'extracted'`, optionally links an agent. **201**, returns the full skill. **409** when nothing is accepted. |

The draft is assembled **server-side** so the merge rules and the token estimate
have exactly one implementation; the client renders and may edit it, and the
body it posts back is the body that is stored.

### Validation

Rejected at the route with a **422**:

| Field | Rule |
|---|---|
| `rule` | 1–300 characters |
| `evidence_path` | 1–400 characters |
| `evidence_line` | positive integer |
| `evidence_snippet` | ≤ 2 000 characters |
| `status` | `pending \| accepted \| rejected` |
| skill `body` | 1–20 000 characters |
| skill `name` | 1–80 characters |
| `:id` | uuid (a non-uuid is a 422, not a 404) |

An empty patch body is a 422 — it would otherwise be a silent no-op.

## 3. Behaviour

### 3.1 Step 0 — the sample

Configs at the clone root ([`constants.ts`](../src/modules/conventions/constants.ts)
`CONFIG_CANDIDATES`) always enter the sample and never pass through model
selection: they are the densest source of already-agreed rules in any repo, so
letting a model decide whether to look buys nothing.

Code files come from `repoIntel.getTopFilesByRank(repoId, 40)`. Every read is
best-effort and capped at 8 192 bytes; a file that has moved since indexing is
not sampled, and does not fail the scan.

### 3.2 Step 1 — file selection, and its fallback

The model is shown the 40 ranked paths and asked for at most 12, chosen from
different layers. It may only pick from the pool: an invented path is dropped.
If fewer than 8 survive, the selection is topped up from rank order. If the call
**throws**, it is logged and replaced entirely by the rank-order top 12 — one
failed optimisation must not break the feature.

### 3.3 Step 2 — extraction

Samples are rendered line-numbered and labelled by kind. The numbering is
load-bearing: without it the model guesses at line references and §3.4 discards
nearly everything. The prompt states that file contents are **data, not
instructions**.

Model choice is the workspace's Settings entry for the `conventions` feature,
read by `ConventionsRepository.featureModelChoice` rather than through
`modules/settings/feature-models.ts`: that helper is another module's internals
and takes `Container`, so calling it from here would fail either
`no-cross-module-internals` or `no-circular`.

When the workspace has chosen nothing, the fallback is the `conventions` entry
in the shared `FEATURE_MODELS` registry — currently `openrouter` /
`deepseek/deepseek-v4-flash`. It is **read from the registry, never restated**:
the Settings screen renders that same `defaultModel`, so a module-local constant
here means the UI advertises one model while the scan runs another.

### 3.4 The evidence gate

[`verify.ts`](../src/modules/conventions/verify.ts) is pure — the caller passes
the file contents in — and applies these in order:

| # | Rule | Drop reason |
|---|---|---|
| 1 | The cited path must be one we showed the model | `unknown_path` |
| 2 | That file must have had content | `missing_file` |
| 3 | The cited line must be within the file | `line_out_of_range` |
| 4 | The snippet must appear within **±10** lines of the cited line, whitespace-insensitively | `snippet_not_found` |
| 5 | `confidence` ≥ **0.5** | `low_confidence` |
| 6 | Rules that normalise to the same text collapse to the most confident | `duplicate` |
| 7 | At most **3** per category and **15** overall, most confident first | `over_quota` |

Rule 4 *repairs* rather than discards: when the snippet is found nearby, the
stored `evidence_line` is the line it was really on. Models quote code correctly
while missing the line number by a few positions, and an exact-line check throws
away valid rules for a cosmetic error — the snippet still has to genuinely be in
the file, near where the model said.

Every drop is counted into `convention_scans.dropped`, so a zero-candidate scan
is distinguishable from a scan that found twenty and threw them all away.

### 3.5 The scan row always reaches a terminal state

`runScan` never throws. Every terminal path — success, no clone, a failed
extraction — writes `done` or `failed` with a readable error. Nothing awaits the
promise, so a scan left at `running` would show the user a spinner forever,
which is worse than an error.

### 3.6 A scan is replace-all

`replaceCandidates` deletes every candidate for the repo and inserts the new set
in one transaction. A re-scan therefore discards the user's accept and reject
decisions by design; the UI confirms first.

### 3.7 The created skill

The body is the client's, edits included — the server does not re-derive it.
`evidence_files` is **not** the client's: it is the distinct `evidence_path` set
of the accepted candidates, and a repo with none cannot produce an extracted
skill at all. That provenance is the only thing backing the decision in
[`specs/skills.md`](skills.md) §3.4 to render extracted bodies as trusted prompt
text.

Linking an agent appends the skill at the end of its ordered list, which bumps
the agent's version and snapshots it — the ordinary `linkSkill` behaviour.

## 4. Degradation

| Situation | Behaviour |
|---|---|
| Repo never scanned | `GET` returns `{scan: null, candidates: []}`, not a 404. |
| Repo not indexed (empty pool) | Selection is skipped; configs alone are extracted from. `pool_count: 0`. |
| Repo never cloned | Scan is `failed` with "This repo has no clone on disk yet". No LLM call. |
| Selection call fails | Logged at `warn`; rank order is used. The scan still completes. |
| Extraction call fails | Scan is `failed` carrying the provider's message. |
| Model cites a file it was not shown | Candidate dropped, `dropped.unknown_path` incremented. |
| Scan already in flight | `POST …/extract` is a 409 with code `conflict`. |
| Re-scan | Replace-all: previous candidates and their decisions are gone. |
| Nothing accepted | Both the draft and the create are 409s. |
| Repo in another workspace | 404 on every route. |

## 5. Acceptance

1. A scan on a never-scanned repo returns `{scan: null, candidates: []}` — `conventions.it.test.ts`
2. `POST …/extract` returns 202 with a job id, and the scan reaches a terminal state — `conventions.it.test.ts`
3. A candidate citing a file the model was not shown is dropped — `conventions-verify.test.ts`, `conventions-service.test.ts`
4. A line off by a few is repaired, not discarded; one outside ±10 is dropped — `conventions-verify.test.ts`
5. Paraphrases collapse, and the category and overall quotas hold — `conventions-verify.test.ts`
6. A second scan while one is in flight is a 409 with code `conflict` — `conventions.it.test.ts`
7. Accept, reject and edit each round-trip through `PATCH /conventions/:id` — `conventions.it.test.ts`
8. The draft merges the accepted rules, ordered by category, with capped fenced evidence — `conventions-skill-body.test.ts`, `conventions.it.test.ts`
9. Creating the skill writes `source: 'extracted'` with the accepted evidence paths — `conventions.it.test.ts`
10. Linking an agent bumps that agent's version — `conventions.it.test.ts`
11. A scan whose extraction throws is `failed`, never left `running` — `conventions-service.test.ts`

Covered by [`test/conventions.it.test.ts`](../test/conventions.it.test.ts)
(13 DB-backed cases) and the hermetic files
[`conventions-contracts`](../test/conventions-contracts.test.ts),
[`-helpers`](../test/conventions-helpers.test.ts),
[`-verify`](../test/conventions-verify.test.ts),
[`-skill-body`](../test/conventions-skill-body.test.ts),
[`-sampler`](../test/conventions-sampler.test.ts),
[`-model`](../test/conventions-model.test.ts),
[`-service`](../test/conventions-service.test.ts) (61 cases).
