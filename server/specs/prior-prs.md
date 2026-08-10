# Spec — Prior PRs touching these files

**Status:** DONE (2026-08-10)
**Owner:** server (`GET /pulls/:id/prior-prs`) · **Consumer:** client
**Design:** [`docs/superpowers/specs/2026-08-10-prior-prs-design.md`](../../docs/superpowers/specs/2026-08-10-prior-prs-design.md)
**Plan:** [`docs/superpowers/plans/2026-08-10-prior-prs.md`](../../docs/superpowers/plans/2026-08-10-prior-prs.md)
**Contract:** [`contracts/blast.ts`](../src/vendor/shared/contracts/blast.ts) —
`PriorPrC` / `PriorPrsResponse`; shapes are referenced, never restated here
**Client half:** [`client/specs/blast-radius-card.md`](../../client/specs/blast-radius-card.md) §7

The blast map answers *what does this PR reach*. This endpoint answers the
question a reviewer asks immediately afterwards: **who else has been in these
files, and what did they do there?**

## 1. Scope

`GET /pulls/:id/prior-prs` → `PriorPrsResponse`. It lives in the **`blast`
module** — the PR-scoped module already built to the current layering rules,
whose `BlastStorePort` already reads `pr_files` through `reviewRepo`; this adds
two methods to a port that exists rather than a whole module for one read.

**Out of scope, deliberately:** open PRs touching the same files (a *collision*,
a different and arguably more urgent signal, and a candidate for its own spec);
symbol-level overlap; any GitHub API call; any model call; backfilling
`pr_files`.

It is a **separate endpoint, not a field on `GET /pulls/:id/blast`**. Extending
the map would make every blast render pay for the join, and that response is
serialised into the summary model's prompt, so prior PRs would leak into a call
with no use for them.

## 2. Contract

`PriorPrsResponse` carries `prs: PriorPrC[]` and `uncomparable_prs: number`.

`overlap_count` is the **untruncated** total of shared paths while
`overlap_files` is **capped at 5**. A PR overlapping forty files says "40" and
ships five paths, never claims five. The cap is applied in the service, not the
query ([`helpers.ts:108`](../src/modules/blast/helpers.ts)), which is precisely
what lets the count stay true after the list is cut — the query returns every
shared path ([`pull.repo.ts:132`](../src/modules/reviews/repository/pull.repo.ts)).

`status` is GitHub's merge state; this list only ever carries `merged` or
`closed`.

**Status codes:** 200 for a PR that exists in the caller's workspace; 404 for an
unknown *or foreign* PR, matching `GET /pulls/:id/blast` — a PR in another
workspace is indistinguishable from one that does not exist. Never 5xx on an
empty result: nothing found is a 200 with an empty list.

## 3. What counts as "prior"

Merged and closed only, via an **allowlist**
([`constants.ts:31`](../src/modules/blast/constants.ts)), not a `!== 'open'`
test. `pull_requests.status` carries the schema default `needs_review` until a
GitHub sync overwrites it
([`db/schema/pulls.ts:25`](../src/db/schema/pulls.ts)), and a never-synced row is
not history either — a negative test would sweep every one of them in.

Overlap is on **file paths**, not symbols. That is a weaker question than the
blast map's and a much cheaper one: no index, no AST, one grouped join.

The subject PR is always excluded from its own list
([`pull.repo.ts:132`](../src/modules/reviews/repository/pull.repo.ts), `ne` on
the id).

## 4. Behaviour

**Ordering:** overlap count descending, then `updated_at` descending with
`nulls last` ([`pull.repo.ts:168`](../src/modules/reviews/repository/pull.repo.ts)).
`updated_at` is nullable on `pull_requests`, so the null handling is explicit
rather than left to Postgres' default.

**Caps:** at most 10 PRs
([`constants.ts:34`](../src/modules/blast/constants.ts)), at most 5 shared paths
each ([`constants.ts:41`](../src/modules/blast/constants.ts)). The PR limit is
applied in SQL; the path cap in the service.

**Scoping:** every query filters on both `workspace_id` and `repo_id`
([`pull.repo.ts:132`](../src/modules/reviews/repository/pull.repo.ts)). A merged,
overlapping PR in a *different repo of the same workspace* is not in the list.

**Short-circuit:** a PR with no stored paths returns an empty list without
running the join ([`service.ts:137`](../src/modules/blast/service.ts)) — there is
no question to ask, and `path IN ()` is not valid SQL. `uncomparable_prs` is
still read and reported on that path; see §5, it is the whole point of it.

**Cost:** two queries, both bounded. No model call, no GitHub call, no index
read. One grouped join rather than a query per candidate PR:
`count(distinct path)` both orders the list and reports the true overlap.

## 5. Degradation — the blind spot

