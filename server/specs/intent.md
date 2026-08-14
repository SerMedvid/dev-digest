# Spec — Intent: what a pull request is trying to do

**Status:** DRAFT (2026-08-05)
**Owner:** server · **Consumers:** client, `reviewer-core`
**Design:** [`docs/superpowers/specs/2026-08-05-intent-layer-design.md`](../../docs/superpowers/specs/2026-08-05-intent-layer-design.md)
**Plan:** [`docs/superpowers/plans/2026-08-05-intent-layer.md`](../../docs/superpowers/plans/2026-08-05-intent-layer.md)
**Related:** `contracts/brief.ts` (`Intent` — defined there and only *imported* by
`review-api.ts`), `contracts/review-api.ts` (`IntentConfidence`, `PrIntentRecord`),
`contracts/findings.ts` (`Finding.out_of_scope`), `contracts/trace.ts` (`PromptAssembly.intent`)

A reviewer that does not know what a PR set out to do reviews it against
everything it could conceivably have done, and every stylistic preference in a
touched file becomes a finding. The intent layer derives one sentence plus two
lists — what this PR is for, and what it deliberately is not — from the material
the author already wrote, persists it per PR with the evidence it rests on, feeds
it to the reviewer, and then filters the resulting *noise* deterministically.

Two things make that safe rather than a suppression mechanism. Confidence is
**computed from the sources that arrived**, never asked of the model. And the
filter is **code, not a prompt instruction**: the model may mark a finding
`out_of_scope`, but only a narrow, enumerated combination is ever dropped.

## 1. Scope

**In scope**

- An `intent` module owning derivation: sources, confidence, model resolution.
- Two endpoints: read the stored intent, derive it now.
- Persistence into `pr_intent` (one row per PR), owned by the reviews aggregate.
- The `intent` prompt slot in `reviewer-core` and the post-grounding
  `scopeFindings` gate.
- Automatic derivation inside a review run, once per batch, cached on `head_sha`.
- The Intent card on the PR overview.

**Out of scope**

- Jira/Linear/any non-GitHub tracker; fetching arbitrary external URLs.
- Cross-repository issues and documents — recognised only to be *recorded* as
  unretrieved.
- Using `in_scope` to select which files get reviewed (a Smart Diff concern).
- PR labels, and composing the intent into the PR brief (L05, see
  [`brief.md`](brief.md)). The `linked_issue` column this section once reserved
  **landed with L05** — it is written here, at derivation, and read there.
- Any UI badge on an out-of-scope finding — see §7.

## 2. Contract

The Zod definitions in `src/vendor/shared/contracts/` are the source of truth,
and `@devdigest/shared` is **two physical copies** — every edit lands in the
client's copy too.

| Contract | Shape |
|---|---|
| `Intent` | exactly three fields: `intent`, `in_scope`, `out_of_scope`. This is what the **model** fills, which is why confidence is not in it. |
| `IntentConfidence` | closed enum `high \| medium \| low` |
| `PrIntentRecord` | `Intent` extended with `pr_id`, `head_sha`, `confidence`, `sources`, `missing_context`, `provider`, `model`, `created_at` |
| `Finding.out_of_scope` | `boolean` nullish. Absent when no intent was in the prompt. |
| `PromptAssembly.intent` | the rendered intent block, or `null` |

Schema: `pr_intent` gains `head_sha`, `confidence`, `sources`, `missing_context`,
`provider`, `model`, `created_at`; `findings` gains `out_of_scope` (NOT NULL,
default `false`). Additive only — every added column carries a default so
`ADD COLUMN ... NOT NULL` is safe, and the repository always writes every field.

### Endpoints

