# Spec — PR Why + Risk Brief: seven inputs, one grounded artefact

**Status:** implemented (L05)

**Design:** [`docs/superpowers/specs/2026-08-14-pr-brief-design.md`](../../docs/superpowers/specs/2026-08-14-pr-brief-design.md)

**Client half:** [`client/specs/pr-brief-card.md`](../../client/specs/pr-brief-card.md)

A reviewer opening a pull request is handed a diff and nothing else. The pieces
that would let them read it economically already exist — the derived intent
(L03), the blast map (L04), the latest review's findings — but scattered across
cards. This module composes them into one paragraph, a ranked risk list, and a
short "read these first" list, persists it per PR state, and renders it at the
top of the overview.

The failure mode it must not have: a brief that reads confidently about a file
that is not in the pull request. §5 is how that is prevented, and it is code,
not a prompt instruction.

## 1. Scope

**In scope**

- `modules/brief/` — composition, one structured model call, the grounding gate,
  persistence into `pr_brief`.
- `GET` and `POST /pulls/:id/brief`.
- Reading `pr_intent.linked_issue`, which the intent module now writes (see
  [`intent.md`](intent.md) §3.3).

**Out of scope**

- Any second model call. One structured call produces all five fields.
- Diff hunk bodies in the prompt, at any cap. Only `path (+N -M)`.
- Regenerating automatically when a review finishes — the brief goes `stale`
  and the user clicks.
- Posting the brief to GitHub, and any `Compose review` integration.
- Multi-agent briefs, `digests`, and anything in `pr_brief` beyond one row per PR.

## 2. Contract

The Zod definitions in
[`contracts/brief.ts`](../src/vendor/shared/contracts/brief.ts) are the source
of truth — and `@devdigest/shared` is **two physical copies**, so every edit
lands in `client/src/vendor/shared/` too.

| Contract | Shape |
|---|---|
| `RiskLevel` | closed enum `high \| medium \| low` |
| `BriefRisk` | `title`, `explanation`, `severity`, `refs: string[]` |
| `ReviewFocusItem` | `file`, `line: number \| null`, `reason` |
| `Brief` | the five fields the model produces, and nothing the server computes |
| `PrBriefRecord` | `Brief` + `pr_id`, `head_sha`, `review_id`, `stale`, `sources`, `est_tokens_in`, `provider`, `model`, `created_at` |

`stale` is computed by the server and is deliberately absent from `Brief`: the
model never sees it and cannot assert its own freshness.

The model's output shape is a **module-local** `BriefOutput` in
[`prompt.ts`](../src/modules/brief/prompt.ts), not the shared contract, so a
wire-contract change can never silently alter what the model is asked for.
[`ports.ts`](../src/modules/brief/ports.ts) carries a structural mirror
(`BriefOutputShape`) that the schema is annotated against — the annotation is
what stops the two drifting, and it exists because importing the zod module from
`ports.ts` would close a cycle the `no-circular` gate rejects.

### Endpoints

