# Prior PRs touching these files

**Date:** 2026-08-10
**Packages:** `server/`, `client/`
**Status:** approved, ready for planning

## Problem

The blast radius card answers "what does this PR reach". It does not answer the
question a reviewer asks immediately afterwards: **who else has been in these
files, and what did they do there?**

The design comp draws a "Prior PRs touching these files" block inside the card's
border. It was cut from
[`2026-08-10-blast-radius-ui-parity-design.md`](2026-08-10-blast-radius-ui-parity-design.md)
because it has no backend — no query, no route, no contract, no hook — and only
`pr_files` to build it from. This spec adds that backend and the block.

## Scope

**In:** one server endpoint over `pr_files`, its contract in both vendored
`@devdigest/shared` copies, a client hook, and a section inside `BlastCard`.

**Out:** backfilling `pr_files` at import time (see *The blind spot*); anything
symbol-level; any GitHub API call; any model call. This feature adds neither.

## What it lists

**Merged and closed PRs only.** "Prior" means history — what already landed in
these files. An open PR touching the same files is a *collision*, a different
and arguably more urgent signal, but naming it "prior" would misdescribe it. It
is a candidate for a later spec, not this one.

Overlap is on **file paths**, not symbols. That is a weaker question than the
blast map's and a much cheaper one: no index, no AST, one grouped join.

Ordering is **most overlapping files first, then most recently updated** — the
PR that touched most of what you are touching is the one worth reading.

## The blind spot, and why it is disclosed

`GET /pulls/:id` **deletes and re-inserts every `pr_files` row on each request**
(`server/INSIGHTS.md`, 2026-08-06). So a PR has file rows only once somebody
opened its detail page. A merged PR nobody clicked is invisible to this query.

Left silent, an empty list would read as "nothing has touched these files" when
the truth is "we have not looked at most of them". That is precisely the
confusion `BlastStatus` exists to prevent on the map above it, so the same
discipline applies here:

The response carries **`uncomparable_prs`** — how many other PRs in this repo
have no stored file rows. When non-zero the section says so in a muted line, and
the list is explicitly a lower bound. It costs one `COUNT(*)`.

Backfilling `pr_files` for every PR at import time would remove the blind spot at
the source, but it is a change to the import path costing a GitHub call per PR.
Out of scope, and recorded as the known gap.

## Contract

Added to `contracts/blast.ts` in **both** vendored copies, which must stay
byte-identical (`CLAUDE.md`: they have already drifted elsewhere).

```
PriorPrC
  number         int
  title          string
  author         string
  status         string        GitHub merge state: 'merged' | 'closed'
  overlap_count  int           UNTRUNCATED count of shared paths
  overlap_files  string[]      the shared paths, capped
  updated_at     string | null

PriorPrsResponse
  prs                PriorPrC[]   capped, ordered
  uncomparable_prs   int          PRs with no stored file rows
```

`overlap_count` is deliberately the untruncated total while `overlap_files` is
capped: a PR overlapping forty files should say "40" and ship five paths, not
ship forty strings or claim five.

Caps live in `modules/blast/constants.ts`: **10** PRs, **5** paths per PR.

## Endpoint

`GET /pulls/:id/prior-prs` → `PriorPrsResponse`. 404 on an unknown or foreign
PR, matching `GET /pulls/:id/blast`. Never calls a model. Never calls GitHub.

It lives in the **`blast` module**, with three alternatives considered:

- **A new `modules/prior-prs/`** — cleanest domain separation, but a whole
  module (routes + service + ports + container wiring) for one read.
- **Extending `GET /pulls/:id/blast`** — rejected. Every blast render would pay
  for the query, and that response is serialised into the summary model's
  prompt, so prior PRs would leak into a call with no use for them.
- **The `blast` module** — chosen. It is the PR-scoped module already built to
  the current layering rules, and its `BlastStorePort` already reads `pr_files`
  through `reviewRepo`; this adds two methods to a port that exists.

## Layering

Onion, per the `onion-architecture` skill:

| File | Ring | Change |
|---|---|---|
| `vendor/shared/contracts/blast.ts` ×2 | ports (contract) | add the two schemas |
| `modules/blast/routes.ts` | driving adapter | add the GET |
| `modules/blast/service.ts` | application | add the use case |
| `modules/blast/ports.ts` | ports | extend `BlastStorePort` |
| `modules/blast/helpers.ts` | domain (pure) | row → wire mapping |
| `modules/blast/constants.ts` | domain | the two caps |
| `modules/reviews/repository/pull.repo.ts` | driven adapter | the two queries |
| `modules/reviews/repository.ts` | driven adapter | facade methods |
| `platform/container.ts` | composition root | wire the closures |

