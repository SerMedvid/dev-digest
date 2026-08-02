---
name: onion-architecture
description: Use when writing or reviewing any backend code in server/ — a new module, endpoint, adapter, repository, or service refactor. Enforces the Onion dependency rule (all coupling points inward; inner rings declare interfaces, outer rings implement them) for our Fastify + Drizzle + Zod + LLM-SDK stack, and requires the pnpm arch:check gate to pass before the work is called done.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Onion architecture (server/)

One invariant, from Palermo's original 2008 posts: **all coupling points toward
the centre. Inner rings declare interfaces; outer rings implement them.**

This skill is about *which ring a tool is allowed to live in*. For how to use the
tools themselves, see the `fastify-best-practices`, `drizzle-orm-patterns`,
`postgresql-table-design`, and `zod` skills — do not restate them here.

Scope: `server/` only. `reviewer-core/`, `client/`, and `e2e/` are out.

## The rings

    ┌─ platform/ (cross-cutting: config, container, errors, jobs, sse) ─┐
    │ ┌─ Driving adapters ── modules/<m>/routes.ts (Fastify + zod)      │
    │ │ ┌─ Application ───── modules/<m>/service.ts  (use-cases)        │
    │ │ │  ┌─ Domain ─────── modules/<m>/domain.ts + helpers.ts (pure)  │
    │ │ │  └─ Ports ──────── modules/<m>/ports.ts, vendor/shared/*      │
    │ │ └─ Driven adapters ─ modules/<m>/repository.ts, adapters/<x>/   │
    └───────────────────────────────────────────────────────────────────┘

## The four laws

1. **The core imports nothing outward.** `service.ts`, `domain.ts`, `helpers.ts`
   may not import `drizzle-orm`, `db/schema.js`, `fastify`, `octokit`,
   `@anthropic-ai/sdk`, `openai`, or `simple-git` — nor their scoped and
   prefixed siblings, `@octokit/*`, `@fastify/*`, `fastify-*`, `@ast-grep/*`,
   and `js-tiktoken`.
   Gate rules: `core-no-persistence`, `core-no-sdk`.
2. **The core takes ports, not `Container`.** Write
   `constructor(private deps: XServiceDeps)` with the interface in the module's
   `ports.ts`. Taking `Container` **always** drags the whole outer ring into the
   core: the type graph of a supposedly pure service then includes Octokit,
   Drizzle, and every LLM SDK. It closes an import **cycle** only in the narrower
   case where the container also *constructs* you. Four services take `Container`
   today (`agents`, `repos`, `reviews`, `repo-intel`), but `platform/container.ts`
   constructs only `RepoIntelService` — so all four of the baseline's
   container-borne cycles belong to `repo-intel`, and the other three services
   close none. The dependency-rule breach is the reason to avoid `Container`; the
   cycle is just the case where the gate can also see it.
   Gate rules: `core-no-container`, `no-circular`. See `rules/di-container.md`.
3. **Database rows do not leak.** No `$inferSelect` row alias in a service's
   public signature — `AgentRow`, `AgentVersionRow`, `FindingRow`, `PullRow`, and
   `AgentRunRow` live in `server/src/db/rows.ts`; `ReviewRow` is declared in
   `server/src/modules/reviews/repository.ts`, not in `db/rows.ts`. The
   repository maps to a domain type. See `rules/drizzle.md`.
4. **No module imports another module's internals.** Shared aggregates
   (`agentsRepo`, `reviewRepo`) come off the container.
   Gate rule: `no-cross-module-internals`. (`adapters-no-modules` is the mirror
   rule for the other direction — an adapter reaching into a module — not this
   law.)

## Which ring does my tool live in?

| Tool | Ring | Rule |
|---|---|---|
| Fastify 5, `@fastify/*` | driving adapter | `routes.ts` / `app.ts` / `server.ts` only. `FastifyRequest`/`Reply` never cross into a service. → `rules/fastify.md` |
| `fastify-type-provider-zod` | driving adapter | Endpoint schemas sit next to the route; they describe the HTTP contract, not the domain. → `rules/zod-contracts.md` |
| Drizzle, `postgres.js` | driven adapter | `repository.ts` and `db/` only. Transactions stay inside the repository; a `tx` handle never enters a service. → `rules/drizzle.md` |
| Zod 3 | boundary only | Edge validation and LLM structured-output contracts. Domain types are plain TS. → `rules/zod-contracts.md` |
| `@anthropic-ai/sdk`, `openai`, OpenRouter | driven adapter | `@anthropic-ai/sdk` and `openai` stay in `adapters/llm/*`; `OpenRouterProvider` lives in `reviewer-core/src/llm/openrouter.ts` (shared with the CI runner) and is imported into `platform/container.ts`. Either way, the core knows only `LLMProvider`. → `rules/llm-adapters.md` |
| `octokit`, `simple-git`, ripgrep, ast-grep, `js-tiktoken` | driven adapters | Behind `GitHubClient`, `GitClient`, `CodeIndex`, `DepGraph`, `Tokenizer`. An SDK type never appears in a service signature. |
| `p-queue` / `jobs` / SSE `runBus` | platform | The core sees narrow interfaces (`Logger`, a publisher), not the platform object itself. `modules/reviews/run-executor.ts` shows the narrow half only: it declares a four-method `Logger` type and takes `logger?: Logger` as a parameter. Do **not** copy the rest of that file — it takes `private container: Container` and imports `db/schema.js` and `AgentRow`, which would be a fifth `core-no-container` and a third `core-no-persistence` violation if the gate's `CORE` pattern could see it. Background work goes through `container.jobs`, never a bare floating promise. |
| vitest, testcontainers | test | The core is testable with no Docker and no HTTP. Anything needing `*.it.test.ts` is by definition an adapter. → `rules/testing.md` |

## Checklist

Create a todo per item. Do not skip 6.

1. Read `server/INSIGHTS.md` and `server/CLAUDE.md`.
2. Name the ring of every file you are about to touch.
3. Ports first, implementation second.
4. Check no `$inferSelect` type crossed a boundary.
5. `new SomeAdapter()` appears only in `platform/container.ts`.
6. Run `cd server && pnpm arch:check`; paste the output into your response.
7. The core test passes with no Docker.

## The gate

    cd server && pnpm arch:check      # validate; honours the baseline
    cd server && pnpm arch:baseline   # regenerate the baseline

`server/.dependency-cruiser-known-violations.json` freezes the 24 violations
that predate the gate. **Regenerating it to silence a failure is forbidden.**
The baseline may only shrink. If `arch:check` fails on code you did not touch,
report it — do not widen the baseline.

Those 24 are an inventory of what the gate can *see*, not of the codebase. The
`CORE` pattern is four literal filenames one directory deep
(`modules/<m>/{service,helpers,domain,ports}.ts`), so files like
`reviews/run-executor.ts`, `pulls/status.ts`, everything under
`repo-intel/pipeline/`, and the `reviews/repository/*.repo.ts` split match no
core rule at all — a clean `arch:check` is not a clean bill of health for them.
`rules/layers.md` lists the gaps.

If a rule is genuinely wrong (it forbids a legitimate import), change the rule in
`server/.dependency-cruiser.cjs` with a comment explaining why, rather than
adding a one-off baseline entry.

### When `no-circular` fires on a brand-new module

Expect this, and do **not** baseline it. `tsPreCompilationDeps: true` makes
type-only edges visible, so a module written exactly the way `rules/layers.md`'s
matrix describes can still close a cycle on day one: if the row type lives in
`repository.ts`, then `helpers.ts` type-imports it while `repository.ts`
value-imports a helper, and that is a cycle even though nothing cycles at
runtime. `modules/agents` is the frozen example of precisely this.

**The cycle is a symptom; the fix is structural.** Declare the shared row and
domain types in the module's `domain.ts` — then `helpers.ts` imports `domain.ts`,
`repository.ts` imports both, and the cycle is gone. That is what law 3 asks for
anyway. Do not relax the rule with `dependencyTypesNot: ['type-only']` either:
that would also blind it to the four real `repo-intel` cycles, which are runtime
cycles through the composition root.

Seeing `ERROR: Can't open '.dependency-cruiser-known-violations.json' for
reading`? That is a missing baseline, not a broken config. Run
`pnpm arch:baseline`.

A Drizzle version bump invalidates the baseline entries that point at the
pnpm-hashed `node_modules/.pnpm/drizzle-orm@<version>_…` path. Regenerate the
baseline as part of the bump.

## When NOT to apply this

A thin read-only endpoint (`modules/workspace/routes.ts`) does not need
`domain.ts` and `ports.ts`. Adding them there is exactly the boilerplate Clean
Architecture is fairly criticised for.

A port earns its place when one of these is true:

- there are, or will imminently be, **two implementations**;
- it crosses a **real I/O boundary** (network, disk, database, LLM);
- it guards a **business rule that must be tested without a database**.

None of the three? Write the straightforward code. See `references.md` for the
counter-argument literature.

## Deeper rules

- `rules/layers.md` — the who-may-import-whom matrix
- `rules/di-container.md` — the composition root; `Deps` instead of `Container`
- `rules/fastify.md` — routes as driving adapters
- `rules/drizzle.md` — repositories, transactions, row leaks
- `rules/zod-contracts.md` — validation vs. domain types
- `rules/llm-adapters.md` — `LLMProvider`, grounding, cost
- `rules/testing.md` — testing the core without a database
- `examples/before-after.md` — the `agents` module, both ways
- `references.md` — sources
