# Making `index_stale` Mean Something — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the blast card's `index_stale` warning fire only when the indexed
commit is dated before the PR was opened, instead of on every pull request.

**Architecture:** The indexer starts recording the **commit date** of the sha it
indexed (`repo_index_state.last_indexed_at`). `toWire` compares that against the
existing `pull_requests.opened_at`. Because a PR's base commit always predates
the PR being opened, `indexed ≥ opened` *proves* the index covers the fork point
— so silence is earned rather than guessed. Either value missing → no warning.

**Tech Stack:** Drizzle over Postgres, `simple-git`, Fastify 5, vitest
(+ testcontainers for the DB lane); Next.js 15 / React 19 / next-intl on the client.

**Spec:** [`docs/superpowers/specs/2026-08-10-index-staleness-design.md`](../specs/2026-08-10-index-staleness-design.md)

## Global Constraints

- **Package managers differ.** `server/` and `client/` are **pnpm**. Never `npm install` in either.
- **Migrations are generated, never hand-written.** Edit `src/db/schema/*.ts`, then `pnpm db:migrate` after generating. Never edit an applied migration. Never `docker compose down -v`.
- **`pnpm db:generate` blocks on an interactive prompt** when one migration both drops and adds columns to the same table (`server/INSIGHTS.md`, 2026-08-03). This change only **adds** a column, so no prompt — but if one appears, stop and ask rather than hand-writing SQL.
- **Onion layering is gated.** `cd server && pnpm arch:check` must stay green and `.dependency-cruiser-known-violations.json` must **not** be regenerated. A service may not import `drizzle-orm` or `db/schema.js`.
- **Server test lane is decided by FILENAME.** `*.it.test.ts` is the Docker lane and is excluded from the fast lane by glob. A hermetic case placed in an `.it.test.ts` file never runs in `pnpm test`'s fast lane (`server/INSIGHTS.md`, 2026-08-06).
- **A testcontainers fixture must be owned by ONE outer `describe`.** An `afterAll` inside a sibling `describe` fires before the next describe's tests, handing them a closed pool — every request then 500s with `write CONNECTION_ENDED` (`server/INSIGHTS.md`, 2026-08-10).
- **`headCommittedAt` lands in `server/src/vendor/shared/adapters.ts` ONLY.** `GitClient` is a server-side adapter the client never consumes, and `adapters.ts` is already on CLAUDE.md's known-drifted list. This is the spec's recorded decision — do not copy it to the client.
- **User-facing strings go through `client/messages/en/blast.json`**, never hardcoded in JSX.
- **Client styling is inline `CSSProperties` exported as `s` from `styles.ts`** under `pulls/[number]/_components/`, not Tailwind (`client/INSIGHTS.md`, 2026-08-06).
- **Ask the user before running `git commit`.**

## File Structure

| File | Responsibility |
|---|---|
| `server/src/db/schema/repo-intel.ts` | **Modify** — `lastIndexedAt` column |
| `server/src/db/migrations/*` | **Generated** — do not hand-write |
| `server/src/vendor/shared/adapters.ts` | **Modify** — `GitClient.headCommittedAt` |
| `server/src/adapters/git/simple-git.ts` | **Modify** — the implementation |
| `server/src/adapters/mocks.ts` | **Modify** — `MockGitClient.headCommittedAt` |
| `server/src/modules/repo-intel/types.ts` | **Modify** — `IndexState.lastIndexedAt` |
| `server/src/modules/repo-intel/repository.ts` | **Modify** — persist, read, advance, backfill |
| `server/src/modules/repo-intel/service.ts` | **Modify** — synthesised degraded row |
| `server/src/modules/repo-intel/pipeline/full.ts` | **Modify** — capture the date |
| `server/src/modules/repo-intel/pipeline/incremental.ts` | **Modify** — capture + early-exit backfill |
| `server/src/modules/blast/ports.ts` | **Modify** — two nullable fields |
| `server/src/modules/blast/helpers.ts` | **Modify** — the rule |
| `server/src/modules/blast/service.ts` | **Modify** — pass `openedAt` |
| `server/src/platform/container.ts` | **Modify** — project `openedAt` |
| `server/test/blast-index-staleness.test.ts` | **Create** — the rule, hermetic |
| `server/test/blast-service.test.ts:208` | **Modify** — one test asserts the defect; see Task 2 Step 7 |
| `server/test/repo-intel-index-state.it.test.ts` | **Create** — persistence + backfill |
| `client/messages/en/blast.json` | **Modify** — `staleWarning`, reword `partialWarning` |
| `<BLAST>/BlastCard.tsx` | **Modify** — pick the string by `reason` |
| `<BLAST>/BlastCard.test.tsx` | **Modify** — two cases |
| `server/specs/blast.md`, `client/specs/blast-radius-card.md` | **Modify** — document the rule |

