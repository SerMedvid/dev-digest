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
   `@anthropic-ai/sdk`, `openai`, or `simple-git`.
   Gate rules: `core-no-persistence`, `core-no-sdk`.
2. **The core takes ports, not `Container`.** Write
   `constructor(private deps: XServiceDeps)` with the interface in the module's
   `ports.ts`. Taking `Container` pulls every adapter into the core *and* closes
   an import cycle through the composition root — four such cycles exist today.
   Gate rules: `core-no-container`, `no-circular`. See `rules/di-container.md`.
3. **Database rows do not leak.** No `$inferSelect` type (`AgentRow`,
   `ReviewRow`, `FindingRow`, `PullRow`) in a service's public signature. The
   repository maps to a domain type. See `rules/drizzle.md`.
4. **No module imports another module's internals.** Shared aggregates
   (`agentsRepo`, `reviewRepo`) come off the container.
   Gate rules: `no-cross-module-internals`, `adapters-no-modules`.

## Which ring does my tool live in?

| Tool | Ring | Rule |
|---|---|---|
| Fastify 5, `@fastify/*` | driving adapter | `routes.ts` / `app.ts` / `server.ts` only. `FastifyRequest`/`Reply` never cross into a service. → `rules/fastify.md` |
| `fastify-type-provider-zod` | driving adapter | Endpoint schemas sit next to the route; they describe the HTTP contract, not the domain. → `rules/zod-contracts.md` |
| Drizzle, `postgres.js` | driven adapter | `repository.ts` and `db/` only. Transactions stay inside the repository; a `tx` handle never enters a service. → `rules/drizzle.md` |
| Zod 3 | boundary only | Edge validation and LLM structured-output contracts. Domain types are plain TS. → `rules/zod-contracts.md` |
| `@anthropic-ai/sdk`, `openai`, OpenRouter | driven adapter | `adapters/llm/*` only; the core knows `LLMProvider`. → `rules/llm-adapters.md` |
| `octokit`, `simple-git`, ripgrep, ast-grep, `js-tiktoken` | driven adapters | Behind `GitHubClient`, `GitClient`, `CodeIndex`, `DepGraph`, `Tokenizer`. An SDK type never appears in a service signature. |
| `p-queue` / `jobs` / SSE `runBus` | platform | The core sees narrow interfaces (`Logger`, a publisher), as `modules/reviews/run-executor.ts` already does. Background work goes through `container.jobs`, never a bare floating promise. |
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

If a rule is genuinely wrong (it forbids a legitimate import), change the rule in
`server/.dependency-cruiser.cjs` with a comment explaining why, rather than
adding a one-off baseline entry.

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
