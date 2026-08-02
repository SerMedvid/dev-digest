# Design — Test Quality Reviewer (a fourth built-in agent)

Date: 2026-08-02
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

## Decisions

| Question | Decision |
|---|---|
| Form | A **built-in agent**, not a skill. Follows General/Security/Performance exactly: a canonical `.md`, a prompt constant, a seeded row. It gets its own model call, its own findings and its own verdict. |
| Coverage philosophy | **Risk-based.** Flag an untested branch only when skipping it leaves a regression class that matters. Never report a coverage percentage, and never flag an untested trivial mapper, getter or constant. Aligns with `TESTING.md` ("typological, not exhaustive"). |
| What blocks a merge | **False confidence and silenced CI only** — see the severity table below. Missed corner cases, over-mocking and risk-based gaps are WARNING at most. Consistent with `pr-self-review`'s `blockers.md`, which already lists "a missing test" as an explicit non-blocker. |
| Stack specificity | **Agnostic core + a hedged `Stack context` section**, mirroring `performance-reviewer.md`'s "assume this unless the diff shows otherwise". The agent reviews *imported* repos, which may be any stack, so the universal rules carry the weight and the stack section only sharpens the vocabulary. |
| Enabled by default | **Yes**, like the other three. Accepted consequence: "Review all" fans out to every enabled agent, so this adds a 4th model call per PR — roughly 33% more cost and wall-clock. One toggle on the agent card disables it. |
| Prompt/doc drift | Add a hermetic test asserting each of the four `docs/agent-prompts/*.md` files equals its `seed-prompts.ts` constant. Today the mirror is enforced only by a comment. |

## Out of scope

Coverage tooling or instrumentation of any kind — the agent reads the diff, it
never runs tests, and it must never claim a coverage number. No change to
`reviewer-core`, the output schema, the grounding gate, or the severity enum. No
skill-library entry, and no mutation-testing or test-generation behaviour.

---

## Architecture

### 1. Files

No schema change, no new module, no client work — the agents list is DB-driven,
so the new reviewer appears in `/agents` on its own.

| File | Change |
|---|---|
| [`docs/agent-prompts/test-quality-reviewer.md`](../../agent-prompts/test-quality-reviewer.md) | **new** — the canonical, reviewable prose |
| [`server/src/db/seed-prompts.ts`](../../../server/src/db/seed-prompts.ts) | `+ TEST_QUALITY_REVIEWER_PROMPT` (mirror of the `.md`) |
| [`server/src/db/seed.ts`](../../../server/src/db/seed.ts) | `+ 1` entry in `seedAgents` |
| [`docs/agent-prompts/README.md`](../../agent-prompts/README.md) | `+ 1` link in the list of canonical prompts |
| `server/test/seed-prompts.test.ts` | **new** — the mirror guard |

### 2. Prompt structure

Section-for-section the same shape as `performance-reviewer.md`, so the four
reviewers stay legible as a set:

```
# Role
# Stack context (assume this unless the diff shows otherwise)
# What to look for (priority order)
# How to analyze
# Quality bar
# Severity — use exactly these three levels
# Verdict — set `verdict` consistently with your findings
# Findings discipline
```

**`What to look for`**, in priority order:

1. **False confidence — a test that cannot fail.** No assertion reached; the
   assertion targets the mock rather than the subject; a missing `await` on an
   async expectation; `expect` inside a callback that is never invoked; a
   snapshot accepted without being read.
2. **Corner cases and risk-based gaps.** Error and rejection paths, boundaries
   (`0`, `1`, limit, limit+1), empty and null, duplicate and out-of-order input,
   concurrency, and tenant/workspace scoping. Only where the missing case is a
   regression class that matters — never a coverage complaint.
3. **Mocking.** Mocking the unit under test; asserting call counts where
   behaviour is observable; stubs deep enough that the test would pass after the
   subject was rewritten; a mock encoding a contract the real dependency does not
   have (the test then pins the mock, not reality).
4. **Flakiness.** Real clocks, `Date.now`, `Math.random`, real network, `sleep`
   as synchronisation, dependence on test execution order, shared mutable module
   state, unawaited promises, fixed ports or paths, locale/timezone assumptions.