`<BLAST>` means `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BlastCard`.

Task order is inside-out: produce the data, then apply the rule, then render it.
Every task ends green.

---

### Task 1: Record the indexed commit's date

**Files:**
- Modify: `server/src/db/schema/repo-intel.ts`, `server/src/vendor/shared/adapters.ts`, `server/src/adapters/git/simple-git.ts`, `server/src/adapters/mocks.ts`, `server/src/modules/repo-intel/types.ts`, `server/src/modules/repo-intel/repository.ts`, `server/src/modules/repo-intel/service.ts`, `server/src/modules/repo-intel/pipeline/full.ts`, `server/src/modules/repo-intel/pipeline/incremental.ts`
- Test: `server/test/repo-intel-index-state.it.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  // vendor/shared/adapters.ts, on GitClient:
  headCommittedAt(repo: RepoRef): Promise<Date | null>;

  // repo-intel/types.ts, on IndexState:
  lastIndexedAt: Date | null;

  // repo-intel/repository.ts, on IndexStateUpsert:
  lastIndexedAt: Date | null;
  // and on RepoIntelRepository:
  advanceSha(repoId: string, sha: string, committedAt: Date | null): Promise<void>;
  backfillIndexedAt(repoId: string, committedAt: Date): Promise<void>;
  ```

**Behaviour contract:**

| Unit | Contract |
|---|---|
| `GitClient.headCommittedAt` | Commit date of the clone's `HEAD` (`git log -1 --format=%cI HEAD`), parsed to a `Date`. Resolves `null` on any failure — never throws. The indexed commit **is** the clone's HEAD, so it is present even at `CLONE_DEPTH = 1`. |
| `repoIndexState.lastIndexedAt` | Nullable `timestamp with timezone`, column `last_indexed_at`. The **commit date** of `lastIndexedSha` — distinct from the row's `updatedAt`, which is a write time. No backfill in the migration. |
| `upsertIndexState` | Writes `lastIndexedAt` on both the insert and the `onConflictDoUpdate` set, alongside `lastIndexedSha`. The two always move together. |
| `tryGetIndexState` | Returns `lastIndexedAt: row.lastIndexedAt` (already `Date \| null` from Drizzle). |
| `advanceSha` | Takes the commit date as a third argument and writes it with the sha. Existing call site in `incremental.ts` passes the newly-read date. |
| `backfillIndexedAt` | **Only** sets `last_indexed_at` where it `IS NULL` — a single guarded `UPDATE`. Idempotent: a commit's date never changes, so re-running is a no-op. |
| `service.getIndexState` fallback | The synthesised degraded row (`service.ts:192`) gains `lastIndexedAt: null`. |
| `full.ts` | A `safeHeadCommittedAt(container, ref)` helper mirroring the existing `safeCurrentHead` — returns `null` on failure. Its value flows into every `upsertIndexState` / `safePersist` call in the file, beside `currentSha`. |
| `incremental.ts` early exit | **The hole the spec calls out.** At `incremental.ts:97`, when `currentSha === state.lastIndexedSha`, the run exits after `touchIndexState`. It must now ALSO: if `state.lastIndexedAt == null`, read the head commit date and call `backfillIndexedAt`. Without this a repo whose default branch never moves keeps `last_indexed_at = null` forever and stays permanently silent — exactly the repos most likely to be stale. |

- [ ] **Step 1: Write the failing integration test**

Create `server/test/repo-intel-index-state.it.test.ts`. One outer `d(...)` owning
`beforeAll`/`afterAll` (see Global Constraints). Insert a workspace + repo, then
assert:

