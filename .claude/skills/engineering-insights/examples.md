# Examples — what clears the bar and what doesn't

Calibration for [`SKILL.md`](SKILL.md). Every ✅ below is a real trap in this
codebase, so the target is concrete rather than abstract.

## The rewrite test

Most rejected entries aren't wrong — they're unactionable. Take the vague
version, ask *"what would the next session have to go find out?"*, and put the
answer in the entry.

| ❌ Too vague to act on | ✅ Actionable cold |
|---|---|
| "Promises can be tricky" | "`Promise.all()` on the ingest pipeline times out past 30 items — use `Promise.allSettled()` batched at 10 for that module." |
| "Be careful with async state" | "Checkout-flow state always goes through Zustand (`cartStore.ts`) because three components share the cart; local state doesn't work here." |
| "Migrations can be tricky" | "`relation ... does not exist` is always un-run migrations — they are **not** applied on boot. `cd server && pnpm db:migrate`." |
| "Watch out for zod errors" | "`err instanceof z.ZodError` is false across the server↔reviewer-core boundary — each package installs its own `zod`. Match by shape instead." |
| "Be careful with paths on Windows" | "CLI entrypoint checks must compare against `pathToFileURL(process.argv[1]).href`. The `` file://${argv[1]} `` template silently never matches, and the script exits 0 having done nothing." |
| "The shared package is confusing" | "`@devdigest/shared` is two physical copies — `server/src/vendor/shared/` and `client/src/vendor/shared/`. Nothing syncs them and they have already drifted; a contract change means editing both." |

Notice what the ✅ column has in common: a named symbol or file, a specific
threshold or condition, and what to do instead.

## One worked entry per section

### What works

```markdown
- **2026-07-28** — Adapter mocks for hermetic tests come from
  [`src/adapters/mocks.ts`](src/adapters/mocks.ts) — it covers every adapter the
  container resolves, so a new test rarely needs its own stub. Depend on the
  interface and inject via `ContainerOverrides`.
  (`src/adapters/mocks.ts:58`)
```

### What doesn't work

```markdown
- **2026-07-28** — The diff loader silently falls back from a real `git diff` to
  reconstructing the diff from stored `pr_files` patches, with no signal about
  which path won. A review whose diff looks truncated is usually this, not a
  model problem. (`src/modules/reviews/diff-loader.ts:27`)
```

### Codebase patterns & tool notes

```markdown
- **2026-07-28** — A test importing `test/helpers/pg.ts` must be named
  `*.it.test.ts`. The unit lane excludes that glob, so a DB-backed test under
  any other name breaks the hermetic run instead of skipping.
  (`test/helpers/pg.ts:35`)
```

### Decisions

```markdown
- **2026-07-28** — Module registration is static — one import plus one entry in
  [`src/modules/index.ts`](src/modules/index.ts) — rather than
  `@fastify/autoload`, despite the dependency being present. Reason: the same
  path has to resolve under tsx, vitest, and a bundler, and dynamic `import()`
  of `.ts` doesn't. (`src/modules/index.ts:2`)
```

### Recurring errors & fixes

```markdown
- **2026-07-28** — Every request throwing on a fresh DB means the seed never
  ran, not that auth is broken: auth resolves the current user and workspace by
  looking up the seeded row. `cd server && pnpm db:seed`.
  (`src/db/seed.ts:33`)
```

### Open questions

```markdown
- **2026-07-28** — Run cancellation lives in an in-memory `Set` in `RunBus`, so
  it doesn't survive a restart, and `reapStaleRuns()` assumes a single API
  instance per DB. Unresolved: what happens to cancellation and reaping if a
  second instance is ever run. (`src/platform/sse.ts:19`)
```

## These are not insights

Near-misses — the judgment call that goes wrong most often. Each one fails on a
specific test, not on general vagueness.

| Rejected | Why |
|---|---|
| "The server uses Fastify." | Obvious from `package.json` and every route file. Fails **non-obvious**. |
| "Fixed the migration bug in the reviews module today." | Task state. Fails **durable** — and it's a commit message. |
| "I kept typing `pnpm` in `reviewer-core`, which uses npm." | Your slip. The rule is already in `CLAUDE.md`; if it weren't, it would belong *there*, not here. |
| "Always write tests for new code." | True in any repo. Fails **non-obvious** and isn't about this codebase. |
| "The `memory` table exists in the schema." | The code says so. Fails **non-obvious**. *What's worth recording is that it has zero code references and is deliberately unused* — that part isn't visible from the schema. |
| "Something's wrong with how repo-intel degrades." | Fails **actionable cold** — the next session has to re-investigate from scratch. Either finish the investigation or file it under `Open questions` with what you actually observed. |
| "Never run `docker compose down -v`." | Already a standing rule in root `CLAUDE.md`. Improve that file if it needs sharpening; don't duplicate it here. |

The last two rows are the common failure modes: a half-finished thought filed as
an insight, and a rule copied out of a `CLAUDE.md` so it appears in two places
and drifts.