**`Stack context`** names the JS/TS signals concretely — vitest/jest, React
Testing Library, testcontainers, Playwright — hedged with "unless the diff shows
otherwise" so it degrades gracefully on an imported repo in another language.

### 3. Severity

The `CRITICAL` list is closed. Anything not on it is at most WARNING, however
serious it reads.

| Level | Earns it |
|---|---|
| **CRITICAL** (the only level that blocks merge) | `.only` left in the diff; a test that cannot fail; an assertion on the mock instead of the subject; a previously passing test deleted or `.skip`ped in a way that hides the change's effect; a missing `await` on an async assertion |
| **WARNING** | An untested risky path, a missed boundary, over-mocking, or a flaky construct |
| **SUGGESTION** | Test naming, structure, duplication |

The prompt repeats the house rules verbatim in shape: the verdict is a pure
function of the findings, zero findings is a good answer and means `approve`,
every finding cites a file and line range present in the diff, and `kind` is
`"finding"` with `trifecta_components` / `evidence` left null.

### 4. Seeding

```ts
{
  name: 'Test Quality Reviewer',
  description: 'Judges the tests in a diff: false confidence, missed corner cases, over-mocking, flakiness.',
  provider: DEFAULT_PROVIDER,
  model: DEFAULT_MODEL,
  systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
  enabled: true,
  version: 1,
}
```

`seedAgents` inserts only when no agent of that name exists in the workspace, so
an existing database picks the reviewer up on the next `pnpm db:seed` and a
re-run changes nothing. No migration.

### 5. The mirror guard

`docs/agent-prompts/*.md` and the constants in `seed-prompts.ts` are duplicated
by design — the `.md` is the reviewable original, the constant is what seeds the
DB — and the only thing keeping them equal today is a comment saying "keep the
two in sync".

The test compares each pair after normalising the two escapes a TS template
literal requires: `` \` `` → `` ` `` and `\${` → `${`. Verified on 2026-08-02:
all three existing pairs are byte-identical under that normalisation
(4317 / 5274 / 5999 chars), so the guard passes the moment it is written.

It is a hermetic test — plain file reads, no DB, no `.it.` suffix.

## States and degradation

| Situation | Behaviour |
|---|---|
| A diff with no test files and no risky production change | No findings, `approve`, and the summary says what was checked. |
| A diff with no test files but a risky production change | WARNING for the untested risk path. Never CRITICAL — test absence does not block. |
| Test-only diff | Reviewed normally; the production-code gap rules simply find nothing to say. |
| Imported repo in an unfamiliar language | The `Stack context` hedge applies; the universal rules (cannot-fail, over-mocking, flakiness) still hold. |
| Agent disabled | Excluded from "Review all" like any disabled agent; no cost. |
| Prompt edited in only one of the two places | `server/test/seed-prompts.test.ts` fails, naming the file and the constant. |

## Testing

- `server/test/seed-prompts.test.ts` (hermetic) — the four `.md` ⇄ constant
  pairs match after escape normalisation.
- No test asserts an agent count anywhere, and `e2e/specs/03-agents.flow.json`
  waits on the text `"Security Reviewer"` specifically, so a fourth seeded agent
  breaks no existing test. Verified 2026-08-02.
- The prompt's *content* is not unit-testable and deliberately has no test: it is
  reviewed as prose, in `docs/agent-prompts/`.

**Gates:** `cd server && pnpm typecheck && pnpm arch:check` and the hermetic
vitest lane.

## Acceptance

1. `docs/agent-prompts/test-quality-reviewer.md` exists and follows the eight-section house structure.
2. `TEST_QUALITY_REVIEWER_PROMPT` mirrors it exactly, and the mirror guard proves it for all four reviewers.
3. `pnpm db:seed` on an existing database adds "Test Quality Reviewer" and is idempotent on a second run.
4. The agent appears in `/agents` with no client change.
5. The prompt's `CRITICAL` list contains only the five closed items; coverage percentages appear nowhere in it.
6. `docs/agent-prompts/README.md` lists all four canonical prompts.