```ts
it('round-trips the indexed commit date', async () => {
  const at = new Date('2026-08-01T10:00:00Z');
  await repo.upsertIndexState({
    repoId, lastIndexedSha: 'sha-1', lastIndexedAt: at,
    indexerVersion: 1, status: 'full', filesIndexed: 3, filesSkipped: 0, stats: {},
  });
  const state = await repo.tryGetIndexState(repoId);
  expect(state!.lastIndexedAt?.toISOString()).toBe('2026-08-01T10:00:00.000Z');
});

it('advances the sha and its date together', async () => {
  const at = new Date('2026-08-02T10:00:00Z');
  await repo.advanceSha(repoId, 'sha-2', at);
  const state = await repo.tryGetIndexState(repoId);
  expect(state!.lastIndexedSha).toBe('sha-2');
  expect(state!.lastIndexedAt?.toISOString()).toBe('2026-08-02T10:00:00.000Z');
});

it('backfills only a null date, and never overwrites a real one', async () => {
  // The early-exit repair: idempotent, because a commit's date never changes.
  await repo.upsertIndexState({
    repoId, lastIndexedSha: 'sha-3', lastIndexedAt: null,
    indexerVersion: 1, status: 'full', filesIndexed: 3, filesSkipped: 0, stats: {},
  });
  await repo.backfillIndexedAt(repoId, new Date('2026-08-03T10:00:00Z'));
  expect((await repo.tryGetIndexState(repoId))!.lastIndexedAt?.toISOString())
    .toBe('2026-08-03T10:00:00.000Z');

  // A second call must not move it.
  await repo.backfillIndexedAt(repoId, new Date('2026-08-09T10:00:00Z'));
  expect((await repo.tryGetIndexState(repoId))!.lastIndexedAt?.toISOString())
    .toBe('2026-08-03T10:00:00.000Z');
});

it('reads null when the indexer never recorded a date', async () => {
  await repo.upsertIndexState({
    repoId, lastIndexedSha: 'sha-4', lastIndexedAt: null,
    indexerVersion: 1, status: 'full', filesIndexed: 0, filesSkipped: 0, stats: {},
  });
  expect((await repo.tryGetIndexState(repoId))!.lastIndexedAt).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd server && pnpm exec vitest run test/repo-intel-index-state.it.test.ts
```

Expected: FAIL — `last_indexed_at` does not exist. (Needs Docker.)

- [ ] **Step 3: Add the column and generate the migration**

Add `lastIndexedAt` to `repoIndexState` in `src/db/schema/repo-intel.ts` as a
nullable `timestamp('last_indexed_at', { withTimezone: true })`, documented as
the commit date of `lastIndexedSha` — **not** a write time. Then:

```bash
cd server && pnpm db:generate && pnpm db:migrate
```

Adding a column alone raises no drizzle-kit prompt. Commit the generated SQL.

- [ ] **Step 4: Extend the adapter contract and both implementations**

`GitClient.headCommittedAt` in `src/vendor/shared/adapters.ts` (server copy only
— see Global Constraints), the `simple-git` implementation, and
`MockGitClient.headCommittedAt`. The mock returns a fixed date so tests are
deterministic; give it a `MockGitOptions.headCommittedAt` override beside the
existing `head` option, defaulting to a constant.

- [ ] **Step 5: Thread it through repo-intel**

`IndexState.lastIndexedAt`, `IndexStateUpsert.lastIndexedAt`, the
`upsertIndexState` insert + conflict set, `tryGetIndexState`'s returned object,
`advanceSha`'s new third argument, the new `backfillIndexedAt`, and the
synthesised degraded row in `service.ts`. Follow the behaviour contract table above.

- [ ] **Step 6: Capture the date in both pipelines**

`full.ts` gains `safeHeadCommittedAt` beside `safeCurrentHead` and passes its
value to every persist call. `incremental.ts` passes it to `advanceSha`, **and**
implements the early-exit backfill described in the contract table.

- [ ] **Step 7: Run the integration test**