Both workspace-scoped through `getContext`. A PR in another workspace is a
**404, never a 403**.

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/pulls/:id/brief` | **200** `PrBriefRecord`, served **only** when the stored `head_sha` equals the PR's current head. **404** in two cases with deliberately different messages — `Pull request not found` (unknown or foreign PR) and `No brief has been generated for this pull request state`. **422** on a non-uuid `:id`. Never calls a model. |
| `POST` | `/pulls/:id/brief` | Generates synchronously, **always**, and returns **200** with the fresh record. **409** `conflict` while a generation for the same PR is in flight. **422** `brief_no_inputs` when the PR has no changed files. **404** on an unknown PR or one whose repo row is gone. A model failure propagates — **500**, or the adapter's own status for an `AppError`. |

`GET` exists because the card has to read the cache somehow; making the card
`POST` on mount would spend a model call on every page open, which is exactly
what AC-4 forbids.

**`POST` always regenerates.** It is wired to an explicit refresh control, and a
button that silently served a cached row would read as broken. This differs from
`POST /pulls/:id/blast/summary`, which does serve its cache; the difference is
intentional.

The in-flight guard is an in-process `Set` on `BriefService`, like
`IntentService`'s and `BlastService`'s. It does not survive a restart; the cost
is one duplicate generation, so it needs no table.

`POST` is synchronous on purpose: one bounded call, nothing to stream, no job to
track. There is no run on this path, so the composition facts — provider, model,
source labels, character and token counts, and every grounding drop — go to pino
via `container.logger`, never to a `run_traces` document.

## 3. Cache and staleness

**The cache key is `head_sha`.** A row written at an older head is never served:
the file list, the blast map and the findings it described belong to code that
no longer exists.

**`review_id` is not part of the key.** It records which review's findings fed
the brief. When the PR's latest review is no longer that one, the response
carries `stale: true` and the card marks itself and highlights the regenerate
control — but the cached row is still served. A brief one review out of date is
more useful than an empty card, and regenerating on the user's behalf would
spend a model call nobody asked for.

The consequence is a real limitation and is stated plainly: at one head, running
a new review makes the brief's `review_focus` describe findings that may no
longer be the current set until someone regenerates.

A regeneration replaces the row **wholesale, `created_at` included**, because
the row describes *this* generation. A stored `json` that no longer parses
against `Brief` is reported as the empty state, not a 500 — the regenerate
control is right there, and it writes a row in the current shape.

## 4. Inputs and the token budget

**Unit.** `est_tokens = ceil(chars / 4)`, the same estimate
[`project-context/helpers.ts`](../src/modules/project-context/helpers.ts) uses.
The ceiling is `MAX_EST_TOKENS_IN = 8000` ⇒ **32 000 characters**. The estimate —
not a tokenizer count — is the budget's unit, so the invariant is deterministic
and testable with no provider in the loop. The real tiktoken count goes to the
log through `container.tokenizer` for observability only; it is never the gate.

**No diff bodies, at any cap.** Only `path`, `additions` and `deletions` are
read from `pr_files`; the `patch` column is never touched. This is enforced by
the *type*: `BriefFileRow` has no `patch` field, and the container drops it when
the row crosses into the module. Asserted by test, not by convention.

| # | Source | Label | Where from | Cap (chars) |
|---|---|---|---|---|
| 1 | Header: title, author, branch, `+N -M`, file count | `pr` | `pull_requests` | 500 |
| 2 | Changed files with per-file `+/-` | `files` | `pr_files`, 60 files then `… N more file(s)` | 5 000 |
| 3 | Intent statement, `in_scope`, `out_of_scope`, `confidence` | `intent` | `pr_intent` | 1 500 |
| 4 | Linked issue: `number`, `title`, `body` | `issue#<n>` | `pr_intent.linked_issue` | 3 000 |
| 5 | Blast map JSON without `summary`, plus the summary paragraph when one exists | `blast` | `BlastService.get` | 6 000 |
| 6 | Latest review's findings: `file`, line range, `severity`, `category`, `kind`, `title` — **never** `rationale` or `suggestion` | `findings` | newest `reviews` row + its `findings`, 40 items | 6 000 |
| 7 | Specification documents the PR body references | `spec:<path>` | the clone, via the intent module's `CloneDocReader`, 3 × 1 500 | 4 500 |
| | System prompt, headings and untrusted wrappers | | | ~2 000 |
| | **Total** | | | **~28 500 ≈ 7 125 est tokens** |

The per-source caps make an over-budget prompt structurally impossible. A final
`capPrompt()` truncates with a `…[truncated N chars]` marker anyway, so a
carelessly raised constant cannot breach the invariant silently. It reserves
room for its own marker *before* slicing, and it subtracts the system message's
length, so the ceiling bounds the **prompt** rather than half of it.

Everything a cap dropped is recorded in `sources` (`files (60 of 214)`,
`spec:docs/rate-limits.md (truncated)`), so a truncated input can never read as
a complete one. Omitted sources are recorded there too (`blast (degraded: …)`,
`findings (no review yet)`).

**Source 7** means *documents this PR references*: the `.md` paths and same-repo
blob URLs `docReferences` extracts, read through `CloneDocReader` with its path
confinement and symlink checks intact. Documents merely sitting under a
`context_roots` directory are **not** included — a spec the author never
mentioned is a guess about relevance rather than a fact about the PR.

Both `docReferences` and `CloneDocReader` live in `modules/intent/`, so they are
reached from the container, never imported by `modules/brief/`
(`no-cross-module-internals`). That is why `BriefDocsPort.read` takes the raw PR
body rather than extracted paths.

## 5. The grounding gate

`buildAllowed` + `groundBrief` in
[`helpers.ts`](../src/modules/brief/helpers.ts), applied after the model call
and **before** persistence. Pure functions: they return their drops, they do not
log. This mirrors [`scopeFindings`](../../reviewer-core/src/scope.ts).

