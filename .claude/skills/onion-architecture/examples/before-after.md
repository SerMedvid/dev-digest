# Before/after — the `agents` module, both ways

`rules/di-container.md` states law 2 abstractly: a service takes a `Deps`
interface, not `Container`. This file walks the same change through one real
module, end to end — the service, the container, the route, and the test that
becomes possible. `agents` is the smallest of the four services that currently
take `Container` (`agents`, `repos`, `reviews`, `repo-intel`), which is why it
is the one used here.

**Nothing in this file is applied to the codebase.** Every block below is
either quoted from the file as it exists on `main` today, or is a proposed
rewrite for illustration. `modules/agents/ports.ts` does not exist on disk; if
you go looking for it you will not find it. See Step 5 for what that implies
about the current state of the baseline.

## Step 1 — the "before", quoted from the real file

This is [`server/src/modules/agents/service.ts`](../../../../server/src/modules/agents/service.ts)
as it stands today, not a paraphrase. The full class has eleven methods (`list`,
`get`, `delete`, `create`, `update`, `listVersions`, `getVersion`, `skillLinks`,
`setSkills`, `linkSkill`, `listModels`); the excerpt below keeps the
constructor and the two methods (`list`, `listModels`) that Steps 2 and 4
rewrite, and elides the rest with `// …` — every line shown is copied
character-for-character from the file, nothing is invented:

```ts
import type { Container } from '../../platform/container.js';
import type {
  Agent,
  AgentSkillLink,
  AgentVersion,
  CiFailOn,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { AgentsRepository } from './repository.js';
import { toAgentDto, toAgentVersionDto } from './helpers.js';

// …

export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toAgentDto);
  }

  // … get, delete, create, update, listVersions, getVersion, skillLinks,
  // setSkills, linkSkill omitted — none of them touch Container directly,
  // they all go through this.repo, which the constructor already built.

  async listModels(provider: Provider): Promise<ModelInfo[]> {
    try {
      const llm = await this.container.llm(provider);
      return await llm.listModels();
    } catch {
      return [];
    }
  }
}
```

Three problems, in order of how much damage they do:

1. **The type-only `Container` import is still a real dependency edge.** It
   reads like an erased type-level annotation, but `import type` still creates
   an edge `arch:check`'s `tsPreCompilationDeps` option walks — dependency-cruiser
   otherwise resolves the *compiled* graph, where an `import type` has already
   vanished, and would wave this straight through. `tsPreCompilationDeps` is the
   setting that makes the gate see the edge dependency-cruiser would otherwise
   miss, which is why `core-no-container` catches this constructor at all.
2. **The service constructs its own persistence adapter.** Line 55,
   `this.repo = new AgentsRepository(container.db)`, is a core file reaching
   through the container for a raw `Db` handle and calling `new` on a concrete
   adapter. `new SomeAdapter()` is supposed to appear in exactly one place —
   `platform/container.ts` — and this is the second place.
3. **The whole outer ring is reachable from the core through `container`.**
   `Container`'s type imports Octokit, the Anthropic and OpenAI SDKs, simple-git,
   Drizzle, and every other adapter it can build, plus `AgentsRepository` and
   `ReviewRepository` themselves — so a service that merely names `Container` in
   a constructor signature pulls that entire graph into what is supposed to be
   the pure core. `listModels` compounds it: `this.container.llm(provider)`
   means even the one call that looks like it goes through a narrow interface
   is really reaching back into the container to get it, rather than having it
   handed in.

## Step 2 — the "after"

The proposed rewrite of the same file, with the port taking over both jobs the
constructor used to do — holding a repository, and resolving an LLM provider:

```ts
import type { Agent, ModelInfo, Provider } from '@devdigest/shared';
import type { AgentsServiceDeps } from './ports.js';
import { toAgentDto } from './helpers.js';

export class AgentsService {
  constructor(private deps: AgentsServiceDeps) {}

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.deps.agents.list(workspaceId);
    return rows.map(toAgentDto);
  }

  async listModels(provider: Provider): Promise<ModelInfo[]> {
    try {
      const llm = await this.deps.llm(provider);
      return await llm.listModels();
    } catch {
      return [];
    }
  }
}
```

`Container` is gone from the import list entirely — not narrowed, gone. The
`private repo: AgentsRepository` field is gone too; `this.deps.agents` is the
port, and the service never constructs anything. Same shape holds for the nine
elided methods: every `this.repo.X(...)` call becomes `this.deps.agents.X(...)`,
mechanically, because `AgentsRepositoryPort` (defined in
[`rules/di-container.md`](../rules/di-container.md)) lists exactly the methods
those calls need.