The port shape is declared **structurally** in `ports.ts` — no `$inferSelect`
row alias crosses the boundary (law 3), and no module imports another module's
repository (law 4): the queries are reached through `container.reviewRepo`,
exactly as `getPrFilePaths` already is.

`pnpm arch:check` must stay green. The frozen baseline may not be regenerated.

## The query

One grouped join, no N+1:

```
FROM pr_files JOIN pull_requests ON pr_files.pr_id = pull_requests.id
WHERE  workspace_id = ?            -- scoping is load-bearing, not a shortcut
  AND  repo_id      = ?
  AND  id          <> ?            -- not this PR
  AND  status IN ('merged','closed')
  AND  pr_files.path IN (this PR's paths)
GROUP BY pull_requests.id
ORDER BY count(distinct path) DESC, updated_at DESC
LIMIT 10
```

`count(distinct path)` and `array_agg(distinct path)` do the aggregation in
Postgres. Grouping by the primary key lets the other `pull_requests` columns be
selected without listing each in `GROUP BY` (functional dependency).

`status` genuinely holds GitHub's merge state — the review status
(`needs_review` / `reviewed` / `stale`) is derived at read time in
`modules/pulls/status.ts` and never stored. The filter is an **allowlist**, so a
row carrying the schema's `needs_review` default is excluded rather than
mistaken for history.

When this PR has no stored paths the service short-circuits to an empty list and
never runs the join — the same shape as `computeMap`'s no-files guard, and it
avoids `path IN ()`.

## States

| State | Renders |
|---|---|
| Loading | A small skeleton line. The section never blocks the map above it |
| Error | A muted inline line. **The blast card renders untouched** |
| Empty, `uncomparable_prs = 0` | "No earlier PRs have touched these files" — a real measurement |
| Empty, `uncomparable_prs > 0` | The lower-bound disclosure, and no all-clear claim |
| Populated | Up to 10 rows, each linking to the PR on GitHub |

Two decisions worth stating outright:

1. **The section renders even when the blast map is `degraded`.** Prior PRs come
   from `pr_files` and touch no code index, so they are just as accurate when the
   index is unusable. `BlastCard` returns early on `degraded` today; that branch
   gains the section.
2. **A failed prior-PRs read must never take the card down.** It is a secondary
   read beside the map; its failure is an inline line, never a card-level error
   state and never a retry that re-reads the map.

The section therefore renders in exactly three of the card's branches — `ok`,
`partial` and `degraded` — and in **neither** the loading nor the load-error
branch. Those two describe the card as a whole: the first has no footprint to
hang a section under, and the second is already telling the user the read failed,
where a second, differently-sourced list beside it would only confuse which read
broke.

Each row links to the PR on GitHub via the existing `githubPrUrl` helper, and
renders as plain text when `repoFullName` is null — the same rule every other
link on this card follows (`client/specs/finding-deep-links.md`).

## On a seeded database this is empty

`src/db/seed.ts` creates **one** PR, with `status: 'needs_review'`. So a seeded
dev database has no second PR to compare against and none with a merge state:
the section renders its empty state, correctly. This is expected, not a
regression — worth knowing before someone runs `pnpm dev` and files a bug.

It also means the integration test must insert its **own** fixture PRs rather
than leaning on the seed.

## Testing

**Server, hermetic** (`test/blast-prior-prs.test.ts` — not `.it.`, so it runs in
the fast lane; the filename is what decides the lane, `INSIGHTS.md` 2026-08-06):
the service against a stubbed store — the empty-paths short-circuit, the caps,
`overlap_count` staying untruncated while `overlap_files` is capped, and 404 on
an unknown PR.

**Server, integration** (`test/blast-prior-prs.it.test.ts`): the real SQL, which
is the part that can only be wrong against Postgres — grouping, the distinct
counts, the ordering, the merged/closed allowlist, workspace scoping, and
`uncomparable_prs`. Fixtures are inserted by the test.

**Client**: the four states, the SHA-pinned/plain-text link rule, and that a
failed prior-PRs read leaves the map rendered.

## Acceptance

- [ ] `GET /pulls/:id/prior-prs` returns merged/closed PRs sharing ≥1 path,
      most-overlap first, capped at 10
- [ ] `overlap_count` is the true total; `overlap_files` is capped at 5
- [ ] `uncomparable_prs` counts same-repo PRs with no `pr_files` rows
- [ ] 404 on a PR in another workspace, like every other PR-scoped route
- [ ] Contract identical in both `@devdigest/shared` copies
- [ ] `cd server && pnpm arch:check` green, baseline unchanged
- [ ] The section renders on a `degraded` map
- [ ] A failed prior-PRs read leaves the blast map rendered
- [ ] Empty state distinguishes "nothing touched these" from "we could not look"
- [ ] `cd server && pnpm typecheck && pnpm test` pass
- [ ] `cd client && pnpm typecheck && pnpm test` pass