The allowed sets are built from the inputs alone:

- `allowed.files` — every path in `pr_files`, every changed-symbol file and
  every **caller** file in the blast map, and the paths of the specification
  documents actually read.
- `allowed.endpoints` — `endpoints` and `crons`, both the per-symbol
  attributions and the BFS-widened union; which of the two the model quoted is
  incidental.
- `allowed.findingRanges` — `start_line … end_line` per file.

The rules:

1. Every `risk.refs[]` entry is normalised (separators folded to POSIX, nothing
   else) and, where it has the `file:line` form, split on the **last** `:`. An
   entry in neither allowed set is **dropped from the risk**.
2. A risk left with zero refs is **dropped entirely**. A risk that names nothing
   in the pull request is the failure mode this feature exists to avoid.
3. A `review_focus` item whose `file` is not in `allowed.files` is **dropped**.
4. A `review_focus` item's `line` survives only inside a finding's range on that
   same file. Otherwise `line` becomes `null` and **the item is kept** — "read
   this file first" is still grounded; only the unsupported part goes.
5. `risk_level`, `what` and `why` pass through unchanged. They are judgements,
   not references, and there is nothing to check them against.

Normalisation deliberately does **not** resolve `..`, strip a leading `/`, or
trim `./`. Repairing a traversal attempt into a match is precisely the input
this gate exists to reject: comparison is exact, never by `includes` or suffix,
so `config.ts` does not match `src/config.ts` in either direction.

Every drop is returned as `{ kind, value, reason }`, logged to pino, and counted
on the generation's log line. Nothing goes silent: a suppressed real risk is
invisible by construction, which is the same reason the scope gate reports its
drops.

## 6. Model

The `risk_brief` entry in `FEATURE_MODELS`
([`contracts/platform.ts`](../src/vendor/shared/contracts/platform.ts)),
resolved through the workspace's Settings choice with the registry's
`defaultModel` as the fallback — **read from the registry, never restated
locally**, so the Settings screen cannot advertise one model while another runs.
The pattern `IntentRepository.featureModelChoice` established;
`BriefRepository.featureModelChoice` reads `settings.feature_models.risk_brief`
directly rather than through `modules/settings/`, which would close an import
cycle.

`risk_brief`'s default is `openai/gpt-4.1` rather than a flash-class model, and
it stays that way: unlike the blast summary, this call weighs seven sources
against each other and orders them.

## 7. Prompt

Trusted system prompt plus `INJECTION_GUARD`. Every input block goes through
`wrapUntrusted` with its own source label. All seven are author-controlled or
derived from author-controlled text: a branch name, a file path, an issue body
and a committed `.md` can each be written to read like an instruction.

The output shape is enforced out of band by structured output rather than
described in prose, per [`docs/agent-prompts/`](../../docs/agent-prompts/).

Messages are assembled once, by `buildBriefPrompt`, and handed to the model port
as messages — not re-assembled by the service to measure. The string that is
counted and the string that is sent must be the same string, or `est_tokens_in`
is fiction.

## 8. Degradation

The house rule: degrade visibly, never fail the caller.

| Situation | Behaviour |
|---|---|
| Blast map is `degraded`, or `BlastService.get` throws | Section omitted, recorded in `sources`; the brief is composed from the rest. **Not** a 422 — unlike the blast summary, the map is one input of seven here |
| No intent derived | Section omitted; `risk_level` is judged without it |
| No review yet, or a review with no findings | Section omitted; `review_focus` comes out file-level, every `line` `null` |
| Linked issue absent or its fetch failed at intent time | Column is `null`, section omitted |
| Referenced document missing, outside the clone, or a symlink pointing out of it | Not read — the existing `CloneDocReader` refusals, which never throw |
| Repo has no clone on disk | No `spec:` sources; each reference is recorded as unread |
| Model call fails, or the output fails schema repair | **Nothing persisted**, the error surfaces to the caller. It is a user action and a silent success would be a lie |
| Every risk dropped by the gate | A brief with an empty `risks` array is persisted and served; the card says so. An empty list is the honest answer when nothing survived |
| Stored `json` no longer parses against `Brief` | `GET` reports the empty state and logs; not a 500 |
| PR has no changed files | **422** `brief_no_inputs`. There is no question to ask, and asking anyway would produce a repo-wide answer |
| Generation already in flight | **409** with code `conflict` |
| PR in another workspace | **404** on both routes |

## 9. Layering

