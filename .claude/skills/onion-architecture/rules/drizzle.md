# Drizzle — repositories, transactions, row leaks

`SKILL.md` puts Drizzle in the driven-adapter ring: `repository.ts` and `db/`
only. This file is that boundary in detail — what a repository owns, what may
not leave it, and the two places this codebase already carves out an
exception on purpose.

For query and schema mechanics, see the `drizzle-orm-patterns` and
`postgresql-table-design` skills. This file is only about placement.

## The repository is the only place that knows SQL for its domain

If a file outside `modules/<m>/repository.ts` imports `drizzle-orm` or
`db/schema.ts`, that is the violation `routes-no-persistence` and
`core-no-persistence` exist to catch — see `rules/layers.md` for the exact
rows. A second file that also builds queries for the same table is a second
place that can get the `workspaceId` scoping wrong.

## Rows do not leak

The `$inferSelect` row aliases —
[`AgentRow`, `AgentVersionRow`, `FindingRow`, `PullRow`, `AgentRunRow`](../../../../server/src/db/rows.ts)
in `db/rows.ts`, plus `ReviewRow`, which is declared in
[`modules/reviews/repository.ts`](../../../../server/src/modules/reviews/repository.ts)
rather than `db/rows.ts` —
may appear inside the module that owns them: a repository method can return
one, and a service can hold one on its way to being mapped. What they must not
do is appear in a signature a route consumes, or cross into another module.
Map at the repository/service boundary with `helpers.ts`, the way
`toAgentDto` (`modules/agents/helpers.ts`) turns an `AgentRow` into the
`Agent` DTO, and `reviewToDto` (`modules/reviews/helpers.ts`) does the
equivalent for a review. A route should never need to know that `AgentRow`
exists.

## Transactions stay inside the repository

A `tx` handle is never a service parameter — a service that takes one has
taken a Drizzle type into the core, which is exactly what `core-no-sdk`
forbids. When a single use-case must span two repositories atomically, the
composition root passes a Unit-of-Work callback instead of handing either
repository's transaction object outward; see the Sentry "Atomic Repositories
in Clean Architecture and TypeScript" article linked from `references.md` for
the shape of that callback.

## Migrations

Migrations are **not applied on boot** — run `cd server && pnpm db:migrate`;
a `relation ... does not exist` error is that, not a schema bug. Never
hand-edit an applied migration under
[`src/db/migrations/`](../../../../server/src/db/migrations/); change
`src/db/schema/*.ts` and run `pnpm db:generate` instead. Never run
`docker compose down -v` — it drops `devdigest_pgdata` along with every
imported repo and review. All three are stated in the root
[`CLAUDE.md`](../../../../CLAUDE.md); this file just points at where they bite
a repository author specifically.

## The facade pattern is legitimate

[`modules/reviews/repository.ts`](../../../../server/src/modules/reviews/repository.ts)
is a deliberate facade: `ReviewRepository` composes the query implementations
colocated under `repository/review.repo.ts`, `repository/run.repo.ts`, and
`repository/pull.repo.ts`, so its public API stays a single class while the
underlying queries are split by aggregate (review+findings, agent runs,
pull/intent). Both the facade and the split files are meant to exist — this
is not a half-finished refactor. Reach for the same split when a domain's
repository outgrows one file; don't flatten it back to a single file, and
don't take the split as license to let a second module import
`repository/*.repo.ts` directly instead of the facade.

## `db/client.ts` is exempt, and the exemption has a hole

`core-no-persistence` forbids a core file importing anything under
`src/db/` except
[`db/client.ts`](../../../../server/src/db/client.ts). The exemption exists for
the `Db` type (`PostgresJsDatabase<typeof schema>`) — the type a repository
constructor takes, not a live query surface.

But `db/client.ts` does not export only that type. It exports three things:

```ts
export type Db = PostgresJsDatabase<typeof schema>;
export interface DbHandle { db: Db; sql: postgres.Sql; close: () => Promise<void> }
export function createDb(databaseUrl: string, opts?: { max?: number }): DbHandle
```

`createDb` is a runtime factory that calls `postgres(databaseUrl, …)` and opens
a real connection pool. Because the rule exempts the file by path
(`pathNot: '^src/db/client\\.ts$'`), a `service.ts` can write
`import { createDb } from '../../db/client.js'`, connect to the database from
inside the core, and `pnpm arch:check` stays green. **This is a gap in the gate,
not a limitation of type-level analysis** — describing it as "the gate cannot see
a type" is wrong, and would leave a reader thinking the hole is narrower than it
is.

So the exemption's real cost: `core-no-persistence` protects you from
`db/schema.ts` and `db/rows.ts`, and protects you from nothing in
`db/client.ts`. Treat "no database access from the core" as a rule you keep
yourself there, and check it in review.

The proper fix is to move `export type Db` into its own type-only file and point
the `pathNot` at that instead, leaving `createDb` behind the general
`^src/db/` ban. That means editing `server/src`, so it is a follow-up rather than
something this skill does; until it happens, the hole is real and worth knowing
about. See `rules/layers.md` for the exemption's rationale.

## Related

- [`rules/layers.md`](layers.md) — the `repository.ts` import row and the
  `core-no-persistence` / `routes-no-persistence` rules.
- [`rules/fastify.md`](fastify.md) — the four route files that query Drizzle
  directly today; don't add a fifth.
- [`rules/di-container.md`](di-container.md) — how a repository gets wired
  into a service's `Deps` instead of the service constructing it.
