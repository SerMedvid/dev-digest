# Testing — the core without Docker

`SKILL.md` puts vitest and testcontainers in the test ring: the core must be
testable with no Docker and no HTTP, and anything that needs `*.it.test.ts` is
an adapter by definition. This file is that boundary in detail — what a fake
looks like, what forces a test into the DB-backed lane, and what to run before
calling the work done.

## The test tells you if the boundary is right

If exercising a business rule requires spinning up Postgres, the rule is not
actually in the core — something in it is still reaching for a live adapter.
Treat a test that "needs Docker to check a business rule" as a design smell to
fix by moving the dependency behind a port, not as a reason to write a bigger
`*.it.test.ts`.

## Core tests take fakes, not mocks of concrete classes

Because a service takes a narrow `Deps` interface (`rules/di-container.md`),
the fake for a unit test is a plain object literal — no class, no mocking
library, no constructed `Container`:

```ts
const deps: AgentsServiceDeps = {
  agents: { list: async () => [], /* … */ } as AgentsRepositoryPort,
  llm: async () => fakeLLM,
};
const service = new AgentsService(deps);
```

`AgentsServiceDeps` and `AgentsRepositoryPort` are the exact interfaces defined
in `rules/di-container.md`'s proposed `modules/agents/ports.ts` —
`AgentsRepositoryPort` lists the handful of methods the core calls (`list`,
`getById`, `deleteById`, `insert`, `update`, `listVersions`, `getVersion`,
`linkedSkills`, `linkSkill`, `setSkills` — not `listEnabled`, which only
`reviews` calls, via `container.agentsRepo`), and
`AgentsServiceDeps` bundles it with `llm(provider: Provider): Promise<LLMProvider>`.
Satisfying that with an object literal costs nothing: no database, no
constructed adapters, no `ContainerOverrides`.

Contrast that with the current form. `rules/di-container.md` is explicit that
no module in `server/src` has a `ports.ts` on disk yet — today all four
services take `constructor(private container: Container)`, so a test that
wants to exercise `AgentsService` has to build a whole `Container` (with
`ContainerOverrides` standing in for the real adapters) just to get an object
whose shape the constructor accepts. The `Deps` fake above is the payoff for
doing the `ports.ts` work described in `rules/di-container.md`: the same test
intent, with the container removed from the picture entirely.

## `*.it.test.ts` means DB-backed

A test suffixed `.it.test.ts` starts a real Postgres via testcontainers and
self-skips cleanly when Docker is unreachable.
[`server/test/helpers/pg.ts`](../../../../server/test/helpers/pg.ts) is the
helper: `dockerAvailable()` shells out to `docker info` and caches the result,
and `startPg()` spins up a `PostgreSqlContainer('pgvector/pgvector:pg16')` —
the same image `docker-compose` uses, so the `vector` extension is present —
then runs migrations and hands back a Drizzle client.

Any test that imports `test/helpers/pg.ts` **must** carry the `.it.test.ts`
suffix, or it silently breaks the unit lane's exclude glob:

```
pnpm exec vitest run --exclude '**/*.it.test.ts'
```

A `foo.test.ts` that imports the Postgres helper still matches that glob (it
doesn't end in `.it.test.ts`), so it runs in the "no Docker" lane and fails
there instead of skipping — the suffix is not decoration, it's what the
exclude pattern keys on.

## Everything else is hermetic

Every other test goes through
[`src/adapters/mocks.ts`](../../../../server/src/adapters/mocks.ts) — never a
real key, never a real network call. That file's mocks are deliberately
behavior-preserving rather than empty stubs: `MockLLMProvider.completeStructured`
takes a fixture, runs it through the real `schema.safeParse(fixture)`, and
throws if the fixture doesn't satisfy the schema, so a test that hands it a
malformed fixture fails the same way a real structured-output mismatch would.
`MockGitHubClient`, `MockGitClient`, `MockCodeIndex`, `MockAuthProvider`, and
`MockSecretsProvider` cover the rest of the adapter surface. Reach for one of
these before reaching for a real credential.

## `ContainerOverrides` is for adapter-level tests

`ContainerOverrides` (in `platform/container.ts`) lets a test build a real
`Container` with selected adapters swapped for mocks — `secrets`, `auth`,
`github`, `git`, `codeIndex`, `embedder`, `llm` (keyed by provider id),
`repoIntel`, `depgraph`, `tokenizer`. That is the right tool when the test's
subject is the wiring itself — a route, `run-executor.ts`, anything that
genuinely needs a `Container` to exist. It is not a substitute for a `Deps`
fake in a unit test of a service's business rule: constructing a `Container`
at all, even a fully mocked one, is more machinery than a plain object literal
satisfying `AgentsServiceDeps`, and it keeps the test coupled to `Container`'s
shape instead of the service's actual dependencies.

## Before saying it works

```
cd server && pnpm typecheck
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
cd server && pnpm arch:check
```

`pnpm typecheck` also type-checks `../reviewer-core/src` through the tsconfig
alias — a change that only looks like it touches `server/` can still break
`reviewer-core`'s build, and this is the command that catches it before CI
does.

## Suite-per-package strategy

This file is only about where the *core* sits relative to Docker and HTTP. For
how the four packages' suites are organised, which CI workflow runs which, and
the path-filtering rules that decide whether a given change triggers them, see
root [`TESTING.md`](../../../../TESTING.md) — don't restate it here.

## Related

- [`rules/di-container.md`](di-container.md) — the exact shape of
  `AgentsServiceDeps` and `AgentsRepositoryPort` used in the fake above, and why
  taking `Container` is the violation this rule's payoff fixes.
- [`rules/llm-adapters.md`](llm-adapters.md) — the grounding gate and prompt
  assembly as the core rules this file's fakes are meant to exercise.
- [`server/CLAUDE.md`](../../../../server/CLAUDE.md) — the "Tests" section this
  file elaborates on.
- root [`TESTING.md`](../../../../TESTING.md) — the suite-per-package strategy
  and CI path filters.