```bash
cd server && pnpm exec vitest run test/repo-intel-index-state.it.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 8: Verify the package**

```bash
cd server && pnpm typecheck && pnpm arch:check && pnpm exec vitest run --exclude '**/*.it.test.ts'
```

Expected: all green, baseline unchanged. The blast rule has not changed yet, so
every existing blast test still passes.

- [ ] **Step 9: Commit** (ask the user first)

```
feat(repo-intel): record the commit date of the indexed sha

Stored beside last_indexed_sha because the row's updated_at is a write
time, not a fact about the code — ordering an index against a pull request
needs the latter. The incremental early-exit path backfills a null value
even when the sha has not moved: without it a repo whose default branch
never advances would keep the column null forever.
```

---

### Task 2: Apply the rule

**Files:**
- Modify: `server/src/modules/blast/ports.ts`, `server/src/modules/blast/helpers.ts`, `server/src/modules/blast/service.ts`, `server/src/platform/container.ts`
- Test: `server/test/blast-index-staleness.test.ts` (create — hermetic, **no** `.it.`)
- Test: `server/test/blast-service.test.ts` (modify — one existing test asserts the defect)

**Interfaces:**
- Consumes: `IndexState.lastIndexedAt` (Task 1).
- Produces:
  ```ts
  // blast/ports.ts:
  interface IndexStateShape { status: string; lastIndexedSha: string; lastIndexedAt: Date | null }
  interface BlastPullHead { id: string; repoId: string; headSha: string; openedAt: Date | null }

  // blast/helpers.ts:
  export function toWire(
    result: BlastResultShape,
    state: IndexStateShape,
    headSha: string,
    summary: string | null,
    openedAt: Date | null,
  ): BlastRadiusResponse;
  ```

**The rule**, replacing the `state.lastIndexedSha !== headSha` branch:

```ts
state.lastIndexedAt != null && openedAt != null && state.lastIndexedAt < openedAt
```

`state.status === 'partial'` keeps precedence over it, and a `degraded` facade
result still short-circuits ahead of both. `lastIndexedSha` stays on the shape —
it is still what the incremental indexer diffs against — it simply stops driving
this status.

- [ ] **Step 1: Write the failing hermetic test**

Create `server/test/blast-index-staleness.test.ts` — the filename carries **no**
`.it.`, so it runs in the fast lane. Drive `toWire` directly; it is pure.

```ts
const HEAD = 'head-sha';
const OTHER = 'indexed-sha';
const OK_RESULT = {
  changedSymbols: [], callers: [], impactedEndpoints: [], impactedCrons: [],
};
const wire = (lastIndexedAt: Date | null, openedAt: Date | null, status = 'full') =>
  toWire(OK_RESULT, { status, lastIndexedSha: OTHER, lastIndexedAt }, HEAD, null, openedAt);

const AUG_01 = new Date('2026-08-01T00:00:00Z');
const AUG_09 = new Date('2026-08-09T00:00:00Z');

it('is ok when the index is dated at or after the PR was opened', () => {
  // base <= opened <= indexed, so the index provably covers the fork point.
  const out = wire(AUG_09, AUG_01);
  expect(out.status).toBe('ok');
  expect(out.reason).toBeNull();
});

it('warns when the index predates the PR being opened', () => {
  const out = wire(AUG_01, AUG_09);
  expect(out.status).toBe('partial');
  expect(out.reason).toBe(BLAST_REASON.indexStale);
});

it('THE DEFECT: a fresh index is ok even though its sha differs from the PR head', () => {
  // This is the whole point. `lastIndexedSha` is the default branch and
  // `headSha` is the PR branch, so they differ for every open PR — the old
  // rule made that alone `partial`, on every single pull request.
  const out = wire(AUG_09, AUG_01);
  expect(out.head_sha).toBe(HEAD);
  expect(out.status).toBe('ok');
});

it('says nothing when the index has no recorded date', () => {
  expect(wire(null, AUG_01).status).toBe('ok');
});

it('says nothing when the PR has no opened_at', () => {
  expect(wire(AUG_01, null).status).toBe('ok');
});

it('a partial index still wins over a fresh date', () => {
  const out = wire(AUG_09, AUG_01, 'partial');
  expect(out.status).toBe('partial');
  expect(out.reason).toBe(BLAST_REASON.indexPartial);
});

