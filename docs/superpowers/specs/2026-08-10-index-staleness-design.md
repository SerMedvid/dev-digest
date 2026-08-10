# Making `index_stale` mean something

**Date:** 2026-08-10
**Packages:** `server/`, `client/`
**Status:** approved, ready for planning

## The problem

The blast card shows this on **every** pull request:

> The index is incomplete or behind this PR (index_stale) — some callers may be
> missing.

It is derived in [`modules/blast/helpers.ts`](../../../server/src/modules/blast/helpers.ts):

```ts
} else if (state.lastIndexedSha !== headSha) {
  status = 'partial';
  reason = BLAST_REASON.indexStale;
}
```

Those two SHAs can essentially never be equal:

- `lastIndexedSha` is `git rev-parse HEAD` in the **clone**
  (`adapters/git/simple-git.ts:91`), recorded by the indexer at
  `repo-intel/pipeline/full.ts:271`. The clone sits on the repo's **default
  branch**. Indexing is enqueued on repo-add (`modules/repos/service.ts:68`);
  nothing ever checks out a PR branch.
- `headSha` is the **PR branch's** head commit.

A pull request exists precisely because its branch carries commits the default
branch does not. So the condition is true for every open PR, permanently.
Re-indexing does not clear it — it advances `lastIndexedSha` to a newer *main*
commit, still unequal to the PR head.

The seed corroborates this: `db/seed.ts:360` sets `lastIndexedSha: pr!.headSha`
with the comment *"so the card can never render as `index_stale` on a fresh
install"*. The fixture is rigged around the defect, which is why it stays
invisible until real PRs are imported.

**What is wrong is not the claim but its framing.** The underlying fact is
honest — the index reflects `main`, so symbols and callers introduced on the PR
branch genuinely are not in it. But a permanent structural property is being
reported as a transient, per-PR staleness condition. A warning that fires 100% of
the time carries no information and trains the reader to ignore it, which is
costly given `partial` is the card's only signal that the map is incomplete.

## What we cannot do, and why

Stating "the index is behind the PR's base" *precisely* means an ancestry test on
the commit graph. Three things block the direct route:

1. **`GitClient` has no ancestry method.** No `mergeBase`, no `isAncestor`
   (`vendor/shared/adapters.ts:205`). That is a new adapter contract.
2. **The blast read path makes no git calls today**, by design — `server/README.md`
   describes it as read "entirely from the persisted index".
