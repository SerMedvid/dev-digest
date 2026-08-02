# Onion Architecture Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `.claude/skills/onion-architecture/` skill that makes the Onion
dependency rule the default for `server/` work, backed by a `dependency-cruiser`
gate that fails on new violations.

**Architecture:** The skill formalises the module shape `server/CLAUDE.md`
already describes (`routes → service → repository → adapters → platform`) in
Onion terms, maps each backend tool to the ring it may live in, and enforces four
laws with `depcruise`. Existing violations are frozen in a known-violations
baseline so the gate is green on `main` from day one.

**Tech Stack:** Markdown skill files; `dependency-cruiser` 17.4 (already a
`server/` dependency, binaries in `server/node_modules/.bin`); pnpm scripts.

**Spec:** [`docs/superpowers/specs/2026-08-02-onion-architecture-skill-design.md`](../specs/2026-08-02-onion-architecture-skill-design.md)

## Global Constraints

- **Scope is `server/` only.** Do not add rules, scripts, or config to
  `reviewer-core/`, `client/`, or `e2e/`.
- **`server/` uses pnpm.** Never run `npm install` there — it writes a second
  lockfile.
- **No new dependencies.** `dependency-cruiser` 17.4.3 is already in
  `server/package.json`; the binaries `depcruise` and `depcruise-baseline` exist
  in `server/node_modules/.bin`.
- **No CI changes.** The gate is local-only, by decision.
- **No source refactoring.** Do not change any `server/src/**/*.ts` file except
  where a task says so explicitly. The eight `Container`/direct-DB violations
  stay as they are; the baseline exists for that reason.
- **`tsPreCompilationDeps: true` is mandatory** in the depcruise config. Without
  it, `import type { … }` lines are invisible and half the rules silently pass.
- **Skill files follow the existing convention** in `.claude/skills/`: a
  `SKILL.md` with YAML frontmatter carrying `name`, `description`, and
  `allowed-tools`, plus `rules/*.md` (see `.claude/skills/fastify-best-practices/`).
- **Paths in rules files must name real files** in `server/src`. Generic advice
  with no file reference is a review rejection.
- Commit style: conventional commits with a scope, `why` in the body.

---

### Task 1: The depcruise architecture gate

This is the only task with executable behaviour. Everything after it is
documentation that describes what this gate enforces, so it goes first.

**Files:**
- Create: `server/.dependency-cruiser.cjs`
- Create: `server/.dependency-cruiser-known-violations.json` (generated)
- Modify: `server/package.json` (scripts block)

**Interfaces:**
- Consumes: nothing.
- Produces: two pnpm scripts that later tasks reference by name —
  `pnpm arch:check` (validate, honouring the baseline) and
  `pnpm arch:baseline` (regenerate the baseline). Rule names produced here are
  cited verbatim by Task 3: `core-no-container`, `core-no-persistence`,
  `core-no-sdk`, `routes-no-persistence`, `no-cross-module-internals`,
  `adapters-no-modules`, `no-circular`, `no-orphans`.

- [ ] **Step 1: Write the config**

Create `server/.dependency-cruiser.cjs`:

```js
/**
 * Architecture gate — the Onion dependency rule for server/src.
 * See .claude/skills/onion-architecture/SKILL.md for the reasoning.
 *
 * Run with `pnpm arch:check`. Violations that predate the gate are frozen in
 * .dependency-cruiser-known-violations.json; regenerate ONLY when the count
 * goes down (`pnpm arch:baseline`).
 *
 * Note: dependency-cruiser is also used as a *product feature* by
 * src/adapters/depgraph — that usage is unrelated to this config.
 */

/** The application core: rings that may not depend on anything outward. */
const CORE = '^src/modules/[^/]+/(service|helpers|domain|ports)\\.ts$';

module.exports = {
  forbidden: [
    {
      name: 'core-no-container',
      comment:
        'A service taking the concrete Container depends on the composition ' +
        'root, which imports every adapter — and it closes an import cycle. ' +
        'Take a narrow Deps interface from the module ports.ts instead.',
      severity: 'error',
      from: { path: CORE },
      to: { path: '^src/platform/container\\.ts$' },
    },
    {
      name: 'core-no-persistence',
      comment:
        'Only repository.ts may know the database. db/client.ts is exempt: it ' +
        'is the Db type a repository constructor takes.',
      severity: 'error',
      from: { path: CORE },
      to: { path: '^src/db/', pathNot: '^src/db/client\\.ts$' },
    },
    {
      name: 'core-no-sdk',
      comment:
        'Third-party SDKs belong in adapters, behind a port from ' +
        '@devdigest/shared. The core never sees an SDK type.',
      severity: 'error',
      from: { path: CORE },
      to: {
        path:
          'node_modules/(drizzle-orm|postgres|fastify|octokit|simple-git|@anthropic-ai|openai)/',
      },
    },
    {
      name: 'routes-no-persistence',
      comment:
        'A route is a driving adapter: parse, call one use-case, map to a DTO. ' +
        'Reaching the database from a route skips the core entirely.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/routes\\.ts$' },
      to: { path: '^src/db/|node_modules/drizzle-orm/' },
    },
    {
      name: 'no-cross-module-internals',
      comment:
        'A module never imports another module s internals. Shared aggregates ' +
        'are constructed in the container; _shared is the only common ground.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/',
        pathNot: ['^src/modules/$1/', '^src/modules/_shared/'],
      },
    },
    {
      name: 'adapters-no-modules',
      comment:
        'Adapters are the outermost ring. An adapter importing a module ' +
        'inverts the dependency rule.',
      severity: 'error',
      from: { path: '^src/adapters/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'no-circular',
      comment: 'A cycle means a boundary is in the wrong place.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment:
        'Weak dead-code signal: only catches files with neither importers nor ' +
        'imports. Kept for hygiene, not relied on.',
      severity: 'error',
      from: { orphan: true, pathNot: '^src/(server|app)\\.ts$' },
      to: {},
    },
  ],
  options: {
    // MANDATORY: without this, `import type { Container }` is invisible and
    // core-no-container silently passes.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    // Tests legitimately reach across every boundary to wire fakes.
    exclude: { path: '\\.test\\.ts$' },
  },
};
```

- [ ] **Step 2: Add the scripts**

In `server/package.json`, add to `"scripts"` after `"typecheck"`:

```json
"arch:check": "depcruise src --config .dependency-cruiser.cjs --output-type err --ignore-known",
"arch:baseline": "depcruise-baseline src --config .dependency-cruiser.cjs",
```

- [ ] **Step 3: Run the rules WITHOUT the baseline — verify 24 violations**

Do **not** use `pnpm arch:check` here. It passes `--ignore-known`, and with no
baseline file yet that fails with
`ERROR: Can't open '.dependency-cruiser-known-violations.json' for reading` and
exit 1 — which looks like a config error but is not.

Run: `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs --output-type err`

Expected: exit code 24, and the last line reads
`x 24 dependency violations (24 errors, 0 warnings). 149 modules, 467 dependencies cruised.`

If the count differs, **stop and report it** — either `src` changed since the
plan was written or `tsPreCompilationDeps` is not taking effect. Do not adjust
the rules to reach 24.

- [ ] **Step 4: Verify the breakdown matches the spec**

Run: `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs --output-type err 2>&1 | grep -oE '^  error [a-z-]+' | sort | uniq -c | sort -rn`

Expected (order may vary):

```
      8   error routes-no-persistence
      5   error no-circular
      4   error core-no-container
      2   error core-no-persistence
      2   error no-cross-module-internals
      2   error adapters-no-modules
      1   error no-orphans
```

- [ ] **Step 5: Generate the baseline**

Run: `cd server && pnpm arch:baseline`

This writes `server/.dependency-cruiser-known-violations.json`.

- [ ] **Step 6: Verify the gate is now green**

Run: `cd server && pnpm arch:check`

Expected: exit 0, output
`✔ no dependency violations found (149 modules, 467 dependencies cruised)`
followed by `‼ 24 known violations ignored.`

- [ ] **Step 7: Verify a NEW violation still fails (the actual test)**

Temporarily add a forbidden import to a core file. Restore with
`git checkout --`, not a copy in a temp directory, so the step works the same on
any OS:

```bash
cd server
printf "\nimport * as __probe from '../../db/schema.js';\nvoid __probe;\n" >> src/modules/agents/helpers.ts
pnpm arch:check; echo "EXIT=$?"
```

Expected: non-zero exit with
`error core-no-persistence: src/modules/agents/helpers.ts → src/db/schema.ts`