Both are workspace-scoped through `getContext`. A PR belonging to another
workspace is a **404, never a 403**.

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/pulls/:id/intent` | **200** `PrIntentRecord`. **404** in two cases: nothing has been derived yet (`No intent has been derived for this pull request`), and the PR is unknown or belongs to another workspace (`Pull request not found`). Both are 404 rather than 403; the messages differ, and that is useful — do not collapse them. **422** on a non-uuid `:id`. |
| `POST` | `/pulls/:id/intent` | Derives synchronously and returns **200** with the fresh `PrIntentRecord`. **404** unknown PR, or a PR whose repo row is gone. **409** (`conflict`) while a derivation for the same PR is already in flight. **422** on a non-uuid `:id`. A classifier failure is **not** swallowed on this path: it propagates to the error handler, which is a **500** for a plain error and the adapter's own status when it threw an `AppError` (e.g. **502** from `ExternalServiceError`). |

`POST` is synchronous on purpose: one bounded call, nothing to stream, no job to
track. There is no run on this path, so the composition facts (provider, model,
source labels, missing context, character and token estimates) go to pino via the
route's `onLog`, never to a `run_traces` document.

The in-flight guard is an in-process `Set` on `IntentService`
([`service.ts`](../src/modules/intent/service.ts)), like `RunBus`'s cancel set. It
does not survive a restart; the cost of that is one duplicate classification, so
it needs no table.

## 3. Behaviour

### 3.1 The five sources, and the cap on each

All caps live in [`constants.ts`](../src/modules/intent/constants.ts) and
[`hunk-digest.ts`](../../reviewer-core/src/intent/hunk-digest.ts). Each source
becomes one `<untrusted source="…">` block in the classifier prompt.

| # | Source | Label | Where from | Cap |
|---|---|---|---|---|
| 1 | PR title | `title` | `pull_requests.title` | none — a title is already bounded |
| 2 | PR description | `description` | `pull_requests.body`, trimmed; skipped when empty | first **6 000** chars (`MAX_BODY_BYTES`) |
| 3 | Linked issue body | `issue#<n>` | GitHub, same-repo closing keywords only | **2** issues (`MAX_ISSUES`), each first **4 000** chars (`MAX_ISSUE_BYTES`) |
| 4 | Plan / spec document | `doc:<path>` | the repo's clone on disk (`repos.clone_path`) | **3** documents (`MAX_DOCS`), each first **8 000** chars (`MAX_DOC_BYTES`) |
| 5 | Changed files + hunk headers | `hunk_headers` | `hunkHeaderDigest(loadDiff(...))` | **60** files, **12** hunks per file |

**No diff bodies are ever sent.** The digest emits `path (+N -M)` and
`@@ -a,b +c,d @@` lines and nothing else — bodies are not truncated, they are
never read. Both digest caps report what they dropped (`… N more file(s)`,
`… N more hunk(s)`) so a truncated digest cannot read as a complete one.

Anything over a cap is not silently discarded: the third linked issue and the
fourth referenced document each become a `missing_context` entry naming
themselves and the limit.

**`missing_context` is prompt content, and it is author-shaped**, so it is
bounded and wrapped like any other source:

| Bound | Value | Where |
|---|---|---|
| References of one kind read out of one body | **10** (`MAX_REFERENCES`) | `helpers.ts` — `linkedIssueNumbers`, `crossRepoIssueRefs`, `docReferences` |
| Length of one reference (longer ⇒ ignored, not truncated: a truncated path is a wrong path) | **120** (`MAX_REF_CHARS`) | `helpers.ts` |
| Provider error text echoed into a note, whitespace-flattened | **200** (`MAX_ERROR_CHARS`) | `github.ts` |
| Entries rendered into the prompt | **20**, then `… N more unretrieved item(s)` | `classify.ts` |
| Length of one rendered entry, whitespace-flattened | **200**, then `…` | `classify.ts` |

Without the count caps a single body could name a thousand documents and turn
each one into a bullet — measured at ~350 KB of author-chosen text on a paid
model call, an order of magnitude over the design's intended ceiling.

The block itself is `## Context that could NOT be retrieved` (trusted heading) +
`wrapUntrusted('missing-context', …)` + the trusted "do not guess" instruction
**outside** the wrap — the same shape `assemblePrompt` uses for `## Derived
intent` + `INTENT_USE_RULE` (§3.4). Newlines inside an entry are collapsed
first, so one entry is always exactly one bullet and cannot forge a second.