3. **Clones are shallow, and this is fatal to ancestry.**
   `CLONE_DEPTH = 1` (`modules/repos/constants.ts:9`, "latest commit only, keeps
   imports fast") and `sync` refetches only `--depth 50`, with the comment that
   the prior indexed sha is *"usually reachable … the indexer falls back to a full
   reindex when it isn't"* (`adapters/git/simple-git.ts:81`). A PR's base commit
   is frequently absent from the clone, so `merge-base --is-ancestor` would error
   rather than answer. The repository already treats reachability as unreliable.

A related dead end worth recording: `fetchPullHead` exists
(`adapters/git/simple-git.ts:72`) but is **called nowhere in `src/`**, so PR head
commits are never fetched locally either. Any scheme comparing against `headSha`
in the clone is a non-starter for that additional reason.

Considered and rejected:

- **Unshallow the clone and do exact ancestry.** The only precise option, but
  `CLONE_DEPTH = 1` exists specifically to keep repo imports fast; this trades
  import time and disk on every repo for one warning's accuracy.
- **GitHub's `compare` API.** Answers exactly, over the network, on a read path
  that is explicitly free of GitHub calls.
- **Wall-clock timestamps** (`repo_index_state.updated_at` vs
  `pull_requests.updated_at`). Cheapest, but compares row write times rather than
  anything about the code, and misfires whenever a PR is touched (label, title)
  without its code moving.

## The rule

One fact survives shallow clones: **a PR's base commit always predates the PR
being opened.** That gives an ordering test needing no commit graph at read time.

```
index_stale  iff  lastIndexedAt != null
              &&  openedAt      != null
              &&  lastIndexedAt <  openedAt
```

where `lastIndexedAt` is the **commit date of the indexed sha** — not the index
row's `updated_at` — and `openedAt` is the existing `pull_requests.opened_at`.

### Why it is sound in the direction that matters

Because `base ≤ opened`:

- `indexed ≥ opened` ⟹ `indexed ≥ base`. The index **provably** contains the
  fork point. Silence is correct, not a guess.
- `indexed < opened` ⟹ the index **may** miss base work. This is the warning.

The asymmetry is deliberate and must not be read as precision in both directions.
The second branch can false-positive: a long-lived branch opened late may fork
from a commit the index already covers, and will still warn. That is acceptable
because the existing copy already says callers *may* be missing, and because it
self-corrects — every reindex advances `lastIndexedAt` and quiets every PR opened
before it.

What it never does is claim freshness it cannot prove, and it no longer fires
when the index is demonstrably fine. That is the whole point.

### Worked examples

| Indexed commit dated | PR opened | Verdict |
|---|---|---|
| 2026-08-09 | 2026-08-05 | `ok` — index provably covers the base |
| 2026-08-01 | 2026-08-09 | `partial` / `index_stale` — may miss base work |
| `null` (never reindexed since this shipped) | any | `ok` — see Degradation |
| any | `null` | `ok` — see Degradation |

`state.status === 'partial'` continues to win over the freshness test: an
indexer that reported its own run incomplete is a stronger statement than
anything derived here.

## Changes

| Layer | File | Change |
|---|---|---|
| Schema | `db/schema/repo-intel.ts` | `repoIndexState.lastIndexedAt` — nullable `timestamptz`, the **commit date** of `lastIndexedSha`. Generated migration; **no backfill** |
| Adapter contract | `vendor/shared/adapters.ts` | `GitClient.headCommittedAt(repo): Promise<Date \| null>` |
| Adapter | `adapters/git/simple-git.ts` | `git log -1 --format=%cI HEAD`, parsed to a `Date` |
| Mocks | `adapters/mocks.ts` | `MockGitClient.headCommittedAt` |
| Indexer | `repo-intel/pipeline/full.ts`, `incremental.ts` | Capture the date beside `currentSha`; persist it with the sha. Failure → `null`, matching `safeCurrentHead`'s posture |
| Indexer | `repo-intel/pipeline/incremental.ts` | **The early-exit path must backfill.** See "The early-exit hole" below |
| repo-intel | `repo-intel/types.ts`, `repository.ts` | `IndexState.lastIndexedAt`; persist / read it, including `advanceSha` |
| blast core | `modules/blast/ports.ts` | `IndexStateShape.lastIndexedAt: Date \| null`; `BlastPullHead.openedAt: Date \| null` |
| blast core | `modules/blast/helpers.ts` | `toWire` takes `openedAt` and applies the rule |
| blast core | `modules/blast/service.ts` | Pass `pull.openedAt` through `computeMap` |
| Root | `platform/container.ts` | Project `openedAt` onto the store's `getPull`; carry `lastIndexedAt` on the `intel.indexState` closure |
| Client | `messages/en/blast.json` | A dedicated stale string — `index_partial` and `index_stale` no longer mean similar things |
| Client | `BlastCard.tsx` | Pick the warning string by `reason` |

`BLAST_REASON.indexStale` keeps its name; only its trigger changes.

### The early-exit hole

`incremental.ts:97` returns early when `currentSha === state.lastIndexedSha` —
it touches `updated_at` and exits, because nothing moved. Left alone that would
strand the new column permanently: a repo whose default branch has not advanced
since the migration would keep `last_indexed_at = null` forever, and by the
degradation rule below would stay silent forever — including when it is
genuinely stale.

So the early-exit path must **backfill `lastIndexedAt` when it is null**, even
though the sha is unchanged. The commit date of a given sha never changes, so
this is a one-time repair and is idempotent thereafter. Without it, "until the
next reindex" in the Degradation section is false for exactly the repos most
likely to be stale.

### One deliberate asymmetry between the vendor copies

`CLAUDE.md` requires a contract change used by **both** sides to land in both
physical copies of `@devdigest/shared`. `GitClient` is a server-side adapter
interface the client never consumes, and `adapters.ts` is already on that file's
known-drifted list. `headCommittedAt` therefore lands in
`server/src/vendor/shared/adapters.ts` **only**. This is a recorded decision, not
an oversight — do not "fix" it by copying the method across.

## Degradation

Either input `null` → `ok`, no warning, no new reason code, no new UI state.

The index's own `status` already reports whether the map is trustworthy;
freshness being unknown does not make the map incomplete, and manufacturing a
warning we cannot substantiate is exactly the noise this change removes.

The consequence is explicit and accepted: **on first deploy every PR reads clean
until the next reindex populates `last_indexed_at`.** A genuinely stale index is
silent during that window. There is no backfill, because the only available proxy
(`repo_index_state.updated_at`, a row write time) is not a commit date, and
seeding the column with it would make the first window's verdicts unfalsifiable
rather than merely absent.

## Testing

The rule is pure, so the weight sits in a **hermetic** test — note the filename
must not carry `.it.`, or it is excluded from the fast lane by glob
(`server/INSIGHTS.md`, 2026-08-06).

- **`toWire` table** — indexed-after-opened → `ok`; indexed-before-opened →
  `partial` + `index_stale`; `lastIndexedAt` null → `ok`; `openedAt` null → `ok`;
  `state.status === 'partial'` still wins over a fresh index; a `degraded` facade
  result still short-circuits ahead of everything.
- **Regression guard** — a PR whose head sha differs from `lastIndexedSha`, with
  a fresh index, is `ok`. This is the defect, pinned: the old code made it
  `partial` unconditionally.
- **`.it`** — the indexer persists a non-null commit date, and it round-trips
  through `repo_index_state`; and the early-exit path backfills a null
  `last_indexed_at` on a repo whose sha has not moved.
- **Client** — the stale copy renders only in the stale branch; the existing
  `partial` case is unchanged.

## Out of scope

Exact ancestry; unshallowing clones; GitHub `compare`; backfilling
`last_indexed_at`; and indexing PR heads (which would make the map reflect the
branch under review — a much larger feature, and the only true fix for "callers
introduced by this PR are invisible").

## Acceptance

1. A repo indexed after a PR was opened shows **no** warning on that PR's blast card.
2. A repo indexed before a PR was opened shows the stale warning on it.
3. A PR whose head differs from the indexed sha, on a freshly indexed repo, shows no warning.
4. An index row with no `last_indexed_at` produces no warning.
5. A PR with no `opened_at` produces no warning.
6. `state.status === 'partial'` still warns, with `index_partial`, regardless of dates.
7. A `degraded` map is unaffected in every case.
8. A repo whose default branch has not moved since the migration gets
   `last_indexed_at` populated by the next incremental run, rather than being
   stranded null.
9. `pnpm arch:check` stays green with the frozen baseline unchanged.