it('a degraded facade result short-circuits ahead of everything', () => {
  const out = toWire(
    { ...OK_RESULT, degraded: true, reason: 'no_data' },
    { status: 'full', lastIndexedSha: OTHER, lastIndexedAt: AUG_09 },
    HEAD, null, AUG_01,
  );
  expect(out.status).toBe('degraded');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd server && pnpm exec vitest run test/blast-index-staleness.test.ts
```

Expected: FAIL — `toWire` takes four arguments, and the ok-case is `partial`.

- [ ] **Step 3: Extend the ports**

Add `lastIndexedAt: Date | null` to `IndexStateShape` and `openedAt: Date | null`
to `BlastPullHead`, each with a comment saying why it is there. Both stay
structural mirrors — no import from repo-intel, no row alias.

- [ ] **Step 4: Implement the rule**

Replace the sha-inequality branch in `toWire` with the rule above. Document the
asymmetry in the code: `indexed ≥ opened` **proves** freshness, while
`indexed < opened` only says the index *may* miss base work — which is why the
copy says "may".

- [ ] **Step 5: Pass `openedAt` through the service**

`computeMap` already receives the `BlastPullHead`, so it hands `pull.openedAt` to
`toWire`. No signature change to `get` or `summarize`.

- [ ] **Step 6: Wire the container**

The `store.getPull` closure projects `openedAt: pull.openedAt` alongside the
three fields it already picks. The `intel.indexState` closure needs no change —
`IndexState` structurally satisfies `IndexStateShape` once Task 1 added the field.

- [ ] **Step 7: Run the test and the package**

```bash
cd server && pnpm exec vitest run test/blast-index-staleness.test.ts
cd server && pnpm typecheck && pnpm arch:check && pnpm exec vitest run --exclude '**/*.it.test.ts'
```

Expected: 7 new tests pass; fast lane green with its file count up by one; gate
green with the baseline unchanged.

**One existing test WILL fail, and it is the defect written down as an
assertion:** `test/blast-service.test.ts:208`, named *"an index built at another
commit is partial/index_stale"*. That is precisely the behaviour being removed —
an index at a different commit is no longer `partial` on its own. Rewrite it to
the new rule; do not weaken the rule to keep it green. Its replacement should
assert the same fixture is now `ok` when the index post-dates `openedAt`, and
`partial`/`index_stale` only when it pre-dates it. Check whether that file's
`BlastService` fixture supplies `openedAt` and `lastIndexedAt` at all — it will
need both.

`test/contracts.test.ts:223` also mentions `index_stale`, but only as a wire-shape
fixture; it asserts nothing about derivation and should stay untouched.

- [ ] **Step 8: Commit** (ask the user first)

```
fix(blast): stop warning that the index is stale on every PR

The status derivation compared lastIndexedSha — the clone's default-branch
HEAD — against the PR's headSha. Those differ by definition for any open
PR, so index_stale fired on all of them, permanently, and re-indexing could
not clear it. A warning that always fires carries no information.

Exact ancestry is unavailable here: GitClient has no merge-base, the read
path makes no git calls, and clones are shallow, so a PR's base commit is
frequently not in the clone. Instead this leans on the one fact shallow
clones cannot break — a PR's base commit always predates the PR being
opened — so an index dated at or after opened_at provably covers the fork
point. That direction is exact; the other only claims callers MAY be
missing, which is what the copy already said.
```

---

### Task 3: Say the right thing on the card

**Files:**
- Modify: `client/messages/en/blast.json`, `<BLAST>/BlastCard.tsx`
- Test: `<BLAST>/BlastCard.test.tsx`

**Interfaces:**
- Consumes: the server's `reason` values — `index_stale`, `index_partial`.
- Produces: no new exports. `BlastCard` keeps its props.

`index_partial` and `index_stale` no longer mean similar things, so one string
with a `{reason}` placeholder can no longer serve both.

| Key | Copy |
|---|---|
| `partialWarning` (reword) | `The index is incomplete ({reason}) — some callers may be missing.` |
| `staleWarning` (new) | `This repo was last indexed before this PR was opened, so some callers may be missing.` |

The existing `partialWarning` text — *"The index is incomplete or behind this PR
({reason})"* — loses "or behind this PR", which is now `staleWarning`'s job.

- [ ] **Step 1: Write the failing tests**

Add to `<BLAST>/BlastCard.test.tsx`, using the existing `stubFetch` helper:

```tsx
it("names the PR when the index predates it", async () => {
  stubFetch(200, { ...OK_MAP, status: "partial", reason: "index_stale" });
  renderCard(card());

  expect(await screen.findByText(/last indexed before this PR was opened/i))
    .toBeInTheDocument();
  // The tree still renders — `partial` was always served WITH its data.
  expect(screen.getByText("rateLimit()")).toBeInTheDocument();
});

it("keeps the incomplete-index wording distinct from the stale one", async () => {
  stubFetch(200, { ...OK_MAP, status: "partial", reason: "index_partial" });
  renderCard(card());

  expect(await screen.findByText(/index is incomplete/i)).toBeInTheDocument();
  expect(screen.queryByText(/last indexed before this PR/i)).not.toBeInTheDocument();
});
```

The pre-existing case `"partial still renders the tree, with a warning above it"`
asserts `/some callers may be missing/i` and uses `reason: "index_stale"` — both
strings still end with that phrase, so it keeps passing either way. Leave it alone.

- [ ] **Step 2: Run them and watch them fail**

```bash
cd client && pnpm exec vitest run "src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BlastCard/BlastCard.test.tsx"
```

Expected: FAIL — the stale wording is not in the document.

- [ ] **Step 3: Add the copy**

Reword `partialWarning` and add `staleWarning` in `client/messages/en/blast.json`,
per the table above.

- [ ] **Step 4: Pick the string by reason**

In `BlastCard.tsx`'s `partial` branch, select `staleWarning` when
`data.reason === "index_stale"` and `partialWarning` otherwise. Keep it a plain
conditional in the JSX — this is one branch, not a lookup table. `staleWarning`
takes no `{reason}` argument; `partialWarning` still does.

- [ ] **Step 5: Run the card suite and the package**

```bash
cd client && pnpm exec vitest run "src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BlastCard/BlastCard.test.tsx"
cd client && pnpm typecheck && pnpm test
```

Expected: the two new cases plus every pre-existing one; typecheck clean; whole
client suite green.

- [ ] **Step 6: Commit** (ask the user first)

```
feat(client): distinguish an incomplete index from a stale one

index_partial and index_stale stopped meaning similar things when the
staleness rule changed, so one string with a {reason} placeholder can no
longer serve both. The stale copy now names the actual condition — the repo
was last indexed before this PR was opened — instead of asserting the index
is "behind this PR", which was true of every PR by construction.
```

---

### Task 4: Document it and verify the whole

**Files:**
- Modify: `server/specs/blast.md`, `client/specs/blast-radius-card.md`

- [ ] **Step 1: Read the folders' READMEs**

```bash
cat server/specs/README.md
cat client/specs/README.md
```

Follow what each states belongs in it. `server/specs/prior-prs.md` is the closest
recent neighbour in shape.

- [ ] **Step 2: Update `server/specs/blast.md`**

Cover, with `file:line` evidence for every behavioural claim:

- **The rule** — `lastIndexedAt < openedAt`, and the precedence order
  (`degraded` → `state.status === 'partial'` → freshness).
- **Why it is sound one way only** — base ≤ opened makes `indexed ≥ opened`
  a *proof* of freshness; the other direction may false-positive on a
  long-lived branch opened late, which is why the copy says "may".
- **Why not ancestry** — no `mergeBase` on `GitClient`, no git call on the read
  path, and `CLONE_DEPTH = 1` with a `--depth 50` resync, so a base commit is
  frequently absent from the clone.
- **Degradation** — either value null → no warning; and the explicit consequence
  that on first deploy every PR reads clean until the next reindex.
- **The early-exit repair** — why `incremental.ts` backfills a null date even
  when the sha has not moved.
- **Supersede the old claim** — mark the previous `index_stale` description as
  superseded rather than deleting it, per the specs README convention.

- [ ] **Step 3: Update `client/specs/blast-radius-card.md`**

Update the `partial` row of §2's state table to name the two distinct reasons and
their two distinct strings, and add acceptance rows for the two new tests. Note
in §6 (Known gaps) that a long-lived branch opened late can still warn when its
base is in fact covered.

- [ ] **Step 4: Verify both packages**

```bash
cd server && pnpm typecheck && pnpm arch:check && pnpm exec vitest run --exclude '**/*.it.test.ts'
cd server && pnpm exec vitest run test/repo-intel-index-state.it.test.ts test/blast-routes.it.test.ts
cd ../client && pnpm typecheck && pnpm test
```

Expected: all green, the gate's baseline unchanged.

- [ ] **Step 5: Confirm the contract copies did not drift**

```bash
cd d:/Projects/neo/dev-digest
diff server/src/vendor/shared/contracts/blast.ts client/src/vendor/shared/contracts/blast.ts && echo IN_SYNC
```

Expected: `IN_SYNC`. `adapters.ts` is deliberately **not** compared — see Global
Constraints.

- [ ] **Step 6: Record any insight**

If this task surfaced something non-obvious, durable and actionable cold, invoke
the `engineering-insights` skill. The strongest candidate is already known and
worth recording if not present: a status derived from comparing an index sha to a
PR head sha is structurally always-true, and the seed masked it by rigging
`lastIndexedSha` to the seeded PR's head. Do not record what the code says.

- [ ] **Step 7: Commit** (ask the user first)

```
docs(specs): record how index staleness is actually decided

Marks the old sha-comparison description superseded rather than deleting
it: seeing what was believed, and when, is most of the value once something
turns out to be wrong. States the asymmetry plainly — one direction is a
proof, the other is a "may" — so the next reader does not mistake the rule
for exact in both directions.
```

---

## Self-Review

**Spec coverage** — every section of the design maps to a task:

| Spec section | Task |
|---|---|
| The problem / why the old rule always fires | 2 (the rule + its regression test) |
| What we cannot do (ancestry, shallow clones) | 4 (documented); no code |
| The rule + soundness asymmetry | 2 |
| Worked examples table | 2 (one test per row) |
| Changes: schema, adapter, mocks, indexer, repo-intel | 1 |
| Changes: blast ports/helpers/service, container | 2 |
| Changes: client copy + card | 3 |
| The early-exit hole | 1 (contract table + backfill test) |
| Vendor-copy asymmetry | Global Constraints |
| Degradation (null → ok, no backfill) | 2 (two null tests), 4 (documented) |
| Testing (hermetic rule, regression guard, `.it`, client) | 1, 2, 3 |
| Acceptance 1–9 | 1 (8), 2 (1–7), 4 (9) |

**Placeholder scan** — no TBDs. Every code step carries either the actual test
code or an exact behaviour contract with names and types. Per the standing
preference, implementations are specified as contracts rather than transcribed;
the tests are given verbatim because the tests *are* the contract.

**Type consistency** — `lastIndexedAt: Date | null` is the same name and type in
`repoIndexState` (Task 1), `IndexState` (Task 1), `IndexStateUpsert` (Task 1) and
`IndexStateShape` (Task 2). `openedAt: Date | null` matches `pull_requests.openedAt`,
which is already nullable. `advanceSha(repoId, sha, committedAt)` is defined in
Task 1 and its only caller is updated in the same task. `toWire`'s fifth
parameter is added in Task 2 and its only call site — `service.computeMap` — is
updated in the same task. `backfillIndexedAt` is defined and consumed in Task 1.

**Signatures verified against the repo before writing:** `toWire(result, state,
headSha, summary)` with exactly one call site (`blast/service.ts:170`);
`advanceSha(repoId, sha)` with one call site (`incremental.ts:123`);
`IndexStateUpsert` has seven fields (`repo-intel/repository.ts:48`);
`touchIndexState` is the early-exit's current only write (`incremental.ts:98`);
`MockGitClient` implements `GitClient` structurally (`adapters/mocks.ts:254`);
`pullRequests.openedAt` is nullable (`db/schema/pulls.ts:27`);
`repoIndexState` has no date column today (`db/schema/repo-intel.ts:35`).

**One risk called out rather than hidden:** Task 2 Step 7 **will** break
`test/blast-service.test.ts:208` — a hermetic test whose name is the defect
("an index built at another commit is partial/index_stale"). The step names it,
says why, and gives the replacement, rather than leaving the implementer to
discover it and "fix" the rule to match the test.
