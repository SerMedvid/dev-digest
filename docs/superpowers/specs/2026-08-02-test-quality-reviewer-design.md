# Design — Test Quality Reviewer (a fourth built-in agent)

Date: 2026-08-02
Revised: 2026-08-03 — the domain rules are **pluggable skills**, not prompt text.
Status: approved, not yet implemented

## Problem

The three built-in reviewers all judge production code. Nothing judges the
*tests* in a diff, so the failure modes that make a suite lie go unremarked:

- a test that cannot fail — no assertion, an assertion on the mock instead of
  the subject, an un-awaited async expectation;
- `.only` left behind, which silently stops the rest of the file from running
  in CI;
- corner cases the author didn't think of — error paths, boundaries, empty and
  null, concurrent access;
- mocking so deep the test would survive a full rewrite of the code it covers;
- constructs that make a test flaky — real clocks, real network, inter-test
  order dependence.

A green suite that asserts nothing is worse than no suite: it converts "untested"
into "believed tested".

## Goal

A fourth built-in reviewer agent, **Test Quality Reviewer**, that reviews the
test dimension of a PR diff at the same precision bar as the existing three, and
blocks a merge only for tests that create false confidence or quietly shrink what
CI runs.

**What it looks for is not baked into its prompt.** The agent ships as a thin
shell — how to reason, how to rate, how to report — and the subject-matter rules
arrive as **linked skills**, editable in the Skills library without touching a
prompt constant, a migration, or a deploy.

## Decisions

| Question | Decision |
|---|---|
| Form | A **built-in agent**. Follows General/Security/Performance exactly: a canonical `.md`, a prompt constant, a seeded row. It gets its own model call, its own findings and its own verdict. |
| Where the rules live | **Pluggable skills, not prompt text.** The four subject areas (coverage gaps, edge cases, mocking, flakiness) are seeded `skills` rows linked to the agent, injected at review time under `## Skills / rules`. Editing a rule is a Skills-library edit; adding a fifth area is a new skill, not a prompt rewrite. |
| What stays native | **Role, How to analyze, Quality bar, the severity table, Verdict, Findings discipline.** Severity maps to the output schema and decides `request_changes`, so it cannot be delegated to text a user may unlink. The five concrete `CRITICAL` items stay with it. |
| Coverage philosophy | **Risk-based.** Flag an untested branch only when skipping it leaves a regression class that matters. Never report a coverage percentage, and never flag an untested trivial mapper, getter or constant. Aligns with `TESTING.md` ("typological, not exhaustive"). Enforced inside the `uncovered-branches` skill. |
| What blocks a merge | **False confidence and silenced CI only.** Missed corner cases, over-mocking and risk-based gaps are WARNING at most. Consistent with `pr-self-review`'s `blockers.md`, which already lists "a missing test" as an explicit non-blocker. |
| Stack specificity | **Agnostic core + a hedged `Stack context` section**, mirroring `performance-reviewer.md`'s "assume this unless the diff shows otherwise". The agent reviews *imported* repos, which may be any stack. |
| Enabled by default | **Yes**, like the other three. Accepted consequence: "Review all" fans out to every enabled agent, so this adds a 4th model call per PR — roughly 33% more cost and wall-clock. One toggle on the agent card disables it. |
| Who gets the skills | **The Test Quality Reviewer only.** General/Security/Performance stay on their own remits; a security review that also comments on over-mocking is a diluted security review. |
| Prompt/doc drift | Add a hermetic test asserting each of the four `docs/agent-prompts/*.md` files equals its `seed-prompts.ts` constant. Today the mirror is enforced only by a comment. |

## Out of scope

Coverage tooling or instrumentation of any kind — the agent reads the diff, it
never runs tests, and it must never claim a coverage number. No change to
`reviewer-core`, the output schema, the grounding gate, or the severity enum. No
mutation testing and no test generation. No UI work: the Skills library and the
agent editor's Skills tab already render everything this needs.

---

## Architecture

### 1. Files

No schema change and no new module — the agents list and the skills library are
both DB-driven, so the new reviewer and its rules appear on their own.

