# Design — Smart Diff: the PR's files, ordered by how much they matter

Date: 2026-08-06
Status: approved, not yet implemented

## Problem

The Files changed tab renders a PR's files in whatever order GitHub returned
them, each card identical to the next. On the seeded demo PR that puts a
116-line lock-file diff between the reviewer and the token-bucket limiter that
is the actual change; on a real PR it puts generated output, snapshots and a
`pnpm-lock.yaml` there too. The reviewer's attention is spent in import order.

Meanwhile the two things needed to fix that are already in the product and
already unused:

- **The contract exists and nothing serves it.** `SmartDiffRole`,
  `SmartDiffFile`, `SmartDiffGroup`, `ProposedSplit` and `SmartDiff` in
  [`contracts/brief.ts`](../../../server/src/vendor/shared/contracts/brief.ts),
  in both vendor copies, re-exported by
  [`client/src/lib/types.ts`](../../../client/src/lib/types.ts) and parsed by a
  round-trip case in
  [`server/test/contracts.test.ts`](../../../server/test/contracts.test.ts) —
  with no producer and no consumer.
- **The strings exist and nothing renders them.**
  [`client/messages/en/prReview.json`](../../../client/messages/en/prReview.json)
  carries a whole `smartDiff` block: `coreLabel`, `wiringLabel`,
  `boilerplateLabel`, `largeTitle`, `largeBody`, `filesCount`, `findingLines`,
  `groupedByRole`.
- **Both data sources are live.** `GET /pulls/:id` already returns `files[]` with
  `path`, `additions`, `deletions`, `patch`; `reviewRepo.reviewsForPull(prId)`
  already returns every review with its findings (`file`, `start_line`,
  `end_line`, `severity`, `dismissed_at`).

So this is a wiring feature with one deliberate exception, and that exception is
where the risk is: the contract's `pseudocode_summary` can only be filled by a
model, while the requirement is that *viewing* Smart Diff never calls one.

## Goal

Group a PR's changed files into `core`, `wiring` and `boilerplate` by path alone,
order them so the substance comes first, mark the files and lines that already
carry findings, keep the mechanical files collapsed, and say when the PR is too
big to review in one sitting — all deterministically, with no model call on the
read path. Then offer a per-file "what does this do?" summary as an **explicit
click**, so the one place a model is involved is a place the user asked for.

## 1. Scope

**In scope**

- A `smart-diff` server module owning classification, grouping, ordering and the
  split suggestion — pure functions over paths and diff stats.
- `GET /pulls/:id/smart-diff`, which never calls a model.
- `POST /pulls/:id/smart-diff/summary`, which calls one on demand for one file.
- A new `pr_file_summary` table, keyed on the head SHA the summary describes.
- Three additive contract edits, applied to **both** vendor copies.
- `SmartDiffViewer` as the Files changed tab, with `?order=original` falling back
  to today's flat viewer.
- Seed rows that make the demo PR demonstrate all three groups and a lock file.

**Out of scope**

- Using `repo-intel` (symbols, import graph, file rank) to classify. Ranking a
  file by how much depends on it is a **Blast Radius** concern (L04), and mixing
  it in here would make the grouping non-deterministic across index states.
- Using the derived intent's `in_scope` to select which files are reviewed.
  `server/specs/intent.md` §1 already assigns that to Smart Diff; it is not this
  change.
- Feeding the grouping into the review prompt, into `PrBrief`, or into CI export.
- Per-file review checkboxes, "viewed" state, or any persistence of what the
  reviewer has read.
- Automatically summarising every file in a PR, on any trigger.
- A fourth role. The contract's enum is closed at three and stays closed.

## 2. Classification

One pure function, `classifyPath(path): SmartDiffRole`, with every pattern and
threshold in `modules/smart-diff/constants.ts`. Path and diff stats only — no
file contents, no index, no model, no network. The same PR classifies the same
way on any machine, before any review, forever.

### 2.1 The three roles