This is the whole point of the task. If it exits 0, the baseline is matching too
broadly and the gate is worthless — stop and report.

- [ ] **Step 8: Restore the probe file**

```bash
cd server
git checkout -- src/modules/agents/helpers.ts
git diff --exit-code src/modules/agents/helpers.ts && echo "clean"
pnpm arch:check; echo "EXIT=$?"
```

Expected: `clean`, then exit 0.

- [ ] **Step 9: Confirm nothing else broke**

Run: `cd server && pnpm typecheck`

Expected: no output, exit 0. (The config is `.cjs` and outside `include`, so this
should be unaffected — confirm rather than assume.)

- [ ] **Step 10: Commit**

```bash
git add server/.dependency-cruiser.cjs server/.dependency-cruiser-known-violations.json server/package.json
git commit -m "feat(server): add a dependency-cruiser architecture gate

Encodes the Onion dependency rule for src as depcruise forbidden rules:
the core may not import the container, the database, or a vendor SDK; routes
may not reach persistence; adapters may not import modules; no cycles.

The 24 violations that predate the gate are frozen in a known-violations
baseline, so arch:check is green on main and only new drift fails.

tsPreCompilationDeps is on deliberately: without it every 'import type'
is invisible and core-no-container passes on code that violates it."
```

---

### Task 2: SKILL.md and references.md

**Files:**
- Create: `.claude/skills/onion-architecture/SKILL.md`
- Create: `.claude/skills/onion-architecture/references.md`

**Interfaces:**
- Consumes: the script names and rule names from Task 1.
- Produces: the seven `rules/*.md` filenames that Tasks 3–5 create, linked from
  `SKILL.md`. Tasks 3–5 must use exactly these names:
  `layers.md`, `di-container.md`, `fastify.md`, `drizzle.md`,
  `zod-contracts.md`, `llm-adapters.md`, `testing.md`.

- [ ] **Step 1: Write `SKILL.md`**

```markdown
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
```

- [ ] **Step 2: Write `references.md`**

Copy the entire "References" section from the spec
(`docs/superpowers/specs/2026-08-02-onion-architecture-skill-design.md`) verbatim,
under a `# References` heading with this preamble:

```markdown
# References

Sources behind this skill. The counter-arguments section is not decoration —
read it before adding a layer.
```

Keep all five groups and every link: Onion/Hexagonal canon (Palermo parts 1–4,
Graça, NDepend, Drotbohm, dev.to, TopicTrick), Node/TypeScript, Persistence
(Sentry atomic repositories, Drizzle repository pattern, DDD Unit of Work,
DDD transactions, Drizzle best practices), Machine enforcement (depcruise rules
reference, Xebia, Atomic Object, dev.to cross-module, eslint-plugin-boundaries),
and Counter-arguments (Bogard, CodeOpinion, Hickey, earezki).

- [ ] **Step 3: Verify the frontmatter parses**

Run: `cd d:/Projects/neo/dev-digest && head -5 .claude/skills/onion-architecture/SKILL.md`

Expected: a `---` line, then `name: onion-architecture`, a one-line
`description:`, `allowed-tools:`, then `---`. The `description` must be a single
line — a wrapped line breaks skill discovery.

- [ ] **Step 4: Verify every internal link resolves**

Run:

```bash
cd d:/Projects/neo/dev-digest/.claude/skills/onion-architecture
grep -oE '(rules|examples)/[a-z-]+\.md' SKILL.md | sort -u
```

Expected: the seven `rules/*.md` names listed in the Interfaces block above, plus
`examples/before-after.md`. These files do not exist yet — Tasks 3–6 create them
under exactly these names.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/onion-architecture/SKILL.md .claude/skills/onion-architecture/references.md
git commit -m "feat(skills): add the onion-architecture skill entry point