`modules/brief/` follows the Onion rule; `pnpm arch:check` stays at its frozen
24 known violations.

```
routes.ts       Fastify plugin: HTTP + zod schemas only
service.ts      compose → budget → model → ground → persist
ports.ts        the port interfaces, BriefSection and BriefOutputShape. Imports
                nothing from the module — that is what keeps it acyclic
prompt.ts       system prompt, message assembly, module-local BriefOutput
model.ts        one completeStructured call, nothing else
helpers.ts      estTokens, capPrompt, the renderers, buildAllowed, groundBrief
constants.ts    the caps, MAX_EST_TOKENS_IN, BYTES_PER_ESTIMATED_TOKEN
repository.ts   the only place touching pr_brief
```

The service never imports another module's `repository.ts`. The blast map, the
pull row, `pr_files`, `pr_intent` and the latest review's findings all arrive as
narrow ports wired in
[`platform/container.ts`](../src/platform/container.ts). Port row shapes are
declared structurally in the module, never imported from `modules/reviews/`.

## 10. Seed

`pnpm db:seed` writes one `pr_brief` row for the demo PR #482 so the card is
populated on a fresh install and the e2e flow has a deterministic target with no
model key. `onConflictDoNothing`, outside the "PR does not exist yet" branch, so
a database seeded before this feature acquires the row on the next run.
`head_sha` is read off the seeded PR row rather than restated, or the card would
render as permanently stale. `provider` and `model` are `seed`, and `review_id`
points at the seeded review so `stale` is `false`.

Every path and endpoint in the seeded brief appears in the seeded `pr_files`,
`file_facts` or findings, and every `review_focus` line falls inside a seeded
finding's range: a fixture that violates the gate it demonstrates is worse than
no fixture.

## 11. Acceptance

| # | Item | Verified by |
|---|---|---|
| AC-1 | `POST` returns a `Brief` with all five fields from one structured call | `brief-routes.it.test.ts` |
| AC-2 | Every `risk.refs[]` entry names a file in `pr_files`, a caller file in the blast map, a read specification document, or an endpoint/cron from the map — anything else is dropped with a reason | `brief-grounding.test.ts` |
| AC-3 | Every `review_focus[].file` is in the allowed set, and a `line` survives only inside a finding's range on that file | `brief-grounding.test.ts` |
| AC-4 | Re-opening a PR at an unchanged head serves the stored brief with **zero** model calls | `brief-routes.it.test.ts`, `MockLLMProvider.calls` counter |
| AC-5 | The assembled prompt never exceeds `MAX_EST_TOKENS_IN`, measured as `ceil(chars / 4)`, on a deliberately oversized PR | `brief-prompt.test.ts` |
| AC-6 | No diff hunk body reaches the prompt at any input size | `brief-prompt.test.ts` |
| AC-7 | An explicit regenerate always performs a fresh generation and replaces the row | `brief-routes.it.test.ts` |
| AC-8 | A brief whose `review_id` is not the PR's latest review is served with `stale: true` | `brief-service.test.ts` |
| AC-9 | A degraded blast map, an absent intent and an absent review each omit their section and still yield a brief | `brief-service.test.ts` |
| AC-10 | A PR with no changed files yields **422** `brief_no_inputs`, and no model call is made | `brief-service.test.ts`, `brief-routes.it.test.ts` |
| AC-11 | A second concurrent `POST` for one PR yields **409** | `brief-service.test.ts`, `brief-routes.it.test.ts` |
| AC-12 | A PR in another workspace is **404** on both routes | `brief-routes.it.test.ts` |
| AC-13 | `pr_intent.linked_issue` is populated at derivation and surfaces on `PrIntentRecord`; no new network call on the brief path | `intent-service.test.ts`, `pr-intent.it.test.ts` |
| AC-15 | A hostile PR body, branch name, issue body or committed `.md` cannot make the brief name a file outside the pull request | `brief-grounding.test.ts` |

AC-14 (card rendering) and AC-16 (the gates) belong to
[`client/specs/pr-brief-card.md`](../../client/specs/pr-brief-card.md) and the
build respectively.

## 12. Known gaps

- **No per-file status.** `pr_files` does not store added/modified/removed, and
  it cannot be inferred from the counts without guessing, so the file list
  carries paths and counts only.
- **`stale` is one bit.** It says the latest review is not the one that fed the
  brief; it does not say how much the findings actually changed.
- **The in-flight guard is per process.** Two API instances against one database
  can each generate once for the same PR.