| Role | Matches | Rationale |
|---|---|---|
| `boilerplate` | lock files (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`); generated/vendored directories (`dist/`, `build/`, `out/`, `.next/`, `coverage/`, `vendor/`, `node_modules/`); snapshots (`__snapshots__/`, `*.snap`); `*.min.js`, `*.map`; generated markers (`*.gen.*`, `*.generated.*`); generated SQL under a `migrations/` segment (`**/migrations/**/*.sql` — a hand-written `.sql` elsewhere is core); binary and asset extensions; `*.md` and anything under `docs/` | nothing here is read line by line, and a diff that is mostly this is a diff whose substance is hidden |
| `wiring` | barrels (`index.ts`, `index.tsx`); entrypoints (`server.ts`, `app.ts`, `main.ts`); `config.*`, `*.config.*`; `package.json`; `.env.example`; CI and compose YAML | real code, but it *connects* the change rather than being it — read second, and read for what it exposes |
| `core` | everything else | the default, deliberately |

Two calls worth stating because a reader will otherwise assume the opposite:

- **Tests are `core`.** A test change is substance; a reviewer who skims the
  tests is exactly the failure this feature exists to prevent. A PR that is
  mostly tests therefore leads with them, which is correct.
- **Markdown is `boilerplate`.** Prose docs are not generated, but they are
  skim-first, and the enum has no better home. The group's description string is
  written to cover it — "Generated, vendored or peripheral — skim" — rather than
  the mockup's "Generated / mechanical".

`boilerplate` is tested first, then `wiring`, then the `core` default: a
`dist/index.js` is generated output, not a barrel, and evaluating in the other
order would file it under wiring.

The directory names overlap `EXCLUDED_DIRS` in
[`repo-intel/constants.ts`](../../../server/src/modules/repo-intel/constants.ts)
on purpose. Importing them would be a `no-cross-module-internals` violation, so
they are restated locally with a comment naming the original. They are also not
the same list conceptually — repo-intel is deciding what to *parse*, this is
deciding what a human should read first.

### 2.2 Ordering is total and deterministic

Groups are always emitted `core → wiring → boilerplate`, present-only (a PR with
no boilerplate emits two groups, not three with an empty one). Files inside a
group sort by:

1. finding count, descending — the file with four blockers leads;
2. changed lines (`additions + deletions`), descending;
3. path, ascending.

The third key makes the order total, so two runs over the same data cannot
differ. Without it, a PR whose files tie on both counts renders in whatever order
Postgres returned, and a screenshot in a test becomes flaky.

### 2.3 The split suggestion

`total_lines` is Σ(`additions + deletions`) over **all** files, boilerplate
included. That is what `contracts.test.ts` already asserts (`total_lines: 285`
against a PR whose header reads `+247 −38`), and it is the honest number: a
1 200-line lock-file bump *is* a large PR to pull and rebase, however little of
it gets read.

`too_big` is `total_lines > SPLIT_LINES_MAX` **or** file count `> SPLIT_FILES_MAX`
(both constants, 400 and 20). The seeded PR's 285 lines and 9 files sit under
both, so the banner is absent on a fresh install — matching the mockup, which
shows no banner.

When `too_big`, splits are formed from `core` and `wiring` files only, grouped by
their two-segment directory prefix (`src/middleware`, `src/api/public`). A
directory with only one segment is that segment (`src/x.ts` → `src`); a file at
the repository root groups under `root`. Splits are ordered by changed lines
descending and capped at `MAX_PROPOSED_SPLITS` (4), with every remaining file
folded into a final split named `everything else` — capped, but nothing silently
dropped. Boilerplate never forms a split: "open a PR containing only your
lock-file" is not advice.

If the grouping yields **fewer than two** splits, `proposed_splits` is `[]`. The
PR is large but it is all one area, and an empty list under the banner says that
more honestly than a one-item list pretending to be a plan.

## 3. Data model

### 3.1 `pr_file_summary` — new, and it cannot live anywhere else

```
pr_file_summary
  pr_id     uuid  FK pull_requests ON DELETE CASCADE
  path      text
  head_sha  text                     -- the commit this sentence describes
  summary   text
  provider  text
  model     text
  created_at timestamptz
  PRIMARY KEY (pr_id, path)
```

The obvious cheaper option — a `summary` column on `pr_files` — is wrong, and
non-obviously so: [`pulls/routes.ts`](../../../server/src/modules/pulls/routes.ts)
**deletes and re-inserts every `pr_files` row on each `GET /pulls/:id`**, so a
summary stored there is destroyed by the next page load. Nothing would error; the
feature would just quietly never cache.

`head_sha` is the freshness key, exactly as on `pr_intent`. Re-derivation
replaces the row wholesale, `created_at` included: the row describes one
derivation, not the first ever made for this file.

The `smart-diff` module owns this table through its own `repository.ts`. That is
a departure from how `pr_intent` is reached — a port into the reviews aggregate —
and the reason is that `pr_intent` was *already* owned by reviews, whereas this
table has exactly one writer. Everything the module does **not** own — the pull
row, `pr_files`, findings — it reads through `container.reviewRepo`
(`getPull`, `getPrFiles`, `reviewsForPull`), never by importing another module's
repository.

### 3.2 Which findings count

**Every non-dismissed finding on the PR**, across all agents and all runs — the
same set the Findings tab and the header counter already show. A PR that reports
seven findings in one place and four in another is a bug report waiting to
happen, and nothing on screen would explain the gap.

The cost is accepted and recorded: a finding from an older head SHA can still
mark a line, and after a force-push a mark can point at code that moved. The
alternative — filtering to the current `head_sha` — blanks Smart Diff entirely
after every new commit until the PR is re-reviewed, which is a worse default for
a tool whose job is to be useful before the review as well as after.

## 4. Contracts

`src/vendor/shared/contracts/` is the source of truth and **there are two
physical copies** — `server/src/vendor/shared/` (also consumed by
`reviewer-core`) and `client/src/vendor/shared/`. Every edit below lands in both,
and both packages type-check.

Three edits, all additive. No existing field changes type or optionality, so the
`SmartDiff` round-trip in `server/test/contracts.test.ts` keeps passing unedited.

| # | Edit | Shape |
|---|---|---|
| 1 | `SmartDiffFile.finding_marks` | `nullish` array of `{ line: int, severity: Severity, finding_id: string }` |
| 2 | `PrFileSummaryRecord` in `contracts/review-api.ts` | `pr_id`, `path`, `head_sha`, `summary`, `provider`, `model`, `created_at` |
| 3 | `FeatureModelId` + `FEATURE_MODELS` in `contracts/platform.ts` | a `file_summary` member and its registry entry |

On edit 1: the endpoint **always sends an array**, empty when the PR has no
findings; `nullish` exists only so the committed round-trip case in
`contracts.test.ts`, which omits the field, keeps parsing unedited. A consumer
therefore never has to distinguish "no findings" from "field absent" on data this
API produced. `finding_lines` stays **required**, and is defined as the sorted,
de-duplicated projection of `finding_marks`. The service derives one from the
other in a single place, so the two cannot disagree. The redundancy is the price
of not breaking a committed contract and its test; the alternative — replacing
`finding_lines` — edits scaffolding the repo's own `CLAUDE.md` says to leave
alone.

`brief.ts` is **not** on the known-drift list in the root `CLAUDE.md`
(`adapters.ts`, `contracts/trace.ts`, `knowledge.ts`, `eval-ci.ts`,
`productionize.ts`), so the two copies match today and must still match after.

On edit 3: `FeatureModelId` is a closed `z.enum`, so without a new member the
summary model is unselectable in Settings and the Models screen cannot show what
actually runs. The entry's `defaultProvider`/`defaultModel` are flash-class,
mirroring `review_intent`'s reasoning — one bounded call over one file's patch —
and the module reads the default **from the registry**, never restating it
locally, so Settings can never advertise one model while another runs.

## 5. Module and endpoints

`server/src/modules/smart-diff/` — `routes.ts` (HTTP + zod only), `service.ts`
(composition), `helpers.ts` (the pure classifier, grouping, ordering, splits),
`constants.ts` (every pattern, every threshold, every cap), `model.ts` (the
summary call), `ports.ts`, `repository.ts` (`pr_file_summary` only). One import
and one entry in
[`modules/index.ts`](../../../server/src/modules/index.ts) — whose own comment
already reserves `intent/smart-diff` as a lesson module.

Both routes call `getContext(container, req)` and scope by `workspaceId`. A PR in
another workspace is a **404, never a 403**.

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/pulls/:id/smart-diff` | **200** `SmartDiff`. Reads `pr_files`, joins non-dismissed findings, fills `pseudocode_summary` from `pr_file_summary` rows whose `head_sha` matches the PR's current head. **Never calls a model on any path.** **404** unknown PR or another workspace's. **422** non-uuid `:id` |
| `POST` | `/pulls/:id/smart-diff/summary` | body `{ path }`. **200** `PrFileSummaryRecord`. A cached row at the current head returns **with no model call**. **404** unknown PR, or a `path` not among this PR's files. **409** (`conflict`) while a summary for the same `(pr, path)` is already in flight. **422** non-uuid `:id` or empty `path`. A provider failure **propagates** to the error handler — 500 for a plain error, the adapter's own status for an `AppError` (e.g. 502 from `ExternalServiceError`) |

`POST` is synchronous: one bounded call, nothing to stream, no job to track —
the same reasoning as `POST /pulls/:id/intent`. There is no run on this path, so
provider, model, character and token counts go to pino via the route's log, never
to a `run_traces` document.

The in-flight guard is an in-process `Set` keyed `` `${prId}:${path}` `` on the
service, like `RunBus`'s cancel set and `IntentService`'s guard. It does not
survive a restart; the cost of that is one duplicate summary, so it needs no
table.

Validating `path` against the PR's own `pr_files` before any model call is
load-bearing, not defensive: without it the endpoint is a request to summarise
an arbitrary caller-supplied string, and the 404 is what pins the input to
material the workspace already imported.

### 5.1 The summary prompt

A **feature prompt in code**, like
[`reviewer-core/src/intent/prompt.ts`](../../../reviewer-core/src/intent/prompt.ts)
— not an agent `system_prompt` on the `agents` table. It therefore does **not**
belong in [`docs/agent-prompts/`](../../agent-prompts/), gets no severity rubric,
no verdict mapping and no findings discipline; those conventions govern reviewer
agents, and importing them here would be cargo cult.

Two of that doc's rules do apply, and are followed: the output shape is enforced
out of band by structured output (`{ summary: string }`), never described in
prose; and the input is author-controlled, so the patch is wrapped
`wrapUntrusted('diff', …)` with the trusted instruction outside the wrap.

Input is **that one file's patch and nothing else** — no other file, no repo map,
no PR body — truncated at `MAX_PATCH_CHARS` (8 000). A truncated patch appends a
marker line naming how much was dropped, the way `hunkHeaderDigest` reports its
own caps: a partial patch must not read to the model as a complete one. Output is
one sentence, capped at `MAX_SUMMARY_CHARS` (280) before it is stored, so a model
that returns an essay cannot turn a file header into a wall of text.

## 6. UI

### 6.1 Smart Diff *is* the Files changed tab

`?order=original` on the PR page falls back to today's flat `DiffViewer`; smart
order is the default. That is one more query param beside the existing `?tab=`
and `?trace=`, set through `page.tsx`'s existing `setParam`, so the view stays
shareable and survives a reload.

Components live local to the route, since exactly one route uses them:
`DiffTab/_components/SmartDiffViewer/`, with `_components/GroupSection`,
`_components/SplitBanner` and `_components/SummaryPill` under it — each a folder
with `constants.ts`, `helpers.ts`, `styles.ts` and `index.ts` per the client
convention, Tailwind strings in `styles.ts`, strings through the `smartDiff`
message block.

### 6.2 One diff renderer, extended — not a second one

`FileCard` is exported from the `diff-viewer` barrel and gains optional props:
`defaultOpen`, `marks`, `summary`, `onRequestSummary`, `summaryPending`,
`scrollToLine`. `CodeLine` gains an optional `mark`, which draws the severity
chip and the coloured left border. **Every new prop defaults to today's
behaviour**, so `?order=original` renders identically to the current tab.

Forking a second renderer would duplicate patch parsing, comment threading and
outdated-comment partitioning — the three least trivial parts of the existing
viewer — and the two copies would drift within one lesson.

Collapse state, in this precedence order:

1. `boilerplate` starts collapsed — **even when it carries a finding**. Its badge
   still shows, and clicking the badge expands it. Criterion 1 says a lock file
   always starts collapsed, and a rule with an exception is not that rule;
2. otherwise a file carrying at least one finding starts expanded, whatever its
   size;
3. otherwise today's `AUTO_EXPAND_MAX_LINES` applies unchanged.

### 6.3 The two click targets are not the same target

- **A file's finding badge** expands that file and scrolls to its first marked
  line. This is the acceptance criterion "badges are clickable and lead to the
  right place in the diff".
- **A line's severity chip** navigates to `?tab=findings&finding=<id>`, reusing
  the deep-link machinery specced in
  [`client/specs/finding-deep-links.md`](../../../client/specs/finding-deep-links.md).

The scroll effect is **latched in a ref**, not guarded by its own value. The
2026-08-02 entry in [`client/INSIGHTS.md`](../../../client/INSIGHTS.md) records
why: query data gets a new array identity on every refetch — a dismiss, a
finished run, a window focus — so an unlatched jump replays itself and yanks the
page back long after the user scrolled away.

### 6.4 Data access

`client/src/lib/hooks/smart-diff.ts`, exported from the hooks barrel:
`useSmartDiff(prId)` on `["pr-smart-diff", prId]`, and a `useFileSummary(prId)`
mutation posting `{ path }` which patches the returned summary into the cached
`SmartDiff` via `setQueryData` — the same shape `hooks/intent.ts` uses. No
`fetch` in a component; failures arrive as `ApiError`.

## 7. Degradation

The house rule: degrade visibly, never fail the read.

| Situation | Behaviour |
|---|---|
| No review has run yet | Every `finding_marks` empty. Grouping, ordering and collapse all still work — Smart Diff is useful **before** the first review, which is half its value |
| Findings roll-up throws | Groups served with empty marks plus a `log.warn`, exactly how the pulls list degrades its cost and findings columns |
| PR never imported (`pr_files` empty) | `groups: []`, `split_suggestion` zeroed, `too_big: false`; the client shows the existing "no changed files" empty state |
| A file has `patch: null` | Classified, counted and ordered normally; the body shows today's "no diff text". True of most seeded files, so this is a first-run path, not an edge case |
| A finding cites a file not in `pr_files` | Ignored for marks. It cannot be rendered, and inventing a group entry for it would put a file in the diff that the diff does not contain |
| Summary provider fails, or no model key | The error surfaces (500, or the adapter's status); the client toasts, the pill returns to idle, and **nothing is persisted** |
| Cached summary at an older `head_sha` | **Not served.** The file shows no summary and the pill is offered again. A sentence describing different code is worse than no sentence |
| A summary for this file is already in flight | **409** with code `conflict` |
| PR in another workspace | 404 on both routes |

## 8. Seed

The seeded PR #482 claims 9 files and `+247 −38` but has **four** `pr_files`
rows, none of them a lock file and none with a `patch`. So on a fresh install
today, neither "a lock file is always boilerplate and starts collapsed" nor
"badges lead to the right place in the diff" can be demonstrated at all.

The seed grows to the mockup's exact nine files, and the arithmetic closes
against the PR row already in the seed:

| Path | +/− | Role |
|---|---|---|
| `src/middleware/ratelimit.ts` | +84 −0 | core |
| `src/api/public/webhooks.ts` | +31 −6 | core |
| `src/api/users.ts` | +7 −2 | core |
| `src/api/public/index.ts` | +12 −2 | wiring |
| `src/server.ts` | +8 −1 | wiring |
| `src/config.ts` | +4 −0 | wiring |
| `package.json` | +3 −1 | wiring |
| `package-lock.json` | +92 −24 | boilerplate |
| `README.md` | +6 −2 | boilerplate |

Σ additions = 247, Σ deletions = 38, files = 9 — exactly the `pull_requests` row
and exactly the `total_lines: 285` already asserted in `contracts.test.ts`. Three
populated groups and a lock file, with no model key and no network.

Files carrying seeded findings also get a minimal unified-diff `patch` at the
line numbers those findings cite (`src/config.ts:12`, `src/api/users.ts:44`), or
there is no rendered line for a chip to land on and criterion 2 is untestable.

Two mechanics matter:

- `pr_files` has **no unique index on `(pr_id, path)`**, so
  `onConflictDoNothing` cannot make this idempotent. The seed instead replaces
  this PR's file rows when it finds fewer than the full set.
- It sits **outside** the `if (!pr)` branch, so a database seeded before this
  feature gains the rows on the next run. That is the lesson
  [`server/specs/intent.md`](../../../server/specs/intent.md) §6 records.

Two deliberate deviations from the mockup, and the same reasoning for both — a
hand-drawn grouping is not evidence, and a rule bent to reproduce one is a rule
that will bend again:

- it files `src/api/users.ts` under Boilerplate; under §2.1 it is **core**;
- it files `package.json` under Boilerplate; under §2.1 it is **wiring**, because
  a new dependency is a supply-chain event and belongs in the read-second group,
  not the skim group. Only the lock-file half of that pair is mechanical.

So the seeded PR renders 3 core files, 4 wiring, 2 boilerplate — three populated
groups, with the lock file criterion 1 needs.

## 9. Testing

| Suite | File | Covers |
|---|---|---|
| server, hermetic | `test/smart-diff-classify.test.ts` | every pattern class in §2.1 including a lock file, a `dist/` bundle, a snapshot, a barrel, a test file (→ core) and markdown (→ boilerplate); `boilerplate`-before-`wiring` evaluation order; total ordering incl. the path tiebreak; `too_big` on each threshold independently; the fewer-than-two-splits `[]` rule; the `everything else` remainder |
| server, DB | `test/smart-diff-routes.it.test.ts` | grouping over real rows; marks from non-dismissed findings only, dismissed excluded; a finding citing an absent file ignored; cross-workspace 404; non-uuid 422; `finding_lines` equals the projection of `finding_marks`; **and the LLM mock recorded zero calls** |
| server, DB | `test/smart-diff-summary.it.test.ts` | first call derives and persists; a second at the same head returns with zero model calls; a changed `head_sha` re-derives and replaces the row; 409 while in flight; a path not in the PR is 404 *before* any model call; a provider failure surfaces as 5xx and persists nothing |
| client | `SmartDiffViewer.test.tsx` | three groups in fixed order with counts; the §6.2 precedence — a finding-bearing core file expanded, a finding-bearing **boilerplate** file still collapsed but badged; badge click expands and scrolls (`scrollIntoView` asserted); chip navigation; the order toggle rendering the flat viewer; the pill's idle / pending / success / failure states |
| e2e | `e2e/specs/09-pr-smart-diff.flow.json` | model-free on the seeded PR: groups render, boilerplate collapsed, badge click expands its file |

Gates: `cd server && pnpm typecheck && pnpm arch:check` — `arch:check` must still
report exactly **24** known violations, never a regenerated baseline — plus
`cd client && pnpm typecheck` and all four suites. `reviewer-core` is untouched
by this change but its path filter still triggers the server workflows.

## 10. Acceptance

| # | Item | Covered by |
|---|---|---|
| 1 | A lock file is always `boilerplate` and starts collapsed | `smart-diff-classify.test.ts`, `SmartDiffViewer.test.tsx`, `09-pr-smart-diff.flow.json` |
| 2 | Finding badges are clickable and land on the right place in the diff | `SmartDiffViewer.test.tsx`, `09-pr-smart-diff.flow.json` |
| 3 | Viewing Smart Diff makes no model call | `smart-diff-routes.it.test.ts` — asserted against the LLM mock, not read out of a log |
| 4 | Every threshold and pattern lives in constants | `modules/smart-diff/constants.ts`; `smart-diff-classify.test.ts` imports them rather than restating numbers |
| 5 | Grouping and ordering work **before** any review has run | `smart-diff-routes.it.test.ts` |
| 6 | Group order is fixed and file order is total — two runs cannot differ | `smart-diff-classify.test.ts` |
| 7 | `total_lines` and `too_big` match the seeded PR (285, `false`) | `smart-diff-routes.it.test.ts` |
| 8 | The ✨ summary derives once, caches at the head SHA, and is not served at a stale one | `smart-diff-summary.it.test.ts` |
| 9 | A summary failure persists nothing and surfaces to the user | `smart-diff-summary.it.test.ts`, `SmartDiffViewer.test.tsx` |
| 10 | Settings → Models lists the file-summary feature and the model it reports is the one that ran | a model-choice integration test, mirroring `intent-model-choice.it.test.ts` |
| 11 | `?order=original` renders exactly today's flat viewer | `SmartDiffViewer.test.tsx` |
| 12 | Both vendor copies of the three contract edits agree; both packages type-check | `contracts.test.ts` + the typecheck gates |
| 13 | A fresh `pnpm db:seed` yields nine files across three groups, summing to +247 −38 | `smart-diff-routes.it.test.ts`, `09-pr-smart-diff.flow.json` |

## 11. Yield: what is in, what is deferred

**In:** deterministic grouping, ordering, collapse, finding marks, split
suggestion, the on-demand summary, the two endpoints, the table, three contract
edits, the seed, and the tests above.

**Deferred, deliberately:** batch-summarising a whole PR; using `in_scope` to
select reviewed files; ranking by `repo-intel` file rank or import fan-in (L04
Blast Radius); a "viewed" checkbox per file; feeding groups into the review
prompt or `PrBrief` (L05); and exporting the grouping to CI (L06). Each is a
separate lesson with its own contract surface.

## 12. Follow-up work this unblocks

- **Blast Radius (L04)** can promote a `wiring` file to the top of `core` once
  fan-in is available, without touching the classifier's contract.
- **PR Brief (L05)** composes `SmartDiff` into `PrBrief` — the field is already
  reserved in `brief.ts`.
- **The out-of-scope badge** that `server/specs/intent.md` §7 records as a known
  gap has an obvious home now: the same line-chip slot this change adds to
  `CodeLine`.