`chars_in` and `est_tokens_in` on the `Classifying PR intent` log line count the
missing-context text too. Counting only `sources` + the digest made a prompt
inflated by exactly the attacker-fed half read as a small one.

> The `*_BYTES` constants are applied with `String.prototype.slice`, so they are
> UTF-16 code units, not bytes. The names overstate the guarantee by up to ~3× on
> non-ASCII text. Treat them as "roughly this many characters".

**Source 3 — linked issues.** `linkedIssueNumbers`
([`helpers.ts`](../src/modules/intent/helpers.ts)) matches GitHub's full
documented closing-keyword set — `close/closes/closed`, `fix/fixes/fixed`,
`resolve/resolves/resolved` — case-insensitive, with an optional colon, and
de-duplicates. A bare `#12` mention is **not** a link. When the body links no
issue the port is not called at all: that pins the rule at the service boundary,
so a PR that links nothing can never acquire an `issue#` source whatever a port
implementation returns for an empty request. `crossRepoIssueRefs` recognises
`org/repo#100` only to record it as unretrieved.

**Source 4 — documents.** `docReferences` collects repo-relative `.md` paths and
`https://github.com/<owner>/<repo>/blob/<ref>/<path>` URLs whose owner and repo
match the PR's. Every `https?://` URL is stripped before the bare-path scan, so
another repository's blob URL cannot contribute its path fragment.
[`CloneDocReader`](../src/modules/intent/docs.ts) then, per candidate and in this
order: resolves against the clone root and rejects anything outside it
(`path.resolve` + separator-terminated prefix, never a hardcoded `/`); rejects a
non-`.md` extension; re-checks the **symlink-resolved** real path against the
**symlink-resolved root**, because `readFile` follows symlinks and a committed
symlink with a clean in-root path can point anywhere. The two checks use
different roots deliberately: lexical against the unresolved root (so `..` is
refused before any filesystem call), symlink against the realpath'd root (so a
resolved target is compared with a resolved root). Comparing a realpath'd target
against an unresolved root rejects *every* document whenever an ancestor of the
clone directory is itself a link — macOS `/var` → `/private/var`, a linked
checkout, a Windows junction. Confinement is checked *before* the
extension so an escaping path is always reported as "outside the repository", not
as "not a markdown file". Nothing in the reader throws — every refusal is a
`missing_context` entry, which is what stops the classifier being told a document
exists when it does not.

### 3.2 Confidence is computed, never asked for

`computeConfidence` ([`helpers.ts`](../src/modules/intent/helpers.ts)) takes only
which sources arrived:

| Level | Condition |
|---|---|
| `high` | a PR description **and** at least one of (issue, document) |
| `medium` | exactly one or two of (description, issue, document), but not the `high` combination |
| `low` | none of them — title, file list and hunk headers only |

A non-empty `missing_context` caps the level at `medium`. It only ever
*downgrades* `high`; `medium` and `low` are unchanged by it.

`hasDoc` is `sources.some(s => s.label.startsWith('doc:'))` — the `doc:` label
prefix is therefore load-bearing, not cosmetic. The model never sees, and never
returns, this field: self-reported LLM confidence rises precisely when the answer
is wrong, and a deterministic tier over observed inputs cannot be talked up.

### 3.3 What is written to `pr_intent`

One row per PR (`pr_id` is the primary key and the FK, `ON DELETE CASCADE`):

| Column | Value |
|---|---|
| `intent`, `in_scope`, `out_of_scope` | the model's three fields, verbatim |
| `head_sha` | `pull_requests.head_sha` at derivation time — the cache key |
| `confidence` | §3.2, computed |
| `sources` | the labels that composed the prompt, plus `hunk_headers` |
| `missing_context` | every entry from §3.1's refusals, in the order they occurred |
| `linked_issue` | the FIRST linked issue that resolved, as an `IssueMeta` (`number`, `title`, raw `body` capped at `MAX_ISSUE_BYTES`, `state`); `null` when the body linked none or every fetch failed. Replaced wholesale on re-derivation, so an issue unlinked since the last one does not survive. Storage only — it feeds no `confidence`, `sources` or `missing_context` decision (L05) |
| `provider`, `model` | what actually ran (§3.5), not what was configured |
| `created_at` | the time of *this* derivation |