SKILL.md carries the dependency law, the tool-to-ring table for our Fastify /
Drizzle / Zod / LLM-SDK stack, the mandatory checklist, and the arch:check gate.
references.md collects the sources, including the vertical-slice counter-
arguments the 'when not to apply' threshold is built on."
```

---

### Task 3: rules/layers.md and rules/di-container.md

The two rules files that carry the laws. Written together because
`di-container.md` is the fix for the violation `layers.md` names.

**Files:**
- Create: `.claude/skills/onion-architecture/rules/layers.md`
- Create: `.claude/skills/onion-architecture/rules/di-container.md`

**Interfaces:**
- Consumes: rule names from Task 1; the ring diagram and four laws from Task 2.
- Produces: the `AgentsServiceDeps` interface name and shape, reused verbatim by
  Task 6's before/after example:

```ts
export interface AgentsServiceDeps {
  agents: AgentsRepositoryPort;
  llm(provider: Provider): Promise<LLMProvider>;
}
```

- [ ] **Step 1: Write `rules/layers.md`**

Content, in this order:

1. **The matrix.** A table with a row per file kind and the exact import
   allowances:

   | File | May import | May NOT import |
   |---|---|---|
   | `modules/<m>/routes.ts` | own `service.ts`, `_shared/context.ts`, `_shared/schemas.ts`, `platform/errors.ts`, `fastify`, `zod`, `@devdigest/shared` | `db/*`, `drizzle-orm`, another module's files, `adapters/*` |
   | `modules/<m>/service.ts` | own `ports.ts`, `domain.ts`, `helpers.ts`, `constants.ts`, `@devdigest/shared`, `platform/errors.ts` | `platform/container.ts`, `db/*`, any vendor SDK, another module |
   | `modules/<m>/ports.ts` | `@devdigest/shared`, own `domain.ts` | everything else |
   | `modules/<m>/domain.ts`, `helpers.ts` | own `constants.ts`, `@devdigest/shared` | anything with I/O |
   | `modules/<m>/repository.ts` | `db/client.ts`, `db/schema.ts`, `db/rows.ts`, `drizzle-orm`, own `ports.ts`, own `domain.ts` | `fastify`, another module's repository |
   | `adapters/<x>/` | vendor SDK, `@devdigest/shared` | `modules/*` |
   | `platform/container.ts` | everything (it is the composition root) | — |

2. **How to name a file's ring** — a three-question decision procedure: does it
   touch I/O (driven adapter); does the outside world call it (driving adapter);
   neither (core).

3. **The gate rules that back each row**, by name: `core-no-container`,
   `core-no-persistence`, `core-no-sdk`, `routes-no-persistence`,
   `no-cross-module-internals`, `adapters-no-modules`, `no-circular`.

4. **The known exceptions**, quoting the baseline table from the spec, with the
   sentence: *these files predate the gate; do not copy them, and clean the one
   you are touching.*

5. **`db/client.ts` is deliberately exempt** from `core-no-persistence` because
   it exports the `Db` type a repository constructor takes.

- [ ] **Step 2: Write `rules/di-container.md`**

Content, in this order:

1. **The rule.** `platform/container.ts` is the composition root — the only
   place allowed to know both a service and its adapters. A service takes a
   narrow `Deps` interface from its own `ports.ts`.

2. **Why, concretely.** Show the cycle the gate found:

   ```
   src/modules/repo-intel/service.ts → src/platform/container.ts → src/modules/repo-intel/service.ts
   ```

   State that `Container` imports every adapter and two module repositories, so
   `constructor(private container: Container)` drags the entire outer ring into
   the core.

3. **The shape.** In `modules/agents/ports.ts`:

   ```ts
   import type { LLMProvider, Provider, Agent, AgentVersion } from '@devdigest/shared';
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

4. **The wiring**, in `platform/container.ts`:

   ```ts
   get agentsServiceDeps(): AgentsServiceDeps {
     return { agents: this.agentsRepo, llm: (p) => this.llm(p) };
   }
   ```

   with the note that the getter — not the service — is what the container
   exposes, and that `ContainerOverrides` already exists for tests to swap
   adapters.

5. **Adding a new adapter** — the four steps that already live in
   `server/CLAUDE.md`: interface into `@devdigest/shared`, getter on the
   container, key on `ContainerOverrides`, mock in `adapters/mocks.ts`. Link to
   `server/CLAUDE.md` rather than restating the detail.

6. **The two-copies trap.** `@devdigest/shared` resolves to
   `server/src/vendor/shared/` for `server/` and `reviewer-core/`, but
   `client/src/vendor/shared/` for `client/`. A port added to one copy must be
   added to the other, and both packages type-checked.

- [ ] **Step 3: Verify every file path named in both files exists**

```bash
cd d:/Projects/neo/dev-digest
grep -ohE '(src|server/src)/[a-zA-Z0-9_/.-]+\.ts' .claude/skills/onion-architecture/rules/layers.md .claude/skills/onion-architecture/rules/di-container.md \
  | sed 's|^src/|server/src/|' | sort -u | while read -r f; do
      [ -e "$f" ] || echo "MISSING: $f"
    done; echo "done"
```

Expected: `done` with no `MISSING:` lines. (`modules/agents/ports.ts` and
`domain.ts` are proposed, not existing — if they appear, reword those mentions so
they are not written as `.ts` paths, or accept the two known misses and note them
in the commit body.)

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/onion-architecture/rules/layers.md .claude/skills/onion-architecture/rules/di-container.md
git commit -m "docs(skills): onion-architecture layer matrix and DI rules

layers.md is the who-may-import-whom table, one row per file kind, each backed
by a named depcruise rule. di-container.md is the fix for the biggest current
violation: services take a narrow Deps interface, not the concrete Container,
which is what closes the four import cycles the gate found."
```

---

### Task 4: rules/fastify.md, rules/drizzle.md, rules/zod-contracts.md

**Files:**
- Create: `.claude/skills/onion-architecture/rules/fastify.md`
- Create: `.claude/skills/onion-architecture/rules/drizzle.md`
- Create: `.claude/skills/onion-architecture/rules/zod-contracts.md`

**Interfaces:**
- Consumes: the layer matrix from Task 3; rule names from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write `rules/fastify.md`**

1. **Routes are driving adapters.** A route does four things and nothing else:
   validate input, resolve context, call **one** use-case, map the result to a
   DTO. Anything else belongs in the service.
2. **`FastifyRequest` / `FastifyReply` stop at the route.** A service signature
   never mentions them. `getContext(container, req)`
   (`modules/_shared/context.ts`) returns `{ workspaceId, userId }`, and those
   travel onward as plain string arguments.
3. **Workspace scoping is load-bearing.** Quote `server/CLAUDE.md`: a query
   without `workspaceId` is a bug, not a shortcut. Auth being a stub today does
   not change that.
4. **Registration stays static.** One import plus one entry in
   `src/modules/index.ts`. Do not switch to `@fastify/autoload` or a dynamic
   `import()` of a `.ts` file, despite the dependency being present — the static
   form is what works identically under tsx, vitest, and a bundler.
5. **Errors.** Throw `AppError` / `NotFoundError` from `platform/errors.ts`; the
   handler in `src/app.ts` maps them. Do not hand-build status codes in a route.
   Note the shape-matching ZodError check in `app.ts` and why it must stay (two
   physical `zod` installs, so `instanceof` can be false across the boundary).
6. **The four known offenders**: `polling`, `pulls`, `settings`, `workspace`
   routes query Drizzle directly and are in the baseline. Do not copy them.
7. Point to the `fastify-best-practices` skill for hooks, serialization, and
   plugin mechanics — this file is only about the boundary.

- [ ] **Step 2: Write `rules/drizzle.md`**

1. **The repository is the only place that knows SQL** for its domain.
2. **Rows do not leak.** `$inferSelect` aliases (`AgentRow`, `ReviewRow`,
   `FindingRow`, `PullRow` from `db/rows.ts`) may appear inside the module, but
   not in a signature a route consumes. Map with `helpers.ts` — the pattern
   `toAgentDto` / `reviewToDto` already uses.
3. **Transactions stay inside the repository.** A `tx` handle is never a service
   parameter. When one use-case must span repositories, the composition root
   passes a Unit-of-Work callback; cite the Sentry atomic-repositories article
   from `references.md`.
4. **Migrations are not applied on boot** — `pnpm db:migrate`; any
   `relation … does not exist` is that. Never hand-edit an applied migration in
   `src/db/migrations/`; change `src/db/schema/*.ts` and run `pnpm db:generate`.
   Never `docker compose down -v`.
5. **The facade pattern is legitimate.** `modules/reviews/repository.ts`
   composing `repository/*.repo.ts` is deliberate; both are meant to exist. Use
   it when a domain's queries outgrow one file.
6. **`db/client.ts` is exempt** from `core-no-persistence` — it exports the `Db`
   type, not queries.
7. Point to `drizzle-orm-patterns` and `postgresql-table-design` for query and
   schema mechanics.

- [ ] **Step 3: Write `rules/zod-contracts.md`**

1. **Zod lives at boundaries, never in the domain.** Domain types are plain TS
   types in `domain.ts`. A Zod schema in a service signature means the boundary
   moved inward.
2. **Two distinct roles.** (a) HTTP edge validation, next to the route, via
   `fastify-type-provider-zod`; (b) LLM structured-output contracts passed to
   `completeStructured({ schema })`. They are different contracts and must not
   be shared just because the shapes look alike.
3. **Shared contracts** live in `src/vendor/shared/contracts/*.ts` — name the
   contract instead of restating field lists.
4. **The two-copies trap**, stated concretely: `@devdigest/shared` is two
   physical directories, `adapters.ts`, `contracts/trace.ts`, `knowledge.ts`,
   `eval-ci.ts`, and `productionize.ts` have already drifted, and the client copy
   is behind. Change a shared contract → edit both files → typecheck both
   packages. Never add a cross-package `instanceof` check on a library class.
5. Point to the `zod` skill for schema mechanics.

- [ ] **Step 4: Verify the file paths named across the three files exist**

```bash
cd d:/Projects/neo/dev-digest
grep -ohE 'src/[a-zA-Z0-9_/.-]+\.ts' .claude/skills/onion-architecture/rules/{fastify,drizzle,zod-contracts}.md \
  | sed 's|^src/|server/src/|' | sort -u | while read -r f; do
      [ -e "$f" ] || echo "MISSING: $f"
    done; echo "done"
```

Expected: `done`, no `MISSING:` lines.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/onion-architecture/rules/fastify.md .claude/skills/onion-architecture/rules/drizzle.md .claude/skills/onion-architecture/rules/zod-contracts.md
git commit -m "docs(skills): onion rules for Fastify, Drizzle and Zod

One file per tool, each answering the same question: where is the boundary and
what may not cross it. These defer to the existing per-tool skills for mechanics
and only cover placement in the rings."
```

---

### Task 5: rules/llm-adapters.md and rules/testing.md

**Files:**
- Create: `.claude/skills/onion-architecture/rules/llm-adapters.md`
- Create: `.claude/skills/onion-architecture/rules/testing.md`

**Interfaces:**
- Consumes: the `LLMProvider` port from `src/vendor/shared/adapters.ts`; rule
  names from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write `rules/llm-adapters.md`**

1. **`@anthropic-ai/sdk`, `openai`, and the OpenRouter provider are confined to
   `src/adapters/llm/*`.** The core knows one interface: `LLMProvider` from
   `@devdigest/shared` (`completeStructured`, `listModels`).
2. **What belongs in the adapter, not the use-case:** model selection, retries
   and backoff (`platform/resilience.ts`), token counting (`Tokenizer` port over
   `js-tiktoken`), and cost estimation (`adapters/llm/pricing.ts` +
   `platform/price-book.ts`).
3. **What belongs in the core:** prompt assembly, the grounding gate, and what
   to do with a finding that fails it. These are business rules and must be
   testable with a fake `LLMProvider`.
4. **Degradation is a domain decision.** Enrichment is best-effort: a repo-intel
   failure degrades to "section omitted" and logs to the run log; it never fails
   the review. `listModels` degrades to `[]` when no key is configured, so the
   editor still renders.
5. **Every terminal path persists.** Success, failure, and cancel each write a
   status *and* a `run_traces` document, or the UI shows a run stuck at
   "running" after reload. Cancellation is in-memory only (a `Set` in `RunBus`)
   and does not survive a restart.
6. **Secrets only via `container.secrets`.** `process.env` is read in exactly
   two places — `platform/config.ts` and `adapters/secrets/local.ts`. Do not add
   a third. After writing a key, call `container.invalidateSecretCaches()`.
7. Point to the `claude-api` skill for model IDs, pricing, and API parameters.

- [ ] **Step 2: Write `rules/testing.md`**

1. **The test tells you if the boundary is right.** If testing a business rule
   needs Docker, the rule is in the wrong ring.
2. **Core tests take fakes, not mocks of concrete classes.** Because the service
   takes a `Deps` object, the fake is an object literal:

   ```ts
   const deps: AgentsServiceDeps = {
     agents: { list: async () => [], /* … */ } as AgentsRepositoryPort,
     llm: async () => fakeLLM,
   };
   const service = new AgentsService(deps);
   ```

   Contrast with the current form, where a test must build a whole `Container`.
3. **`*.it.test.ts` means DB-backed** — testcontainers Postgres, self-skips
   without Docker. Any test importing `test/helpers/pg.ts` must carry that
   suffix or it breaks the unit lane's `--exclude` glob:
   `pnpm exec vitest run --exclude '**/*.it.test.ts'`.
4. **Everything else is hermetic** — go through `src/adapters/mocks.ts`, never
   real keys or network.
5. **`ContainerOverrides` is for adapter-level tests**, not a substitute for a
   `Deps` fake in a unit test.
6. **Before saying it works:** `pnpm typecheck`, the hermetic lane, and
   `pnpm arch:check`. Note that `pnpm typecheck` also type-checks
   `../reviewer-core/src` through the alias.
7. Point to `TESTING.md` at the repo root for the suite-per-package strategy.

- [ ] **Step 3: Verify referenced paths and scripts exist**

```bash
cd d:/Projects/neo/dev-digest
ls server/src/adapters/llm/ server/src/adapters/mocks.ts server/test/helpers/pg.ts server/src/platform/price-book.ts server/src/platform/resilience.ts 2>&1
grep -n '"arch:check"\|"typecheck"' server/package.json
```

Expected: every path listed without error, and both scripts present. If
`server/test/helpers/pg.ts` is at a different path, correct the rules file to
match reality rather than the plan.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/onion-architecture/rules/llm-adapters.md .claude/skills/onion-architecture/rules/testing.md
git commit -m "docs(skills): onion rules for LLM adapters and testing

llm-adapters.md draws the line between adapter concerns (model choice, retries,
cost) and core concerns (prompt assembly, the grounding gate, degradation
policy). testing.md makes the payoff explicit: a Deps object is fakeable with an
object literal, so business rules get tested without Docker."
```