## Step 3 — the container side

The container is the one place allowed to know both `AgentsService` and the
concrete `AgentsRepository` it runs on, so this is where the two get wired back
together:

```ts
// platform/container.ts — the composition root, and the only place that knows both sides.
get agentsServiceDeps(): AgentsServiceDeps {
  return { agents: this.agentsRepo, llm: (p) => this.llm(p) };
}
```

`this.agentsRepo` and `this.llm` already exist on `Container` today — the
getter above adds no new adapter, it only repackages two things the container
already builds into the one object shape `AgentsServiceDeps` asks for.

And the route side, unchanged in shape — it swaps one argument for another,
nothing about *how* `AgentsService` gets constructed changes:

```ts
// modules/agents/routes.ts
const service = new AgentsService(container.agentsServiceDeps);
```

## Step 4 — what the change buys, as a test

This is the payoff, and it is the same fake `rules/testing.md` already shows:
before, exercising `AgentsService.list` meant building a `Container`, which
meant a `Db`, which meant Docker. After, it's an object literal:

```ts
// Before: a unit test needs a Container, so it needs a Db.
// After:
const service = new AgentsService({
  agents: { list: async () => [agentRowFixture] } as AgentsRepositoryPort,
  llm: async () => { throw new Error('no key'); },
});

expect(await service.list('ws-1')).toHaveLength(1);
expect(await service.listModels('openai')).toEqual([]); // degradation, no network
```

Two things worth noticing in this test, not just that it runs without Docker.
The `llm` fake throws, on purpose — `listModels`'s `catch` block is a real
degradation path (the editor still renders when no provider key is configured),
and it takes exactly as much fake as a thrown error to exercise it, no mock
library involved. And `agents.list` returns `[agentRowFixture]`, a plain value
shaped like `AgentRow`, cast to satisfy `AgentsRepositoryPort` — the port is
what makes that cast sufficient; nothing downstream needs a real database row.

## Step 5 — what is deliberately NOT changed

`AgentsRepository` keeps returning `AgentRow`. Law 3 is about the *service's*
public signature, and `AgentsService.list` already returns `Agent`, not
`AgentRow` — the mapping happens in `helpers.ts`, via `toAgentDto`, both before
and after this change. Nothing here touches that boundary. Do not read
`AgentsRepositoryPort`'s methods returning `AgentRow` (per
`rules/di-container.md`) as a law-3 violation waiting to happen, and do not
invent a domain entity class where a mapped DTO already does the job — that is
exactly the `domain.ts` work `rules/di-container.md` calls a transitional
compromise, deliberately sequenced *after* the port ships, not before.

And to be unmistakable about scope: **this example is documentation, not a
merged refactor.** `agents/service.ts` still takes `constructor(private
container: Container)` on this branch — Step 1's quote is real, current code,
verified in Step 6 below — and that violation is one of the frozen
`core-no-container` entries in
[`server/.dependency-cruiser-known-violations.json`](../../../../server/.dependency-cruiser-known-violations.json).
Nothing in Steps 2–4 exists as a file in `server/src` today; `ports.ts`,
the `deps`-based constructor, and the `agentsServiceDeps` getter are all
proposed shapes, shown to make law 2 concrete rather than left abstract.

## Step 6 — verifying the quote against the real file

Both lines Step 1 quotes were re-checked against
`server/src/modules/agents/service.ts` at the time this file was written:

```
$ grep -n "constructor(private container: Container)" server/src/modules/agents/service.ts
54:  constructor(private container: Container) {

$ grep -n "this.repo = new AgentsRepository(container.db)" server/src/modules/agents/service.ts
55:    this.repo = new AgentsRepository(container.db);
```

Both found, at the line numbers Step 1's excerpt implies. If a future reader
runs this and gets no output, the "before" quote above has gone stale — re-quote
from the current file rather than trusting this page; a stale example is worse
than none.

## Related

- [`rules/di-container.md`](../rules/di-container.md) — the abstract statement
  of law 2 this file works through concretely, including the full
  `AgentsRepositoryPort` / `AgentsServiceDeps` definitions and why `AgentRow`
  in the port is a transitional compromise, not a law-3 violation.
- [`rules/testing.md`](../rules/testing.md) — the same `Deps` fake shown in
  Step 4, in the context of the unit/integration test split.