Re-derivation **replaces the row wholesale, `created_at` included**
(`onConflictDoUpdate` in
[`pull.repo.ts`](../src/modules/reviews/repository/pull.repo.ts)): the row
describes one derivation, not the first one ever made for this PR.

`pr_intent` belongs to the **reviews** aggregate, not to
`modules/intent/repository.ts`. The intent module reaches it through an
`IntentStorePort` wired in the container; two repositories owning one table is how
the two drift apart. The port's row shapes are declared *structurally* in
[`domain.ts`](../src/modules/intent/domain.ts) rather than imported from
`modules/reviews/`, which would be a `no-cross-module-internals` violation.

`sources` always ends with `hunk_headers`, even when the digest came back empty —
in that case `missing_context` also carries "the PR diff could not be loaded", and
that pair is the honest reading of the row.

### 3.4 The prompt slot

`renderIntent` produces the reviewer-facing string: the statement, then
`In scope:` and `Out of scope:` bullet lists when non-empty. It deliberately
excludes confidence, sources and missing context — a reviewer told
"confidence: low" has been handed an excuse to work less carefully.

`assemblePrompt` renders `## Derived intent` **after** `## Callers of changed
symbols` and **before** `## Diff to review`. The body goes through
`wrapUntrusted('intent', …)` because it is distilled from author-controlled text;
`INTENT_USE_RULE` — report defects at true severity regardless of scope, never
use the intent as a reason to stay silent — is trusted text and sits **outside**
the wrap.

An empty, whitespace-only or absent slot omits the section entirely and leaves
`PromptAssembly.intent` `null`, producing a **byte-identical** prompt to one
assembled without the field. That is how the feature stays behaviour-neutral when
there is no intent.

### 3.5 The scope gate — the exact drop rule

[`scopeFindings`](../../reviewer-core/src/scope.ts) runs **after grounding and
before scoring**, so the score always reflects exactly the findings the user will
see. A finding is dropped only when **all four** hold:

1. `out_of_scope === true` — the model marked it, and
2. `severity === 'SUGGESTION'`, and
3. `category ∈ { style, perf, test }`, and
4. `kind ∉ { secret_leak, lethal_trifecta, phantom, hook }`.

Everything else survives **with its `out_of_scope` marker intact** — a CRITICAL,
a WARNING, anything in `security` or `bug`, and every full-file kind. And when no
intent was in the prompt the gate is a **no-op**: it returns the findings
unchanged and drops nothing, whatever the model may have marked.

**The residual.** "Never drops a real defect" is a claim about this rule, not a
proof about the model: a genuine defect is suppressed only if the reviewer model
mislabels it on **three** axes at once — `out_of_scope: true`, severity
`SUGGESTION`, *and* a category in `{style, perf, test}`. Requiring the
conjunction is a deliberately conservative bar and nothing weaker has ever been
proposed here, but it is not zero: before this feature a finding mislabelled that
way still appeared in the list, and now it does not. Widen the two sets and this
residual grows with them.

Dropped findings come back as `{ finding, reason }` with a
`out of scope for this PR (SUGGESTION/<category> suggestion)` reason and are
emitted to the run log, exactly like grounding's drops. Nothing goes silent here:
the failure mode this gate guards against is a suppressed real bug, which is
invisible by construction. Widening the two lists is a product decision, not a
refactor.

Surviving findings persist their marker: `findings.out_of_scope` is written from
`f.out_of_scope ?? false` in
[`review.repo.ts`](../src/modules/reviews/repository/review.repo.ts).

### 3.6 The review path

[`run-executor.ts`](../src/modules/reviews/run-executor.ts) derives the intent
**once per batch**, after the diff loads and before the agent loop, through
`intentService.ensureFresh`:

- a stored record whose `head_sha` equals the PR's current head is **reused with
  no model call**;
