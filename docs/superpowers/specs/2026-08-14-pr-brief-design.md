# PR Why + Risk Brief

**Date:** 2026-08-14

**Status:** draft — awaiting review

**Depends on:** the intent layer (L03,
[`2026-08-05-intent-layer-design.md`](2026-08-05-intent-layer-design.md)) and the
blast radius (L04,
[`2026-08-09-blast-radius-and-working-review-design.md`](2026-08-09-blast-radius-and-working-review-design.md)),
both shipped.

**Expected halves:** `server/specs/brief.md`, `client/specs/pr-brief-card.md`

## Problem

A reviewer opening a pull request is handed a diff and nothing else. Everything
that would let them read that diff economically — what the change is for, how far
it reaches, which of its files carry the actual risk, and which line to look at
first — is either scattered across four cards or absent entirely. The pieces
already exist: intent (L03), the blast map (L04), prior PRs, the review's own
findings. What is missing is the one paragraph that puts them together and the
short ordered list that says *read these first*.

This feature composes those inputs into a single structured artefact, persists it
per PR state, and renders it at the top of the PR overview.

The failure mode it must not have: a brief that reads confidently about a file
that is not in the pull request. Everything it names is checked against the
inputs in code before it is stored.

## Scope

**In scope**

- A `brief` module in `server/` owning composition, the one model call, the
  grounding gate and persistence into `pr_brief`.
- Two endpoints: read the brief for the PR's current state, generate it now.
- A `linked_issue` column on `pr_intent`, populated where the intent service
  already fetches the issue.
- The `PR BRIEF` section, the `RISK AREAS` block inside the intent card, and the
  `Review focus` section on the PR overview.

**Out of scope**

- Any second model call. One structured call produces all five fields.
- Diff hunk bodies in the prompt, at any cap. Only `path (+N -M)`.
- Regenerating automatically when a review finishes — the brief goes `stale` and
  the user clicks.
- Posting the brief to GitHub, and any `Compose review` integration.
- Multi-agent briefs, `digests`, and anything in `pr_brief` beyond one row per PR.

## Approach

A new module, built to the shape `blast` and `smart-diff` already use: a service
taking narrow ports composed in [`platform/container.ts`](../../../server/src/platform/container.ts),
one structured call isolated in `model.ts`, the prompt in `prompt.ts`, pure
transforms in `helpers.ts`.

Two alternatives were considered and rejected. Computing the brief inside
[`run-executor.ts`](../../../server/src/modules/reviews/run-executor.ts) would
tie it to a review having run and leaves no natural place for an explicit
regenerate action. Extending the `blast` module would put five unrelated input
sources behind a name that means one of them.

## Contract

The Zod definitions in `vendor/shared/contracts/brief.ts` are the source of
truth, and `@devdigest/shared` is **two physical copies** — every edit lands in
[`client/src/vendor/shared/`](../../../client/src/vendor/shared/) too.

`Risk`, `Risks`, `PrHistory` and the old composed `PrBrief` in that file have no
consumer today (the only reference is a type re-export in
[`client/src/lib/types.ts`](../../../client/src/lib/types.ts)), so they are
replaced rather than extended. `Intent`, `BlastRadius` and `SmartDiff` are
untouched.

| Contract | Shape |
|---|---|
| `RiskLevel` | closed enum `high \| medium \| low` |
| `BriefRisk` | `title`, `explanation`, `severity: RiskLevel`, `refs: string[]` |
| `ReviewFocusItem` | `file`, `line: number \| null`, `reason` |
| `Brief` | `what`, `why`, `risk_level: RiskLevel`, `risks: BriefRisk[]`, `review_focus: ReviewFocusItem[]` — the five fields the model produces, and nothing the server computes |
| `PrBriefRecord` | `Brief` extended with `pr_id`, `head_sha`, `review_id \| null`, `stale`, `sources: string[]`, `est_tokens_in`, `provider`, `model`, `created_at` |

