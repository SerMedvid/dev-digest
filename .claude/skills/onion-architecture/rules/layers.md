# Layers — who may import whom

`SKILL.md` states the invariant and draws the rings. This file is the lookup
table underneath it: for a given file kind, the exact set of imports that is
allowed and the exact set that is not, plus the named gate rule that will fail
if you get it wrong.

Use it the way you would use a lint rule reference — find the row for the file
you are editing, then check your import list against it.

## The matrix

| File | May import | May NOT import |
|---|---|---|
| `modules/<m>/routes.ts` | own `service.ts`, `_shared/context.ts`, `_shared/schemas.ts`, `platform/errors.ts`, `fastify`, `zod`, `@devdigest/shared` | `db/*`, `drizzle-orm`, another module's files, `adapters/*` |
| `modules/<m>/service.ts` | own `ports.ts`, `domain.ts`, `helpers.ts`, `constants.ts`, `@devdigest/shared`, `platform/errors.ts` | `platform/container.ts`, `db/*`, any vendor SDK, another module |
| `modules/<m>/ports.ts` | `@devdigest/shared`, own `domain.ts` | everything else |
| `modules/<m>/domain.ts`, `helpers.ts` | own `constants.ts`, `@devdigest/shared` | anything with I/O |
| `modules/<m>/repository.ts` | `db/client.ts`, `db/schema.ts`, `db/rows.ts`, `drizzle-orm`, own `ports.ts`, own `domain.ts` | `fastify`, another module's repository |
| `adapters/<x>/` | vendor SDK, `@devdigest/shared` | `modules/*` |
| `platform/container.ts` | everything (it is the composition root) | — |

Two rows describe files that do not exist yet in every module.
`modules/<m>/ports.ts` and `modules/<m>/domain.ts` are the shapes new work should
create; no module on disk has them today. The row tells you what they are allowed
to import once you add one — see
[`rules/di-container.md`](di-container.md) for what goes in a `ports.ts`.

`_shared` is the only cross-module common ground. Today that is
[`server/src/modules/_shared/context.ts`](../../../../server/src/modules/_shared/context.ts)
(`getContext`, workspace scoping) and
[`server/src/modules/_shared/schemas.ts`](../../../../server/src/modules/_shared/schemas.ts).
If you find yourself wanting a second shared location, that is a signal the code
belongs in `platform/` or behind a port, not that `_shared` needs a sibling.

## How to name a file's ring

Before you write the first import, answer three questions in order. The first
"yes" is the answer.

1. **Does this file touch the outside world?** A database handle, an HTTP call,
   the filesystem, a shell process, an LLM endpoint. If yes, it is a **driven
   adapter**: `modules/<m>/repository.ts` or `adapters/<x>/`. It may import the
   vendor SDK; nothing inward may import it by name.
2. **Does the outside world call into this file?** An HTTP request, an SSE
   subscription, a job the queue drains. If yes, it is a **driving adapter**:
   `modules/<m>/routes.ts`, `app.ts`, `server.ts`. It may import Fastify and
   `zod`; it may call exactly one use-case and map the result to a DTO.
3. **Neither?** It is **core**: `service.ts`, `domain.ts`, `helpers.ts`,
   `ports.ts`. It imports interfaces and plain types, and it must be testable
   with no Docker and no HTTP.

The question is about the file, not about the feature. A single module routinely
spans all three rings, and that is the point — the rings are the seams, not the
folders.

The gate's own definition of "core" is a regex in
[`server/.dependency-cruiser.cjs`](../../../../server/.dependency-cruiser.cjs):

```
^src/modules/[^/]+/(service|helpers|domain|ports)\.ts$
```

Note what is *not* in it. `routes.ts` and `repository.ts` are adapters by name,
so the core rules do not apply to them — they get their own rules instead. And a
file you invent with a new name (`orchestrator.ts`, `pipeline/full.ts`) is
invisible to the core rules no matter what it contains. Renaming your way out of
a rule is not a fix; if a file behaves like a service, name it `service.ts`.

## The gate rules that back each row

Each row above is enforced by at least one named rule. The `comment` field on
each rule in `server/.dependency-cruiser.cjs` is the authority on what it
forbids and why — read it there when a failure surprises you.

The three `core-*` rules do not divide the core between them. All three share a
single `from.path` — the `CORE` constant quoted above — so each one applies
identically to `service.ts`, `helpers.ts`, `domain.ts`, and `ports.ts`. A
`ports.ts` that imports `Container` fails `core-no-container` exactly as a
`service.ts` would; a `domain.ts` that imports `octokit` fails `core-no-sdk`.

