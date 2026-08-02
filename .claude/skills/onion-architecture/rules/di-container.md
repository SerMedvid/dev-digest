# The composition root — `Deps`, not `Container`

Law 2 in `SKILL.md` says the core takes ports, not `Container`. This file is the
mechanics: what the container is for, why taking it from a service is the single
worst violation currently in `server/src`, and the exact shape that replaces it.

## The rule

[`server/src/platform/container.ts`](../../../../server/src/platform/container.ts)
is the **composition root**. It is the one place in the codebase allowed to know
both a service and the concrete adapters that service runs on. It resolves
secrets, caches instances behind lazy getters, and hands finished objects out.
`new SomeAdapter()` appears there and nowhere else.

A service does not reach into the composition root. It declares what it needs as
a narrow `Deps` interface in its own module's `ports.ts`, and takes exactly that:

```ts
constructor(private deps: AgentsServiceDeps) {}
```

The direction matters more than the ergonomics. The service *declares* the
interface; the container *satisfies* it. That is the dependency rule — inner
rings declare, outer rings implement — expressed as a constructor signature.

## Why, concretely

`pnpm arch:check` found four import cycles. Every one of them runs through the
composition root. The shortest:

```
src/modules/repo-intel/service.ts → src/platform/container.ts → src/modules/repo-intel/service.ts
```

The mechanism is not subtle.
[`server/src/modules/repo-intel/service.ts`](../../../../server/src/modules/repo-intel/service.ts)
imports `Container` for its constructor. `Container` imports every adapter it
can build — `OctokitGitHubClient`, `SimpleGitClient`, `RipgrepCodeIndex`,
`OpenAIProvider`, `AnthropicProvider`, `OpenAIEmbedder`, `DepCruiseGraph`,
`TiktokenTokenizer`, `LocalSecretsProvider`, `LocalNoAuthProvider` — plus two
module repositories (`AgentsRepository`, `ReviewRepository`) and
`RepoIntelService` itself. That last import is what closes the loop.

So `constructor(private container: Container)` does two bad things at once. It
drags the entire outer ring into the core: the type graph of a "pure" service
now transitively includes Octokit, the Anthropic SDK, and Drizzle. And where the
container also constructs the service, it makes the cycle literal.

All four services do this today — `agents`, `repos`, `reviews`, and
`repo-intel` each declare `constructor(private container: Container)`. They are
frozen in the baseline as the four `core-no-container` entries and most of the
five `no-circular` entries. Do not copy them.

The knock-on effect is worse than the cycle.
[`server/src/modules/agents/service.ts`](../../../../server/src/modules/agents/service.ts)
does this in its constructor body:

```ts
this.repo = new AgentsRepository(container.db);
```

A core file reaching through the container for a raw `Db` handle and building
its own adapter. There is no seam left to test against: you cannot run that
service without a real database, and no test can substitute a fake repository.
That is what a `Deps` interface buys you — not architectural tidiness, a unit
test that runs with no Docker.

## The shape

The port lives in the module, next to the code that needs it. In
`modules/agents/ports.ts` — a **proposed** file; no module in `server/src` has a
`ports.ts` on disk yet, and neither does the `domain.ts` it imports from, so
treat both as the target shape rather than something you can open:

```ts
import type { LLMProvider, Provider } from '@devdigest/shared';
import type { AgentRow, AgentVersionRow, InsertAgent, UpdateAgent } from './domain.js';

/** What the agents core needs from persistence. Implemented by AgentsRepository. */
export interface AgentsRepositoryPort {
  list(workspaceId: string): Promise<AgentRow[]>;
  listEnabled(workspaceId: string): Promise<AgentRow[]>;
  getById(workspaceId: string, id: string): Promise<AgentRow | undefined>;
  deleteById(workspaceId: string, id: string): Promise<boolean>;
  insert(input: InsertAgent): Promise<AgentRow>;
  update(workspaceId: string, id: string, patch: UpdateAgent): Promise<AgentRow | undefined>;
  listVersions(agentId: string): Promise<AgentVersionRow[]>;
  getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined>;
  linkedSkills(agentId: string): Promise<{ skill: { id: string }; order: number }[]>;
  linkSkill(agentId: string, skillId: string, order: number): Promise<void>;
  setSkills(agentId: string, skillIds: string[]): Promise<void>;
}

/** Everything AgentsService depends on. One object, injected by the container. */
export interface AgentsServiceDeps {
  agents: AgentsRepositoryPort;
  llm(provider: Provider): Promise<LLMProvider>;
}
```