| File | Change |
|---|---|
| [`docs/agent-prompts/test-quality-reviewer.md`](../../agent-prompts/test-quality-reviewer.md) | **new** — the canonical, reviewable prose (the shell only) |
| [`server/src/db/seed-prompts.ts`](../../../server/src/db/seed-prompts.ts) | `+ TEST_QUALITY_REVIEWER_PROMPT` |
| [`server/src/db/seed-skills.ts`](../../../server/src/db/seed-skills.ts) | `+ flaky-test-gate`; links retarget to the new agent |
| [`server/src/db/seed.ts`](../../../server/src/db/seed.ts) | `+ 1` entry in `seedAgents` |
| [`docs/agent-prompts/README.md`](../../agent-prompts/README.md) | `+ 1` link, and a note that this agent's checks are skills |
| `server/test/seed-prompts.test.ts` | **new** — the mirror guard |

### 2. The prompt shell

Section-for-section the same shape as `performance-reviewer.md`, minus the
subject-matter body:

```
# Role
# Stack context (assume this unless the diff shows otherwise)
# How to analyze
# Quality bar
# Severity — use exactly these three levels
# Verdict — set `verdict` consistently with your findings
# Findings discipline
```

There is deliberately **no `What to look for`** section. In its place the `Role`
states that the specific checks arrive as rules under `## Skills / rules` in the
user message, that they are to be applied as written, and that their order is the
author's priority order.

`How to analyze` keeps the reasoning that is true of any test review regardless
of which rules are attached: read the test and the code it covers together; ask
what the test would still pass with if the subject were wrong; only flag what
this diff introduced or worsened.

### 3. The skills

Four seeded skills, linked to the agent in this order:

| Order | Skill | Type | Carries |
|---|---|---|---|
| 0 | `uncovered-branches` | `rubric` | Untested branches that matter — error paths, boundaries, degradation, scoping predicates. Bans coverage percentages outright. |
| 1 | `edge-case-coverage` | `rubric` | Numeric, collection, absence, text, time, concurrency and tenancy cases; reports the missing *case*, not a missing file. |
| 2 | `mock-overuse-gate` | `custom` | Subject mocked, call-count assertions where behaviour is observable, stubs that survive a rewrite, mocks encoding a contract reality lacks. |
| 3 | `flaky-test-gate` | `custom` | Real clocks/`Date.now`/`Math.random`, real network, `sleep` as synchronisation, order dependence, shared mutable module state, unawaited promises, fixed ports or paths, locale and timezone assumptions. |

The first three already exist in `seed-skills.ts`. This work adds
`flaky-test-gate` — without it the flakiness dimension is lost, because it is no
longer carried by the prompt — and moves the links from General Reviewer to the
Test Quality Reviewer.

### 4. Severity

The `CRITICAL` list stays in the prompt and stays closed. Anything not on it is
at most WARNING, however serious it reads, and a linked skill **cannot introduce
a new CRITICAL category** — the prompt says so explicitly, because skill bodies
are trusted instructions rendered verbatim.

| Level | Earns it |
|---|---|
| **CRITICAL** (the only level that blocks merge) | `.only` left in the diff; a test that cannot fail; an assertion on the mock instead of the subject; a previously passing test deleted or `.skip`ped in a way that hides the change's effect; a missing `await` on an async assertion |
| **WARNING** | Anything a linked skill reports: an untested risky path, a missed boundary, over-mocking, a flaky construct |
| **SUGGESTION** | Test naming, structure, duplication |

The house rules are repeated verbatim in shape: the verdict is a pure function of
the findings, zero findings is a good answer and means `approve`, every finding
cites a file and line range present in the diff, and `kind` is `"finding"` with
`trifecta_components` / `evidence` left null.

### 5. Seeding

```ts
{
  name: 'Test Quality Reviewer',
  description: 'Judges the tests in a diff. Its checks are linked skills — edit them in the Skills library.',
  provider: DEFAULT_PROVIDER,
  model: DEFAULT_MODEL,
  systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
  enabled: true,
  version: 1,
}
```

`seedAgents` inserts only when no agent of that name exists, so an existing
database picks the reviewer up on the next `pnpm db:seed` and a re-run changes
nothing. No migration.

