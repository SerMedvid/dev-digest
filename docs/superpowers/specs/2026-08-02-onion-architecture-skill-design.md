# Design — `onion-architecture` skill

Date: 2026-08-02
Status: approved, not yet implemented

## Problem

`server/CLAUDE.md` already states a layering (`routes → service → repository →
adapters → platform`) and the repo has the two pieces Onion Architecture needs:
a composition root ([`platform/container.ts`](../../../server/src/platform/container.ts))
and ports as interfaces ([`vendor/shared/adapters.ts`](../../../server/src/vendor/shared/adapters.ts)).

Nothing enforces it, and the core already depends outward in four concrete ways:

1. **Services depend on the composition root.** All four services —
   `agents`, `repos`, `reviews`, `repo-intel` — declare
   `constructor(private container: Container)`. `Container` is a concrete class
   that imports every adapter and several module repositories, so the
   application core transitively depends on the entire outer ring.
2. **Drizzle rows leak through the core.** Repositories return
   `$inferSelect` types (`ReviewRow`, `FindingRow`, `PullRow`), which then appear
   in service signatures and flow to routes.
3. **Routes query the database directly** in `polling`, `pulls`, `settings`,
   and `workspace` — the driving adapter reaching the driven adapter, skipping
   the core.
4. **No machine barrier.** `dependency-cruiser` is a dependency of `server/`,
   but only as a *product feature* (the repo-intel dep-graph adapter). It is
   never pointed at our own source.

The result is a layering that is documented but drifts, and drift is only ever
caught by whoever happens to read `CLAUDE.md`.

## Goal

A skill that makes the Onion dependency rule the default for backend work and
fails loudly when new code breaks it — without turning every endpoint into a
five-file ceremony.

## Decisions

| Question | Decision |
|---|---|
| Strictness | Formalise the **existing** module shape in Onion terms and close the four gaps. No `domain/application/infrastructure` folder rewrite. |
| Enforcement | Mandatory checklist **plus** a `dependency-cruiser` gate (`pnpm arch:check`). |
| Scope | `server/` only. `reviewer-core/` is out of scope. |
| Existing violations | Frozen as a `depcruise` known-violations baseline. New code fails the gate; old code does not block work. |
| Skill shape | `SKILL.md` + `rules/` per tool, mirroring `.claude/skills/fastify-best-practices/`. |
| CI | Out of scope. The gate is local-only. |

## The dependency law

Palermo's single invariant: *all coupling points toward the centre; inner rings
declare interfaces, outer rings implement them.*

```
┌─ platform/ (cross-cutting: config, container, errors, jobs, sse) ─┐
│ ┌─ Driving adapters ── modules/<m>/routes.ts (Fastify + zod)      │
│ │ ┌─ Application ───── modules/<m>/service.ts  (use-cases)        │
│ │ │  ┌─ Domain ─────── modules/<m>/domain.ts + helpers.ts (pure)  │
│ │ │  └─ Ports ──────── modules/<m>/ports.ts, vendor/shared/*      │
│ │ └─ Driven adapters ─ modules/<m>/repository.ts, adapters/<x>/   │
└───────────────────────────────────────────────────────────────────┘
```

Four rules, each mechanically checkable:

1. **The core imports nothing outward.** `service.ts`, `domain.ts`, `helpers.ts`
   may not import `drizzle-orm`, `db/schema.js`, `fastify`, `octokit`,
   `@anthropic-ai/sdk`, `openai`, or `simple-git`.
2. **The core takes ports, not `Container`.** New form:
   `constructor(private deps: <Name>ServiceDeps)`, where the interface lives in
   the module's `ports.ts`. `Container` becomes a factory of those `deps`
   objects, keeping it the only place that knows both sides.
3. **Database rows do not leak.** No `$inferSelect` type in a service's public
   signature. The repository maps to a domain type declared in `domain.ts`.
4. **No module imports another module's `repository.ts`.** Already a written
   rule; now enforced.

## Tool → ring mapping