`pr_files` is populated by `GET /pulls/:id`, so **a PR whose detail was never
opened has no file rows and is invisible to the join.** An empty list on its own
would therefore claim "nothing has touched these files" when the truth is "we
have not looked at most of them" — exactly the confusion `BlastStatus` exists to
prevent on the map above it.

So the response carries **`uncomparable_prs`**: how many other PRs in this repo
have no stored file rows at all
([`pull.repo.ts:181`](../src/modules/reviews/repository/pull.repo.ts), a
`NOT EXISTS` count). When non-zero, the list is explicitly a lower bound and the
client says so instead of rendering an all-clear. It costs one `COUNT(*)`.

Note the count is deliberately **not** filtered by the status allowlist: it
answers "how much of this repo could not be compared at all", not "how many
merged PRs are missing". It therefore includes open and never-synced PRs, which
could not have appeared in the list regardless — the number is an upper bound on
the blind spot, not a precise count of missed history.

There is no other degraded mode. The endpoint reads two tables the API owns; if
they answer, the result is complete within that caveat.

## 6. Layering

| Ring | File | Holds |
|---|---|---|
| Driving adapter | [`blast/routes.ts:36`](../src/modules/blast/routes.ts) | the GET, `getContext`, `IdParams` |
| Core | [`blast/service.ts:126`](../src/modules/blast/service.ts) | the use case: 404 gate, short-circuit, caps |
| Core | [`blast/ports.ts:65`](../src/modules/blast/ports.ts) | `PriorPrShape`, the two `BlastStorePort` methods |
| Core | [`blast/helpers.ts:108`](../src/modules/blast/helpers.ts) | `toPriorPrWire`, pure |
| Driven adapter | [`reviews/repository/pull.repo.ts:132`](../src/modules/reviews/repository/pull.repo.ts) | the two queries |
| Composition root | [`platform/container.ts:286`](../src/platform/container.ts) | the port closures over `reviewRepo` |

`PriorPrShape` (core) and `PriorPrRow` (adapter) are structurally identical but
separately declared, so no `$inferSelect` row alias crosses into the core and the
container still assigns one to the other with no cast.

## 7. On a seeded database this endpoint returns nothing

`seed.ts` creates **one** pull request, with `status: 'needs_review'`. A seeded
database therefore has no second PR to compare against and none carrying a merge
state. That is expected, not a bug — the integration test inserts its own
fixtures for exactly this reason
([`test/blast-prior-prs.it.test.ts`](../test/blast-prior-prs.it.test.ts)).

## 8. Acceptance

| # | Item | Covered by |
|---|---|---|
| 1 | Ordered by overlap desc, then `updated_at` desc | `blast-prior-prs.it.test.ts` ("orders by overlap, then by recency") |
| 2 | `overlap_count` counts only *shared* paths, distinct | `.it` ("counts distinct shared paths, ignoring the PR files that do not overlap") |
| 3 | Row carries number, title, author, status, `updated_at` | `.it` ("carries the fields the row needs and nothing invented") |
| 4 | Open, never-synced, non-overlapping, other-repo and the subject itself are all excluded | `.it` ("excludes open, never-synced, non-overlapping, other-repo and the subject itself") |
| 5 | Workspace-scoped | `.it` ("scopes to the workspace") |
| 6 | The 10-PR limit is applied in SQL | `.it` ("honours the limit") |
| 7 | `uncomparable_prs` counts PRs with no `pr_files` rows | `.it` ("counts the PRs that have no stored files at all") |
| 8 | The route serves the list, serialises `updated_at` as ISO, and 404s an unknown PR | `.it` ("serves the list and the disclosure, and 404s an unknown PR") |
| 9 | `overlap_files` is capped at 5 while `overlap_count` stays the true total | `blast-prior-prs.test.ts` ("caps the paths it ships WITHOUT capping the count") |
| 10 | The store is asked for at most `MAX_PRIOR_PRS`, scoped, excluding itself | `blast-prior-prs.test.ts` ("asks the store for at most MAX_PRIOR_PRS…") |
| 11 | No stored paths short-circuits without running the join, but still reports the disclosure | `blast-prior-prs.test.ts` ("short-circuits with no stored paths…") |
| 12 | A PR in another workspace 404s | `blast-prior-prs.test.ts` ("404s on a PR in another workspace…") |

The query tests are `*.it.test.ts` on purpose: grouping, `count(distinct)`,
`array_agg` and the ordering can only be wrong against Postgres, so a stubbed
test of that file would assert nothing.

## 9. Known gaps

- **The blind spot is reported, not removed.** Backfilling `pr_files` for every
  PR at import time would eliminate it, at the cost of a much heavier import.
  Out of scope here; `uncomparable_prs` is the honest interim.
- **`uncomparable_prs` is an upper bound**, not a count of missed *history* — see
  §5. Narrowing it to the status allowlist would be a contract change.
- **Open PRs touching the same files are not surfaced anywhere.** That collision
  signal needs its own spec.