---

### Task 6: examples/before-after.md

**Files:**
- Create: `.claude/skills/onion-architecture/examples/before-after.md`
- Read for reference: `server/src/modules/agents/service.ts`,
  `server/src/modules/agents/repository.ts`,
  `server/src/platform/container.ts`

**Interfaces:**
- Consumes: `AgentsServiceDeps` and `AgentsRepositoryPort` exactly as defined in
  Task 3, Step 2. Do not rename them.
- Produces: nothing.

- [ ] **Step 1: Capture the "before" from the real file**

Read `server/src/modules/agents/service.ts` and quote the actual current code —
do not paraphrase:

```ts
import type { Container } from '../../platform/container.js';
import { AgentsRepository } from './repository.js';

export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toAgentDto);
  }

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

Annotate the three problems: the type-only `Container` import is still a real
dependency edge (which is why the gate needs `tsPreCompilationDeps`); the service
constructs its own persistence adapter; the whole outer ring is reachable from
the core through `container`.

- [ ] **Step 2: Write the "after"**

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

- [ ] **Step 3: Show the container side**

```ts
// platform/container.ts — the composition root, and the only place that knows both sides.
get agentsServiceDeps(): AgentsServiceDeps {
  return { agents: this.agentsRepo, llm: (p) => this.llm(p) };
}
```

And the route side, unchanged in shape:

```ts
// modules/agents/routes.ts
const service = new AgentsService(container.agentsServiceDeps);
```

- [ ] **Step 4: Show what the change buys, as a test**

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

- [ ] **Step 5: State what is deliberately NOT changed**

`AgentsRepository` keeps returning `AgentRow`. Law 3 is about the *service's*
public signature, and `AgentsService.list` already returns `Agent`, not
`AgentRow`. Mapping happens in `helpers.ts`. Do not invent a domain entity class
where a mapped DTO already does the job.

Also note explicitly: this example is **documentation, not a merged refactor** —
`agents/service.ts` still takes `Container` on `main`, and that violation is in
the baseline.

- [ ] **Step 6: Verify the quoted "before" still matches the real file**

```bash
cd d:/Projects/neo/dev-digest
grep -n "constructor(private container: Container)" server/src/modules/agents/service.ts
grep -n "this.repo = new AgentsRepository(container.db)" server/src/modules/agents/service.ts
```

Expected: both found. If not, re-quote from the current file — a stale example is
worse than none.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/onion-architecture/examples/before-after.md
git commit -m "docs(skills): before/after refactor of the agents module

Uses the smallest of the four Container-taking services to show the Deps shape
end to end: ports.ts, the service, the container getter, the route, and the unit
test that becomes possible. Documentation only — the refactor itself is out of
scope and stays in the baseline."
```

