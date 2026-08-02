# `@devdigest/api` — working notes

Read [`README.md`](README.md) first: it has the request/DI flow diagram, the API
map, the full env table, and the "review context" notes. Root rules are in
[`../CLAUDE.md`](../CLAUDE.md). This file is the local conventions.

Package manager: **pnpm**.

## Docs & specs

- [`docs/`](docs/) — API-scoped documentation: module deep-dives, data-flow notes,
  decision records. Anything too long for the README.
- [`specs/`](specs/) — what an endpoint or module is *supposed* to do: contract,
  behaviour, degradation, acceptance checklist. Written before or alongside the
  code; tests are checked against it.
- [`INSIGHTS.md`](INSIGHTS.md) — non-obvious things earlier sessions learned here.
  Read it before you start; append via the `engineering-insights` skill.

Both have a README stating what belongs in them. When you add non-trivial
behaviour here, write the spec first and link the doc from the README — otherwise
it's invisible.

## Layering — non-negotiable

```
modules/<name>/routes.ts       Fastify plugin. HTTP + zod schemas only.
modules/<name>/service.ts      business logic. No SQL, no HTTP.
modules/<name>/repository.ts   the ONLY place that touches the DB for that domain.
modules/<name>/helpers.ts      pure transforms.      constants.ts  literals.
adapters/<thing>/              the outside world behind an interface.
platform/                      cross-cutting: config, container, jobs, sse, errors.
```

- No raw Drizzle outside a `repository.ts`. (A few older route files still query
  directly — follow the pattern above for new code, don't copy them.)
- No `new SomeAdapter()` in a service. Take it off the container.
- A module never imports another module's `repository.ts`. Shared aggregates
  (`agentsRepo`, `reviewRepo`) are constructed in the container; use those.

This layering is the Onion dependency rule, and it is now enforced:
`pnpm arch:check` (config in [`.dependency-cruiser.cjs`](.dependency-cruiser.cjs))
fails on new violations. The 24 that predate the gate are frozen in
`.dependency-cruiser-known-violations.json` — do not regenerate it to silence a
failure. The full rules, the tool-to-ring map, and the `Deps`-instead-of-
`Container` pattern live in the `onion-architecture` skill.

## Adding a module

1. `modules/<name>/routes.ts` exporting a default Fastify plugin.
2. One import + one entry in [`src/modules/index.ts`](src/modules/index.ts).

Registration is **static on purpose** (not `@fastify/autoload`, despite the dep)
so the same path works under tsx, vitest, and a bundler. Don't switch it to
dynamic `import()` of `.ts`.

## DI container

[`platform/container.ts`](src/platform/container.ts) is the composition root —
lazy getters, cached, resolved through `SecretsProvider`. Tests inject mocks with
`ContainerOverrides`, which is why services must depend on the *interface*, never
the concrete adapter. New adapter → add the interface to `@devdigest/shared`, the
getter to the container, and the override key to `ContainerOverrides`.

## Secrets, config, tenancy

- **Secrets only via `container.secrets`.** `process.env` is read in exactly two
  places: [`platform/config.ts`](src/platform/config.ts) (non-secret config) and
  [`adapters/secrets/local.ts`](src/adapters/secrets/local.ts). Don't add a third.
  After writing a key, call `container.invalidateSecretCaches()`.
- **Every route calls `getContext(container, req)`** and scopes queries by
  `workspaceId`. Auth is a stub today, but the scoping is load-bearing — a query
  without it is a bug, not a shortcut.

## Schema & migrations

Tables live in `src/db/schema/<domain>.ts`; [`src/db/schema.ts`](src/db/schema.ts)
is a barrel that re-exports them plus the `schema` object for drizzle typing. Add
a table → new/extend a domain file → export from the barrel → `pnpm db:generate`
→ commit the generated SQL. Never edit an applied migration, and never migrate on
boot. See [`../CLAUDE.md`](../CLAUDE.md) for the seed requirement.

## Runs, SSE, jobs

- `POST /pulls/:id/review` inserts rows and returns immediately; execution is
  **fire-and-forget in-process** ([`modules/reviews/run-executor.ts`](src/modules/reviews/run-executor.ts)).
  Per-agent failures are isolated, and *every* terminal path — success, failure,
  cancel — must persist a status **and** a `run_traces` document, or the UI shows
  a run stuck at "running" after reload.
- **Cancellation is in-memory** (a `Set` in `RunBus`). It does not survive a
  restart; that's why `buildApp()` awaits `reapStaleRuns()` before listening. That
  reaper assumes a **single API instance** per DB.
- Background work goes through `container.jobs` (p-queue mirrored into the `jobs`
  table with timeout + retry), never a bare floating promise.
- Enrichment is **best-effort**: repo-intel failures must degrade to "section
  omitted" and log to the run log, never fail the review.

## Tests

- **`*.it.test.ts` = DB-backed** (testcontainers Postgres, self-skips without
  Docker). Any test importing `test/helpers/pg.ts` must use that suffix or it
  breaks the unit lane's `--exclude` glob.
- Everything else is hermetic — mock through
  [`src/adapters/mocks.ts`](src/adapters/mocks.ts), never real keys or network.
- `pnpm typecheck` also type-checks `../reviewer-core/src` through the alias.

## Known cruft — don't take these as patterns

- Dead files, zero importers: `platform/trace-builder.ts`,
  `platform/model-router.ts` (its model tables are stale too),
  `modules/settings/feature-models.ts`.
- `platform/{prompt,grounding,structured}.ts` are 3-line re-export shims to
  `reviewer-core`. Import from `@devdigest/reviewer-core` in new code.
- [`modules/repo-intel/service.ts`](src/modules/repo-intel/service.ts) opens with
  "T1.1 facade skeleton … every method returns a DEGRADED result". Stale — it's a
  real 764-line implementation. Trust the code.
- `modules/reviews/repository.ts` is a deliberate facade over
  `modules/reviews/repository/*.repo.ts`. Both are meant to exist.
- [`modules/reviews/diff-loader.ts`](src/modules/reviews/diff-loader.ts) silently
  falls back from real `git diff` to reconstructing from stored `pr_files`
  patches, with no signal about which won. Keep it in mind when a review's diff
  looks truncated.