| Rule | Enforces | Fails when |
|---|---|---|
| `core-no-container` | the `service.ts`, `helpers.ts`, `domain.ts` and `ports.ts` rows | a core file imports `src/platform/container.ts`, even as `import type` |
| `core-no-persistence` | the `service.ts`, `helpers.ts`, `domain.ts` and `ports.ts` rows | a core file imports anything under `src/db/` other than `db/client.ts` |
| `core-no-sdk` | the `service.ts`, `helpers.ts`, `domain.ts` and `ports.ts` rows | a core file reaches `drizzle-orm`, `postgres`, `fastify`, `octokit`, `simple-git`, `@anthropic-ai/*`, or `openai` |
| `routes-no-persistence` | `routes.ts` row | a route imports `src/db/*` or `drizzle-orm` |
| `no-cross-module-internals` | the "another module" column on every module row | `modules/a/*` imports `modules/b/*`, where `b` is neither `a` nor `_shared` |
| `adapters-no-modules` | `adapters/<x>/` row | anything under `src/adapters/` imports anything under `src/modules/` |
| `no-circular` | all rows | any import cycle at all; a cycle means a boundary is in the wrong place |

An eighth rule, `no-orphans`, is hygiene rather than layering: it catches files
with neither importers nor imports. Treat it as a weak dead-code signal.

Two mechanical points about the gate that change how you read a failure:

- `tsPreCompilationDeps: true` is set, so `import type { Container }` counts as a
  dependency. You cannot satisfy `core-no-container` by making the import
  type-only.
- `*.test.ts` files are excluded. Tests legitimately reach across every boundary
  to wire fakes, so a passing gate says nothing about your test imports.

Run it before you call the work done:

```
cd server && pnpm arch:check
```

## The known exceptions

`server/.dependency-cruiser-known-violations.json` freezes 24 violations that
predate the gate:

| Rule | Frozen violations |
|---|---|
| `routes-no-persistence` | 8 |
| `no-circular` | 5 |
| `core-no-container` | 4 |
| `core-no-persistence` | 2 |
| `no-cross-module-internals` | 2 |
| `adapters-no-modules` | 2 |
| `no-orphans` | 1 |
| **Total** | **24** |

Concretely, the ones you are most likely to open and mistake for the house
pattern:

- All four services — `agents`, `repos`, `reviews`, `repo-intel` — declare
  `constructor(private container: Container)`. That single line is the
  `core-no-container` count of 4 and most of the `no-circular` count of 5.
- Four route files query Drizzle directly:
  [`polling/routes.ts`](../../../../server/src/modules/polling/routes.ts),
  [`pulls/routes.ts`](../../../../server/src/modules/pulls/routes.ts),
  [`settings/routes.ts`](../../../../server/src/modules/settings/routes.ts),
  and
  [`workspace/routes.ts`](../../../../server/src/modules/workspace/routes.ts).
  Each contributes two violations — the `src/db/schema.ts` import and the
  `drizzle-orm` import.
- [`modules/repos/helpers.ts`](../../../../server/src/modules/repos/helpers.ts)
  imports `src/db/schema.ts`, and
  [`modules/reviews/service.ts`](../../../../server/src/modules/reviews/service.ts)
  imports `src/db/rows.ts` — a `$inferSelect` type crossing into the core.
- [`adapters/astgrep/index.ts`](../../../../server/src/adapters/astgrep/index.ts)
  and
  [`adapters/depgraph/index.ts`](../../../../server/src/adapters/depgraph/index.ts)
  both import `modules/repo-intel/constants.ts`, inverting the dependency rule.

*These files predate the gate; do not copy them, and clean the one you are
touching.*

The baseline may only shrink. Regenerating it with `pnpm arch:baseline` to
silence a failure is forbidden — if `arch:check` fails on code you did not
touch, report it rather than widening the baseline. If a rule is genuinely
wrong, change the rule in `server/.dependency-cruiser.cjs` with a comment
explaining why.

## `db/client.ts` is deliberately exempt

`core-no-persistence` forbids `^src/db/` *except* `^src/db/client\.ts$`. That
carve-out is intentional and the rule's own comment says so.

[`server/src/db/client.ts`](../../../../server/src/db/client.ts) exports the `Db`
type:

```ts
export type Db = PostgresJsDatabase<typeof schema>;
```

That is the type a repository constructor takes —
`AgentsRepository` in
[`server/src/modules/agents/repository.ts`](../../../../server/src/modules/agents/repository.ts)
is declared `constructor(private db: Db) {}`. Without the exemption, a `ports.ts`
that needed to mention a repository's construction signature would be unable to
name its argument type, and the module would be forced to invent a duplicate
alias.

The exemption is for the **type**, not the handle. Importing `Db` into a core
file to hold onto a live connection is the violation the rule exists to catch
even though the gate will not flag the import itself. Everything else under
`src/db/` — `schema.ts`, `rows.ts`, the migrations — stays out of the core with
no exceptions.

## Related

- [`server/CLAUDE.md`](../../../../server/CLAUDE.md) — the existing statement of
  this layering, plus the module-registration and known-cruft notes.
- [`rules/di-container.md`](di-container.md) — how a core file gets its
  dependencies once it is no longer allowed to take `Container`.