---

### Task 7: Wire the skill into the repo's own docs

**Files:**
- Modify: `.claude/skills/README.md` (catalog table)
- Modify: `server/CLAUDE.md` (the "Layering — non-negotiable" section, lines 23–38)

**Interfaces:**
- Consumes: the skill directory from Tasks 2–6; the scripts from Task 1.
- Produces: nothing.

- [ ] **Step 1: Add the catalog row**

In `.claude/skills/README.md`, add as the **first** row of the Catalog table
(before `fastify-best-practices`, since it governs the others):

```markdown
| [onion-architecture](onion-architecture/SKILL.md) | Backend | Onion dependency rule for `server/`: rings, ports, the composition root, and the `arch:check` gate |
```

- [ ] **Step 2: Point `server/CLAUDE.md` at the skill**

Append to the "Layering — non-negotiable" section, after the existing bullet
list that ends with the `agentsRepo`/`reviewRepo` sentence:

```markdown
This layering is the Onion dependency rule, and it is now enforced:
`pnpm arch:check` (config in [`.dependency-cruiser.cjs`](.dependency-cruiser.cjs))
fails on new violations. The 24 that predate the gate are frozen in
`.dependency-cruiser-known-violations.json` — do not regenerate it to silence a
failure. The full rules, the tool-to-ring map, and the `Deps`-instead-of-
`Container` pattern live in the `onion-architecture` skill.
```