`refs` entries are file paths **or** endpoint/cron identifiers, and only ones
drawn from the inputs — see [The grounding gate](#the-grounding-gate). `stale` is
computed by the server and is deliberately absent from `Brief`: the model never
sees it and cannot assert its own freshness.

The model's output shape is a **module-local** `BriefOutput` in `prompt.ts`, not
the shared contract, mirroring `BlastSummaryOutput`. The service maps one to the
other explicitly, so a wire-contract change can never silently alter what the
model is asked for.

## Endpoints

Both workspace-scoped through `getContext`. A PR in another workspace is a
**404, never a 403**.

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/pulls/:id/brief` | **200** `PrBriefRecord`, served **only** when the stored `head_sha` equals the PR's current head. **404** in two cases with different messages: nothing generated for this state, and unknown/foreign PR. **422** on a non-uuid `:id`. Never calls a model. |
| `POST` | `/pulls/:id/brief` | Generates synchronously and returns **200** with the fresh record. **409** (`conflict`) while a generation for the same PR is in flight. **422** `brief_no_inputs` when the PR has no changed files. **404** unknown PR or a PR whose repo row is gone. A model failure propagates — **500**, or the adapter's own status for an `AppError`. |

`GET` is not in the original task statement. It is added because the card has to
read the cache somehow, and making the card `POST` on mount would spend a model
call on every page open — the exact thing acceptance item AC-4 forbids.

**`POST` always regenerates.** It is wired to an explicit refresh control; a
button that silently served a cached row would read as broken. This differs from
`POST /pulls/:id/blast/summary`, which does serve its cache, and the difference
is intentional.

The in-flight guard is an in-process `Set` on `BriefService`, like
`IntentService`'s and `BlastService`'s. It does not survive a restart; the cost
is one duplicate generation, so it needs no table.

`POST` is synchronous on purpose: one bounded call, nothing to stream, no job to
track. There is no run on this path, so the composition facts (provider, model,
source labels, character and token counts, and every grounding drop) go to pino
via the route's logger, never to a `run_traces` document.

## Cache and staleness

`pr_brief` is today `(pr_id uuid PK, json jsonb)`. The migration adds `head_sha`,
`review_id`, `provider`, `model`, `est_tokens_in` and `created_at` — additive
only, every column with a default, so `ADD COLUMN ... NOT NULL` is safe. `json`
holds the `Brief`. One row per PR; a regeneration replaces it wholesale,
`created_at` included, because the row describes *this* generation.

**The cache key is `head_sha`.** A row written at an older head is never served:
the file list, the blast map and the findings it described belong to code that no
longer exists.

**`review_id` is not part of the key.** It records which review's findings fed
the brief. When the PR's latest review is no longer that one, the response
carries `stale: true` and the card marks itself and highlights the regenerate
control — but the cached row is still served. A brief one review out of date is
more useful than an empty card, and regenerating on the user's behalf would spend
a model call nobody asked for.

The consequence is stated plainly because it is a real limitation: at one head,
running a new review makes the brief's `review_focus` describe findings that may
no longer be the current set until someone regenerates.

## Inputs and the token budget

**Unit.** `est_tokens = ceil(chars / 4)`, the same estimate
[`estimateTokensFromBytes`](../../../server/src/modules/project-context/helpers.ts)
uses. The ceiling is `MAX_EST_TOKENS_IN = 8000`, so the whole assembled prompt is
capped at **32 000 characters**. The estimate — not a tokenizer count — is the
budget's unit of measurement, so the invariant is deterministic and testable with
no provider in the loop.

**No diff bodies, at any cap.** Only `path`, `additions`, `deletions` and
`status` are read from `pr_files`; the `patch` column is never touched. This is
the same rule the intent layer holds, and it is asserted by test, not by
convention.

| # | Source | Label | Where from | Cap (chars) |
|---|---|---|---|---|
| 1 | Header: title, author, branch, `+N -M`, file count | `pr` | `pull_requests` | 500 |
| 2 | Changed files with per-file `+/-` | `files` | `pr_files`, 60 files then `… N more file(s)` | 5 000 |
| 3 | Intent statement, `in_scope`, `out_of_scope`, `confidence` | `intent` | `pr_intent` | 1 500 |
| 4 | Linked issue: `number`, `title`, `body` from the stored `IssueMeta` | `issue#<n>` | `pr_intent.linked_issue` | 3 000 |
| 5 | Blast map JSON without `summary`, plus the blast summary paragraph when one exists at this head | `blast` | `BlastService.get` | 6 000 |
| 6 | Latest review's findings: `file`, `line`, `severity`, `category`, `kind`, `title` — **never** `rationale` or `suggestion` | `findings` | `reviews` + `findings`, 40 items | 6 000 |
| 7 | Specification documents the PR itself references | `spec:<path>` | the clone, via the intent module's `CloneDocReader`, 3 documents × 1 500 | 4 500 |
| | System prompt, headings and untrusted wrappers | | | ~2 000 |
| | **Total** | | | **~28 500 ≈ 7 125 est tokens** |

The per-source caps make an over-budget prompt structurally impossible. A final
`capPrompt()` truncates with a `…[truncated N chars]` marker anyway, so a
carelessly raised constant cannot breach the invariant silently — the same
belt-and-braces `truncatedMap` gives the blast summary.

Everything a cap dropped is recorded in `sources` (`files (60 of 214)`,
`spec:docs/rate-limits.md (truncated)`) so a truncated input can never read as a
complete one. The real tiktoken count goes to the log through the existing
`container.tokenizer` for observability only; it is never the gate.

**Source 7 — the specs.** "Relevant specifications" means *documents this PR
references*: the `.md` paths and same-repo blob URLs the intent layer's
`docReferences` already extracts, read through the existing
[`CloneDocReader`](../../../server/src/modules/intent/docs.ts) with its path
confinement and symlink checks intact. Documents merely sitting under a
`context_roots` directory are not included — selecting those by path overlap
would be a new heuristic, and a spec the author never mentioned is a guess about
relevance rather than a fact about the PR.

**`linked_issue`.** `pr_intent` gains a `jsonb` column holding an `IssueMeta`
(`number`, `title`, `body`, `state`) or `null` — the shape
`PrDetail.linked_issue` already uses, so nothing new is minted and the body the
brief needs travels with it, already capped at `MAX_ISSUE_BYTES` by the reader.
`IssueMeta` carries no URL; the card builds one from the repo it already has.
Written where
[`intent/service.ts`](../../../server/src/modules/intent/service.ts) already
fetches the issue — the first linked issue when there is one. `PrIntentRecord`
gains the field and [`server/specs/intent.md`](../../../server/specs/intent.md)
§3.3 is amended. The brief adds **no** network call of its own; it reads the
column. The intent spec's §1 already reserves this column for L05.

## The grounding gate

`groundBrief(brief, allowed)` is a pure function in `helpers.ts`, applied after
the model call and **before** persistence. It is code, not a prompt instruction —
the prompt says the same thing, but the guarantee comes from here. This mirrors
[`scopeFindings`](../../../reviewer-core/src/scope.ts) and the grounding gate in
`reviewer-core`.

The allowed sets are built from the inputs alone:

- `allowed.files` — every path in `pr_files`, plus every caller file in the blast
  map, plus the paths of the specification documents that were actually read.
- `allowed.endpoints` — `endpoints_affected` and `crons_affected` from the blast
  map.

The rules:

1. Every `risk.refs[]` entry is normalised to POSIX and, where it has the
   `file:line` form, split on the last `:`. An entry in neither allowed set is
   **dropped from the risk**.
2. A risk left with zero refs is **dropped entirely**. A risk that names nothing
   in the pull request is the failure mode this feature exists to avoid.
3. A `review_focus` item whose `file` is not in `allowed.files` is **dropped**.
4. A `review_focus` item's `line` survives only when it falls inside the
   `start_line … end_line` range of a finding in that same file. Otherwise `line`
   becomes `null` and the item is kept. Nothing else in the inputs carries line
   numbers, so any other line the model emits is invented — and the mockup's
   `src/config.ts:12` style is precisely the invitation to invent one.
5. `risk_level` is passed through unchanged; it is a judgement, not a reference.

Every drop is returned as `{ item, reason }`, logged to pino, and counted on the
response's `sources` line. Nothing goes silent: a suppressed real risk is
invisible by construction, which is the same reason the scope gate reports its
drops.

## Model

The `risk_brief` entry already in `FEATURE_MODELS`
([`contracts/platform.ts`](../../../server/src/vendor/shared/contracts/platform.ts)),
resolved through the workspace's Settings choice with the registry's
`defaultModel` as the fallback — **read from the registry, never restated
locally**, so the Settings screen cannot advertise one model while another runs.
This is the pattern `IntentRepository.featureModelChoice` established.

`risk_brief`'s default is `openai/gpt-4.1` rather than a flash-class model, and it
stays that way: unlike the blast summary this call weighs seven sources against
each other and orders them.

## Prompt

Trusted system prompt plus `INJECTION_GUARD`. Every input block goes through
`wrapUntrusted` with its own source label — `pr`, `files`, `intent`, `issue`,
`blast`, `findings`, `spec:<path>`. All seven are author-controlled or derived
from author-controlled text: a branch name, a file path, an issue body and a
committed `.md` can each be written to read like an instruction.

The output shape is enforced out of band by structured output rather than
described in prose, per [`docs/agent-prompts/`](../../agent-prompts/)'s rules for
feature prompts.

## User interface

- **`PrBriefCard`** — a new folder in
  `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/`.
  Renders the `PR BRIEF` section label, the existing `VerdictBanner`, a
  `risk_level` badge and the regenerate control (spinner while in flight, toast on
  failure, a distinct message for `409`). The banner's paragraph is `brief.why`
  when a brief exists and the review's own summary otherwise. `VerdictBanner`
  gains two **optional** props (`riskLevel`, `onRegenerate`); every existing call
  site stays valid.
- **`RiskAreas`** — renders `brief.risks` inside `IntentCard`, below the scope
  lists, one row per risk with its severity, its refs and an expandable
  explanation. `IntentCard` takes an optional `risks` prop and stays presentational.
- **`ReviewFocus`** — its own section at the foot of `OverviewTab`, headed
  "Review focus — read these first" with a count. Each item is clickable: it
  switches to `?tab=diff` and scrolls to that file, using a per-file anchor added
  to `DiffTab` if one does not exist yet. The line number appears in the label
  only when `line !== null`.
- **Hook** — `client/src/lib/hooks/brief.ts`: `usePrBrief` (query, key
  `['pr-brief', prId]`) and `useGenerateBrief` (mutation, explicit
  `invalidateQueries`). Component → hook → `api`, no `fetch` in a component.
- **Strings** go in the existing `client/messages/en/brief.json`.

## Degradation

The house rule: degrade visibly, never fail the caller.

| Situation | Behaviour |
|---|---|
| Blast map is `degraded` | Section omitted from the prompt, recorded in `sources`; the brief is generated from the rest. **Not** a 422 — unlike the blast summary, the map is one input of seven here |
| No intent derived | Section omitted; `risk_level` is judged without it |
| No review yet, or a review with no findings | Section omitted; `review_focus` comes out file-level, every `line` `null` |
| Linked issue absent or its fetch failed at intent time | Column is `null`, section omitted |
| Referenced document missing, outside the clone, or a symlink pointing out of it | Not read — the existing `CloneDocReader` refusals, which never throw |
| Repo has no clone on disk | No `spec:` sources; the brief is generated from the rest |
| Model call fails, or the output fails schema repair | Nothing persisted, the error surfaces to the caller. It is a user action and a silent success would be a lie |
| Every risk dropped by the gate | A brief with an empty `risks` array is persisted and served; the card says so. An empty list is the honest answer when nothing survived |
| PR has no changed files | **422** `brief_no_inputs`. There is no question to ask, and asking anyway would produce a repo-wide answer |
| Generation already in flight | **409** with code `conflict` |
| PR in another workspace | **404** on both routes |

## Layering

`modules/brief/` follows the Onion rule; `pnpm arch:check` must stay at its
frozen 24 known violations.

```
routes.ts       Fastify plugin: HTTP + zod schemas only
service.ts      compose → budget → model → ground → persist
ports.ts        BriefServiceDeps and the four port interfaces, declared here
prompt.ts       system prompt, input rendering, module-local BriefOutput
model.ts        one completeStructured call, nothing else
helpers.ts      renderInputs, capPrompt, estTokens, groundBrief, toWire
constants.ts    the caps, MAX_EST_TOKENS_IN, BYTES_PER_ESTIMATED_TOKEN
repository.ts   the only place touching pr_brief
```

The service never imports another module's `repository.ts`. The blast map arrives
as a narrow function port (`(workspaceId, prId) => Promise<BlastRadiusResponse>`)
wired in the container to `blastService.get`; `pr_intent`, `pr_files`, the pull
row and the latest review's findings arrive through a `BriefStore` port
implemented over the shared `reviewRepo`, exactly as `IntentStorePort` does. Port
row shapes are declared structurally in the module, never imported from
`modules/reviews/`.

## Testing

Hermetic, in `server/test/`:

- Prompt composition — the assembled prompt contains **no** `patch` content, for
  a PR whose `pr_files` rows all carry one.
- The budget invariant — a synthetic PR with 500 changed files, 200 findings, a
  40 KB issue body and three 30 KB documents still assembles under
  `MAX_EST_TOKENS_IN`, and every truncation is reflected in `sources`.
- `groundBrief` — an invented file, an invented endpoint, an invented line
  number, a risk whose every ref is invented, and a `file:line` ref whose file is
  real. Each expected drop is asserted with its reason.
- `stale` — computed `true` when the PR's latest review is not `review_id`.

DB-backed, `*.it.test.ts`:

- `pr_brief` round-trips and a regeneration replaces the row.
- **A second `GET` at an unchanged head makes no model call** — asserted on a
  call counter on `MockLLMProvider`. This is acceptance item AC-4 literally.
- Concurrent `POST` yields one 200 and one 409.
- A PR in another workspace is a 404 on both routes.

Client, vitest + RTL:

- The card renders `what`, `why` and the risk badge; `RiskAreas` renders refs and
  expands an explanation; a `ReviewFocus` click switches tab and targets the file.
- The regenerate control shows its spinner, and surfaces the `409` message
  distinctly from a generic failure.

`e2e/`: a new flow over the seeded PR #482, running with no model key against the
seeded `pr_brief` row.

## Seed

`pnpm db:seed` writes one `pr_brief` row for the demo PR #482 so the card is
populated on a fresh install and the e2e flow has a deterministic target with no
model key. `onConflictDoNothing`, outside the "PR does not exist yet" branch, so
a database seeded before this feature acquires the row on the next run.
`head_sha` is read off the seeded PR row rather than restated, or the card would
render as permanently stale. `provider` and `model` are `seed`, and `review_id`
points at the seeded review so `stale` is `false`.

## Acceptance

| # | Item | Verified by |
|---|---|---|
| AC-1 | `POST /pulls/:id/brief` returns a `Brief` with all five fields from one structured call | server hermetic + it |
| AC-2 | Every `risk.refs[]` entry names a file in `pr_files`, a caller file in the blast map, a read specification document, or an endpoint/cron from the blast map — anything else is dropped with a logged reason | `groundBrief` unit tests |
| AC-3 | Every `review_focus[].file` is in the allowed file set, and a `line` survives only inside a finding's range on that file | `groundBrief` unit tests |
| AC-4 | Re-opening a PR at an unchanged head serves the stored brief with **zero** model calls | `brief-routes.it.test.ts`, model-call counter |
| AC-5 | The assembled prompt never exceeds `MAX_EST_TOKENS_IN = 8000`, measured as `ceil(chars / 4)`, on a deliberately oversized PR | budget invariant test |
| AC-6 | No diff hunk body reaches the prompt at any input size | prompt composition test |
| AC-7 | An explicit regenerate always performs a fresh generation and replaces the row | `brief-routes.it.test.ts` |
| AC-8 | A brief whose `review_id` is not the PR's latest review is served with `stale: true` | staleness unit + it |
| AC-9 | A `degraded` blast map, an absent intent and an absent review each omit their section and still yield a brief | degradation tests |
| AC-10 | A PR with no changed files yields **422** `brief_no_inputs`, and no model call is made | route test |
| AC-11 | A second concurrent `POST` for one PR yields **409** | `brief-routes.it.test.ts` |
| AC-12 | A PR in another workspace is **404** on both routes | route test |
| AC-13 | `pr_intent.linked_issue` is populated at derivation and surfaces on `PrIntentRecord`; no new network call is made on the brief path | intent it test |
| AC-14 | The card renders risk level and a clickable review-focus list; the regenerate control shows in-flight and error states | client tests |
| AC-15 | A hostile PR body, branch name, issue body or committed `.md` cannot make the brief name a file outside the pull request | adversarial test through `groundBrief` |
| AC-16 | `cd server && pnpm typecheck && pnpm arch:check` (still exactly 24 known violations), `cd client && pnpm typecheck`, and all suites pass | the gate commands |

## Open questions

None outstanding. Six decisions were settled by the caller during
brainstorming — the UI follows the mockup exactly, `head_sha` is the cache key,
the budget unit is `ceil(chars / 4)`, the linked issue is a `pr_intent` column,
review findings are an input, and specifications are the documents the PR itself
references.