Two invariants the existing seed already establishes and this work preserves:
every seeded skill writes its `skill_versions` v1 row, and links are inserted as
plain `agent_skills` rows rather than through `setSkills`, which would bump the
agent to v2 while its siblings sit at v1 with no snapshots.

**The seed reconciles its own links.** Inserting the wanted links is not enough:
retargeting `SEED_AGENT_SKILLS` on an already-seeded database would otherwise
leave the previous wiring in place beside the new one — exactly what happened
when these skills moved off the General Reviewer. After the insert pass the seed
deletes every link it no longer wants, **scoped to built-in agent × built-in
skill pairs**. A link involving an agent or a skill the user created is never
considered, so hand-made wiring survives `pnpm db:seed`. The one thing this does
claim is that the seed owns the links *between its own agents and its own
skills*: attaching a built-in skill to a built-in agent by hand will not survive
a re-seed. Verified both directions on 2026-08-03 — stale built-in links are
removed, a custom agent's link to a built-in skill is not.

**Ordering constraint:** the link loop resolves the agent by name, so the Test
Quality Reviewer must be inserted before the skill-link pass runs. It already is
— `seedAgents` precedes the skills block.

### 6. The trade-off this design accepts

A shell agent is only as good as its links. Unlink or disable every skill and the
reviewer keeps its `CRITICAL` rules — `.only`, cannot-fail tests — but loses all
four advisory dimensions and will approve far more than it should. That is the
deliberate cost of making the rules editable without a deploy, and it is why the
blocking rules were kept native rather than pushed into a fifth skill.

## States and degradation

| Situation | Behaviour |
|---|---|
| All four skills linked and enabled (the seeded state) | Full review: blocking rules from the prompt, advisory breadth from the skills, in link order. |
| A skill disabled globally | Drops out of this agent's prompt — and every other agent's. The remaining rules still apply. |
| Every skill unlinked | The agent still catches the five `CRITICAL` shapes and still returns a valid verdict; it reports nothing advisory. Degraded, not broken. |
| A skill deleted | Its link cascades away; the agent keeps working with one fewer rule. |
| A diff with no test files but a risky production change | WARNING for the untested risk path, from `uncovered-branches`. Never CRITICAL — test absence does not block. |
| Imported repo in an unfamiliar language | The `Stack context` hedge applies; the universal rules still hold. |
| Agent disabled | Excluded from "Review all"; no cost. |
| Prompt edited in only one of the two places | `server/test/seed-prompts.test.ts` fails, naming the file and the constant. |

## Testing

- `server/test/seed-prompts.test.ts` (hermetic) — the four `.md` ⇄ constant
  pairs match after normalising template-literal escapes.
- No test asserts an agent count, and `e2e/specs/03-agents.flow.json` waits on
  the text `"Security Reviewer"` specifically, so a fourth seeded agent breaks
  nothing. Verified 2026-08-02.
- The existing DB-backed lane already covers the seed path (45 tests green with
  the three-skill seed on 2026-08-03); re-run it after the link retarget.
- Prompt and skill *content* is not unit-testable and deliberately has no test:
  it is reviewed as prose, in `docs/agent-prompts/` and the Skills library.

**Gates:** `cd server && pnpm typecheck && pnpm arch:check`, the hermetic vitest
lane, and the DB-backed lane.

## Acceptance

1. `docs/agent-prompts/test-quality-reviewer.md` exists, follows the house structure, and contains **no** `What to look for` section — its `Role` points at `## Skills / rules` instead.
2. `TEST_QUALITY_REVIEWER_PROMPT` mirrors it exactly, and the mirror guard proves it for all four reviewers.
3. `pnpm db:seed` creates the agent and four skills, links all four to the Test Quality Reviewer in order 0–3, and leaves General/Security/Performance with no skills. A second run changes nothing.
4. Each seeded skill has a `skill_versions` v1 row.
5. A review run by this agent puts the four bodies into `## Skills / rules` in link order; disabling one removes it.
6. Editing a skill body in the UI changes the next review with no deploy — the property the whole design exists for.
7. The prompt's `CRITICAL` list contains only the five closed items, and states that a skill may not add a new one. Coverage percentages appear nowhere.