| Tool | Ring | Rule the skill enforces |
|---|---|---|
| Fastify 5 + `@fastify/*` | driving adapter | Only in `routes.ts` / `app.ts` / `server.ts`. `FastifyRequest`/`FastifyReply` never cross into a service. A route parses, calls one use-case, maps to a DTO. `getContext(container, req)` yields `workspaceId`, which travels onward as a plain argument. |
| `fastify-type-provider-zod` | driving adapter | Endpoint Zod schemas live next to the route. They describe the **HTTP contract**, not the domain. |
| Drizzle + `postgres.js` | driven adapter | Only in `repository.ts` and `db/`. Transactions are owned by the repository; a `tx` handle is never passed into a service. A use-case spanning repositories gets a Unit-of-Work callback from the composition root instead. |
| Zod 3 | two distinct roles | (a) edge validation in routes, (b) structured-LLM-output contracts for `completeStructured({ schema })`. Domain types are plain TS types, not Zod. Note the repo trap: `@devdigest/shared` exists as two physical copies, so `instanceof z.ZodError` can be false across the package boundary. |
| `@anthropic-ai/sdk`, `openai`, OpenRouter | driven adapter | Only in `adapters/llm/*`. The core knows the `LLMProvider` port from `shared/adapters.ts`. Model selection, retries, and cost accounting live in the adapter / `platform`, never in a use-case. |
| `octokit`, `simple-git`, ripgrep, ast-grep, `dependency-cruiser` (as a product feature), `js-tiktoken` | driven adapters | Each already sits behind a port: `GitHubClient`, `GitClient`, `CodeIndex`, `DepGraph`, `Tokenizer`. Rule: an SDK type never appears in a service signature. |
| `p-queue` / `jobs` / SSE `runBus` | platform (outer ring) | The core sees them as narrow interfaces (`Logger`, a publisher) — the shape `run-executor.ts` already uses, promoted to the norm. Background work goes through `container.jobs`, never a bare floating promise. |
| vitest + testcontainers | test | The core is testable **without Docker and without HTTP**, using port fakes. Anything requiring `*.it.test.ts` is by definition an adapter. |

## Enforcement gate

`dependency-cruiser` gains a second role as an architecture linter. The binaries
(`depcruise`, `depcruise-baseline`) are already present in `server/node_modules/.bin`.

- `server/.dependency-cruiser.cjs` — `forbidden` rules covering the four laws
  above, plus `no-circular` and `no-orphans`.
- `server/.dependency-cruiser-known-violations.json` — the frozen baseline: the
  four direct-DB route files, the four `Container`-taking services, and the
  known-dead files `no-orphans` will flag (`platform/trace-builder.ts`,
  `platform/model-router.ts`, `modules/settings/feature-models.ts`, listed as
  cruft in `server/CLAUDE.md`).
- `pnpm arch:check` → `depcruise src --config --ignore-known`; exits non-zero on
  a **new** violation only.
- `pnpm arch:baseline` → regenerates the baseline. The skill states that
  regenerating to silence a failure is forbidden; the baseline may only shrink.

The skill requires running `arch:check` and showing its output before claiming
the work is done.

## Skill package

```
.claude/skills/onion-architecture/
  SKILL.md          the law, the ring map, the checklist, the gate, "when not to apply"
  rules/
    layers.md       who-may-import-whom matrix; how to name a file's ring
    fastify.md      routes as driving adapter
    drizzle.md      repository as driven adapter; transactions; no row leaks
    zod-contracts.md where validation lives vs. where domain types live; the two-copies trap
    llm-adapters.md  LLMProvider, grounding, cost, determinism in tests
    di-container.md  composition root; Deps object instead of Container
    testing.md       testing the core without a DB; what must be *.it.test.ts
  examples/
    before-after.md  a real refactor of the `agents` module (smallest of the four)
  references.md      sources
```

`SKILL.md` does not restate `fastify-best-practices`, `drizzle-orm-patterns`, or
`zod`. Those cover *how to use a tool*; this one covers *which ring the tool is
allowed to live in*, and links to them.

### Checklist (a todo per item)

1. Read `server/INSIGHTS.md` and `server/CLAUDE.md`.
2. Name the ring of every file you are about to touch.
3. Ports first, implementation second.
4. Verify no `$inferSelect` type crossed a boundary.
5. `new SomeAdapter()` appears only in `container.ts`.
6. Run `pnpm arch:check`; include the output.
7. The core test passes without Docker.

### When not to apply

A thin read-only endpoint (`workspace/routes.ts`) does not need `domain.ts` and
`ports.ts`. Introducing them there is exactly the boilerplate Clean Architecture
is fairly criticised for. Threshold: a port appears when there are ≥2
implementations, real external I/O, or a business rule that must be tested
without a database.

## Behaviour and degradation

- **Missing baseline file** — `arch:check` still runs; every existing violation
  reports as an error. The skill instructs generating the baseline once, at
  install time, and committing it.
- **`arch:check` fails on pre-existing code the session did not touch** — the
  skill says to report it, not to widen the baseline.
- **A rule proves wrong** (a legitimate import it forbids) — change the rule in
  `.dependency-cruiser.cjs` with a comment explaining why, rather than adding a
  one-off baseline entry.

## Acceptance

- [ ] `.claude/skills/onion-architecture/SKILL.md` exists with valid frontmatter
      (`name`, `description`, `allowed-tools`) matching the convention of the
      other skills in `.claude/skills/`.