- [ ] **Step 3: Verify the whole skill is complete and coherent**

```bash
cd d:/Projects/neo/dev-digest/.claude/skills/onion-architecture
find . -type f | sort
```

Expected exactly:

```
./SKILL.md
./examples/before-after.md
./references.md
./rules/di-container.md
./rules/drizzle.md
./rules/fastify.md
./rules/layers.md
./rules/llm-adapters.md
./rules/testing.md
./rules/zod-contracts.md
```

- [ ] **Step 4: Verify no link in the skill is dangling**

```bash
cd d:/Projects/neo/dev-digest/.claude/skills/onion-architecture
grep -rohE '\]\(([a-z./-]+\.md)\)' . | sed -E 's/^\]\((.*)\)$/\1/' | sort -u | while read -r f; do
  [ -e "$f" ] || echo "DANGLING: $f"
done; echo "done"
```

Expected: `done`, no `DANGLING:` lines.

- [ ] **Step 5: Final gate run**

```bash
cd d:/Projects/neo/dev-digest/server
pnpm arch:check; echo "EXIT=$?"
pnpm typecheck; echo "EXIT=$?"
pnpm exec vitest run --exclude '**/*.it.test.ts' 2>&1 | tail -5
```

Expected: `arch:check` exit 0 with 24 known violations ignored; `typecheck`
exit 0; the hermetic test lane passing at whatever its pre-existing baseline is
(this plan changes no source, so any failure here predates the work — report it,
do not fix it inside this task).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/README.md server/CLAUDE.md
git commit -m "docs: wire the onion-architecture skill into the skill catalog

server/CLAUDE.md described the layering but nothing pointed at an enforcement
mechanism. It now names arch:check and the baseline, and defers the detail to
the skill so the two do not drift into two half-descriptions."
```

---

## Verification summary

The work is done when all of these hold:

| Check | Command | Expected |
|---|---|---|
| Gate is green on unmodified source | `cd server && pnpm arch:check` | exit 0, `24 known violations ignored` |
| Gate catches new drift | Task 1 Step 7 probe | non-zero exit, names `core-no-persistence` |
| Types still fine | `cd server && pnpm typecheck` | exit 0 |
| Skill is complete | Task 7 Step 3 | exactly ten files |
| No dangling links | Task 7 Step 4 | no `DANGLING:` output |
| Source untouched | `git diff --stat main -- server/src` | empty |

## Out of scope (do not do these)

- Refactoring the four services off `Container`, or the four routes off direct
  Drizzle. That is what the baseline is for.
- Adding `arch:check` to CI.
- Adding ESLint or `eslint-plugin-boundaries` to `server/`.
- Touching `reviewer-core/`, `client/`, or `e2e/`.
- Creating `ports.ts` or `domain.ts` files in any module. Task 3 and Task 6 show
  them as examples in markdown; they are not created on disk by this plan.