- otherwise it re-derives;
- and on any failure it returns `undefined` — `ensureFresh` never throws. Even the
  recovery path is individually guarded, because "never throws" is the whole
  contract and a logging sink that throws would break it just as loudly.

The review has just loaded the diff at that point, so it passes the digest in as
`opts.hunkDigest` and the service skips its diff port entirely; otherwise the
port re-runs `loadDiff` (plus its own `getPull`/`getRepo`) for a diff the caller
is already holding. The option is a **string**, not a `UnifiedDiff` — the service
must not acquire a reviews-module type — and `''` is a real answer meaning "the
diff loaded and it is empty", which still yields §3.2's `the PR diff could not be
loaded` note without a second load. A caller with no diff in hand (the route)
omits it and the port loads as before.

With a record, `renderIntent(record)` becomes `ReviewInput.intent` for every agent
in the batch. Without one, the slot is omitted and §3.5's gate is a no-op — the
review behaves exactly as it did before this feature.

The derivation runs on the **fanned-out** run logger, so every target run's event
buffer (and therefore its persisted trace) records it, not just the first agent's.

### 3.7 Model resolution

The model is the workspace's Settings choice for the `review_intent` feature,
read by `IntentRepository.featureModelChoice` — deliberately not through
`modules/settings/feature-models.ts`, which is another module's internals and
takes `Container`, so routing through it would close an import cycle the
`no-circular` gate rejects.

When the workspace has chosen nothing, the fallback is the `review_intent` entry
in the shared `FEATURE_MODELS` registry, **read from the registry and never
restated locally** — the Settings screen renders that same `defaultModel`, so a
module-local constant would make the UI advertise one model while another runs.

## 4. Degradation

The house rule: degrade visibly, never fail the caller.

| Situation | Behaviour |
|---|---|
| No PR body | Classify from title + file list + hunk headers; `confidence: low` |
| Issue fetch fails — 404, no token, rate limit | `missing_context` entry naming the issue and the provider's message; derivation continues |
| More linked issues than the cap | Each extra is a `missing_context` entry stating the limit |
| Cross-repo issue reference | Never fetched; recorded as `<ref> was not fetched: only issues in this repository are read` |
| Referenced document missing from the clone | `missing_context` entry; continues |
| Repo has no clone on disk | Every referenced document becomes a `missing_context` entry; continues |
| Path escapes the clone, or is a symlink pointing out of it | Not read; `path resolves outside the repository` |
| Wrong extension | Not read; `not a markdown file` |
| Diff cannot be loaded | Empty digest; `the PR diff could not be loaded` in `missing_context` |
| Classifier call fails, or the output fails schema repair | Inside a review: nothing persisted, prompt section omitted, review proceeds, the failure is logged to the run log **and** pino. On `POST …/intent`: the error surfaces to the caller (500, or the adapter's own `AppError` status) — it is a user action, and a silent success would be a lie |
| Model lacks `structured_outputs` | Same as above — degrade, do not retry blindly |
| Stale `head_sha` at review time | Re-derived automatically |
| No intent at review time | `scopeFindings` is a no-op; behaviour identical to before the feature |
| Derivation already in flight for this PR | `POST` is a 409 with code `conflict` |
| PR in another workspace | 404 on both routes |

## 5. Acceptance

Rows **1–13** are the design's §11 checklist in its own order, with the tests
that cover each item. Rows **14–16** are additions this spec makes: the design's
adversarial case (§10) and the two surfaces built after it was written.

| # | Item | Covered by |
|---|---|---|
| 1 | A PR with a body and a linked issue yields `confidence: high` with both sources listed | [`intent-service.test.ts`](../test/intent-service.test.ts), [`intent-helpers.test.ts`](../test/intent-helpers.test.ts) |
| 2 | An empty body yields `confidence: low` from title + files + hunk headers | `intent-service.test.ts`, `intent-helpers.test.ts` |
| 3 | A referenced plan file present in the clone is listed in `sources` | [`intent-docs.test.ts`](../test/intent-docs.test.ts), `intent-service.test.ts` — that the *statement* reflects it is a model behaviour and is not asserted deterministically |
| 4 | A referenced file that does not exist appears in `missing_context` and caps confidence at `medium` | `intent-service.test.ts`, `intent-docs.test.ts` |
| 5 | No classifier prompt contains diff body lines | [`intent-hunk-digest.test.ts`](../../reviewer-core/test/intent-hunk-digest.test.ts), `intent-service.test.ts`, [`intent-routes.it.test.ts`](../test/intent-routes.it.test.ts) |
| 6 | The review prompt carries a wrapped `## Derived intent`; with no intent it is byte-identical to before | [`prompt.test.ts`](../../reviewer-core/test/prompt.test.ts), [`intent-review.it.test.ts`](../test/intent-review.it.test.ts) |
| 7 | A CRITICAL security finding outside `in_scope` is persisted and served with `out_of_scope: true` | `intent-review.it.test.ts`, [`scope.test.ts`](../../reviewer-core/test/scope.test.ts). **Not badged in the UI** — see §7 |
| 8 | An out-of-scope style SUGGESTION is dropped, with its reason in the outcome | `scope.test.ts`, [`run.test.ts`](../../reviewer-core/test/run.test.ts) |
| 9 | `score` matches the findings that survived the gate | `run.test.ts` |
| 10 | Settings → Models shows the same provider/model the run reports | [`intent-model-choice.it.test.ts`](../test/intent-model-choice.it.test.ts) |
| 11 | A second review at an unchanged head SHA makes no second classifier call | `intent-service.test.ts`, `intent-review.it.test.ts` |
| 12 | The run log records the derivation in *every* agent's event buffer, with the confidence and source count | `intent-review.it.test.ts`, including the design's stronger claim — the log carries **no** diff, issue or plan content — asserted against the SSE stream and the persisted `run_traces.log` |
| 13 | `cd server && pnpm typecheck && pnpm arch:check`, `cd client && pnpm typecheck`, and all four suites pass | The gate commands themselves — `arch:check` must still report exactly **24** known violations, never a regenerated baseline |
| 14 | *(addition, from the design's §10 adversarial case)* A hostile PR body demanding leniency cannot suppress a CRITICAL | `intent-review.it.test.ts` |
| 15 | *(addition)* The record round-trips and re-derivation overwrites it | [`pr-intent.it.test.ts`](../test/pr-intent.it.test.ts) |
| 16 | *(addition)* The card renders the statement, both lists, the confidence badge and the source line on seeded data, with no model key | [`IntentCard.test.tsx`](../../client/src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/OverviewTab/_components/IntentCard/IntentCard.test.tsx), [`e2e/specs/08-pr-intent.flow.json`](../../e2e/specs/08-pr-intent.flow.json) |

## 6. Seed

`pnpm db:seed` writes one `pr_intent` row for the demo PR #482 so the card is
populated on a fresh install and the e2e flow has a deterministic target with no
model key. It is `onConflictDoNothing` and sits *outside* the "PR does not exist
yet" branch, so a database seeded before this feature acquires the row on the next
run. `head_sha` is read off the seeded PR row rather than restated, or the card
would render as permanently stale. `provider`/`model` are `seed` and `confidence`
is `low` with an empty `missing_context`: nothing was fetched and no model ran,
and the row says so.

## 7. Known gaps

Shipped short of the design in one place, recorded here rather than ticked in
§5 so nobody reads the checklist as complete.

- **No out-of-scope badge on a finding.** Acceptance item 7 asks for a CRITICAL
  outside `in_scope` to be *"persisted, shown, and badged out-of-scope"*. The
  marker is computed, persisted on `findings.out_of_scope` and returned on
  `Finding.out_of_scope`, but **no client component reads it** — there is no badge
  on a finding card today. Either build it or amend the design; do not read item 7
  as done.

*(Closed 2026-08-06)* — **what the run log does *not* contain** is now asserted.
`intent-review.it.test.ts` checks every run's SSE stream and persisted
`run_traces.log` against the PR body, the linked issue's body and a diff body
line, and fails if any of them appears. The prompt itself is exempt on purpose:
`prompt_assembly` carrying source content is what it is for.