Three things to copy from this, beyond the names:

- **`AgentsRepositoryPort` is a subset, not a mirror.** The concrete
  `AgentsRepository` in
  [`server/src/modules/agents/repository.ts`](../../../../server/src/modules/agents/repository.ts)
  has more methods than this — `unlinkSkill`, `skillIdsForAgent`,
  `snapshotVersion`. The port lists what the *core* calls. Widening it to match
  the implementation is how a port stops being a boundary.
- **The LLM dependency is a function, not a provider.** `llm(provider: Provider)`
  mirrors the container's own async, cached resolution — the core asks for a
  provider by id and gets one, without knowing that resolving it involves a
  secrets lookup. `Provider` is the `@devdigest/shared` enum
  (`'openai' | 'anthropic' | 'openrouter'`), which is exactly the container
  method's parameter type.
- **`AgentRow` in a port is a transitional compromise.** Law 3 says database rows
  do not leak; these `$inferSelect` aliases live in
  [`server/src/db/rows.ts`](../../../../server/src/db/rows.ts) today. The
  proposed `domain.ts` is where they get replaced by domain types. Introducing
  the port first and narrowing the row types second is a legitimate order to do
  the work in — shipping the port and calling law 3 satisfied is not.

## The wiring

The container grows one getter per service's `Deps`:

```ts
get agentsServiceDeps(): AgentsServiceDeps {
  return { agents: this.agentsRepo, llm: (p) => this.llm(p) };
}
```

What the container exposes is `agentsServiceDeps` — **the getter, not the
service**. Nothing changes about who constructs `AgentsService`; the route or
plugin that builds it now passes `container.agentsServiceDeps` instead of
`container`. The import edge from `modules/agents/service.ts` to
`platform/container.ts` disappears, and with it the cycle.

`this.agentsRepo` is already a lazy cached getter on `Container` — it exists so
that other modules can use the shared aggregate instead of reaching into
`modules/agents/`. The `Deps` getter reuses it rather than constructing anything
new.

Tests need no new machinery. `ContainerOverrides` already exists on the
container and already covers `secrets`, `auth`, `github`, `git`, `codeIndex`,
`embedder`, `llm`, `repoIntel`, `depgraph`, and `tokenizer`, so a test can build
a real `Container` with mocked adapters and read `agentsServiceDeps` off it. Or
— and this is the point of the exercise — it can skip the container entirely and
hand `AgentsService` a plain object literal satisfying `AgentsServiceDeps`, with
no database and no Docker.

## Adding a new adapter

The steps already live in
[`server/CLAUDE.md`](../../../../server/CLAUDE.md) under "DI container"; follow
them there rather than a copy that can drift. In summary, four edits:

1. The interface goes into `@devdigest/shared`.
2. A lazy getter goes on `Container`.
3. A key goes on `ContainerOverrides`.
4. A mock goes into
   [`server/src/adapters/mocks.ts`](../../../../server/src/adapters/mocks.ts).

Only then does the adapter get referenced by a `Deps` interface. Steps 3 and 4
are the ones people skip, and skipping them is what forces the next test to
reach for a real credential.

## The two-copies trap

Step 1 has a catch that will not show up in `server/`'s typecheck.
`@devdigest/shared` is a tsconfig path alias, and it resolves to **two different
directories**:

| Package | `@devdigest/shared` resolves to |
|---|---|
| `server/` | `server/src/vendor/shared/` |
| `reviewer-core/` | `server/src/vendor/shared/` |
| `client/` | `client/src/vendor/shared/` |

Two physical copies, nothing keeping them in sync, and they have already
drifted. A port you add to `server/src/vendor/shared/adapters.ts` does not exist
for the client until you make the same edit to
`client/src/vendor/shared/adapters.ts`.

So: apply the edit to both copies, then type-check both packages —
`cd server && pnpm typecheck` and `cd client && pnpm typecheck`. A
server-side-only edit compiles green and breaks the client build later, in
someone else's session.

A related consequence, for anything you put in a shared contract: each package
installs its own `zod`, so `err instanceof z.ZodError` can be false across the
boundary. Do not add cross-package `instanceof` checks on library classes.

## Related

- [`rules/layers.md`](layers.md) — the import matrix; the `service.ts` row is
  what this file is the fix for.
- [`server/CLAUDE.md`](../../../../server/CLAUDE.md) — the container's own
  conventions: lazy getters, `SecretsProvider` resolution, the adapter steps.