- [ ] All seven `rules/*.md` files exist and each names concrete files in
      `server/src` rather than generic advice.
- [ ] `examples/before-after.md` shows the `agents` module in both forms, with
      the `Deps` interface written out.
- [ ] `references.md` carries every link from the design's reference list.
- [ ] `server/.dependency-cruiser.cjs` encodes the four laws; running
      `pnpm arch:check` on a deliberately bad import exits non-zero.
- [ ] `server/.dependency-cruiser-known-violations.json` is committed and covers
      the known-violating files listed above (the file records one entry per
      offending dependency edge, so the entry count exceeds the file count).
- [ ] `pnpm arch:check` on unmodified `main` exits zero.
- [ ] `server/package.json` has `arch:check` and `arch:baseline` scripts.
- [ ] `.claude/skills/README.md` catalog has a row for the skill.
- [ ] `server/CLAUDE.md`'s layering section points at the skill.
- [ ] `cd server && pnpm typecheck` passes (no source changes expected, but the
      config must not break it).

## Out of scope

- Refactoring the four services off `Container` and the four routes off direct
  Drizzle. The baseline exists so this can happen incrementally.
- `reviewer-core/`, `client/`, `e2e/`.
- A CI step for `arch:check`.
- Introducing ESLint to `server/` (`eslint-plugin-boundaries` was considered and
  rejected on that basis).

## References

**Onion / Hexagonal canon**

- [Jeffrey Palermo — The Onion Architecture: part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)
  · [part 2](http://jeffreypalermo.com/blog/the-onion-architecture-part-2/)
  · [part 3](http://jeffreypalermo.com/blog/the-onion-architecture-part-3/)
  · [part 4: after four years](http://jeffreypalermo.com/blog/onion-architecture-part-4-after-four-years/)
- [Herberto Graça — Onion Architecture](https://herbertograca.com/2017/09/21/onion-architecture/)
- [NDepend — Onion Architecture: Going Beyond Layers](https://blog.ndepend.com/onion-architecture-layers/)
- [Oliver Drotbohm — Sliced Onion Architecture](http://odrotbohm.github.io/2023/07/sliced-onion-architecture/)
- [Hexagonal Architecture and Clean Architecture (with examples)](https://dev.to/dyarleniber/hexagonal-architecture-and-clean-architecture-with-examples-48oi)
- [Clean vs Hexagonal Architecture — practical guide](https://topictrick.com/blog/clean-vs-hexagonal-architecture)

**Node / TypeScript**

- [Onion Architecture in Node.js with TypeScript](https://sankhadip.medium.com/onion-architecture-in-node-js-with-typescript-5508612a4391)
- [Melzar/onion-architecture-boilerplate](https://github.com/Melzar/onion-architecture-boilerplate)
- [borjatur/clean-architecture-fastify-mongodb](https://github.com/borjatur/clean-architecture-fastify-mongodb)
- [Hexagonal Architecture: a complete guide with a TypeScript example](https://generalistprogrammer.com/tutorials/hexagonal-architecture-complete-guide)

**Persistence / Drizzle**

- [Sentry — Atomic Repositories in Clean Architecture and TypeScript](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/)
- [Repository Pattern with Drizzle ORM](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae)
- [Repository and Unit of Work in Domain-Driven Design](https://dev.to/ruben_alapont/repository-and-unit-of-work-in-domain-driven-design-531e)
- [Transactions with DDD and the Repository Pattern in TypeScript](https://medium.com/@joaojbs199/transactions-with-ddd-and-repository-pattern-in-typescript-a-guide-to-good-implementation-part-2-da0af3e10901)
- [Drizzle ORM Best Practices](https://www.paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/)

**Machine enforcement**

- [dependency-cruiser — rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
- [Xebia — Taking Frontend Architecture Serious With Dependency-cruiser](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/)
- [Atomic Object — Dependency Cruiser: Restrict Imports in JavaScript](https://spin.atomicobject.com/dependency-cruiser-imports/)
- [Avoid Cross Module Dependencies with Dependency Cruiser](https://dev.to/jacobandrewsky/avoid-cross-module-dependencies-with-dependency-cruiser-3b0b)
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) — considered, rejected

**Counter-arguments (so the skill does not become a boilerplate machine)**

- [Jimmy Bogard — Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/)
- [CodeOpinion — Is Vertical Slice Architecture better than Clean Architecture or Ports and Adapters?](https://codeopinion.com/is-vertical-slice-architecture-better-than-clean-architecture-or-ports-and-adapters/)
- [James Hickey — Clean Architecture Disadvantages](https://www.jamesmichaelhickey.com/clean-architecture/)
- [Why Clean Architecture is a Maintainability Nightmare](https://earezki.com/clean-architecture-maintainability-nightmare/)
