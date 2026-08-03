import type { SkillType } from '@devdigest/shared';

/**
 * Built-in skills used by the seed — reusable rule text attached to agents.
 *
 * A skill is text and nothing else: it is concatenated verbatim into the
 * reviewing agent's prompt under `## Skills / rules` (see
 * `docs/agent-prompts/README.md` for the assembly order). Keep each one short
 * and about ONE thing — a skill is a rule, not a second system prompt.
 *
 * `source` is `'manual'` for all of them: `SkillSource` has no `builtin`
 * value, and these are first-party hand-written rules, so the "trusted,
 * rendered verbatim" decision in `server/specs/skills.md` still holds.
 */

export interface SeedSkill {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

/**
 * The test-quality trio. They are linked to the General Reviewer by the seed:
 * it is the generalist whose remit already covers correctness and
 * maintainability, while Security and Performance stay narrow on purpose.
 */
export const SEED_SKILLS: SeedSkill[] = [
  {
    name: 'uncovered-branches',
    description: 'Flags untested branches that carry real regression risk.',
    type: 'rubric',
    body: `# Uncovered branches

Report a branch introduced by this diff that no test exercises **only when
skipping it leaves a regression class that matters**:

- an error, rejection, or \`catch\` path — especially one that swallows or
  rewrites the error;
- a boundary: empty, null, zero, one, the limit, the limit plus one;
- a fallback or degradation path that is supposed to keep working when a
  dependency fails;
- a permission, tenant, or workspace-scoping predicate.

Do NOT report:

- a coverage number, ratio, or "coverage dropped" — never mention percentages;
- an untested trivial mapper, getter, constant, or type-only change;
- a branch whose failure mode is cosmetic.

For each finding name the branch (file and line), say what breaks if it
regresses, and describe the one test that would catch it.`,
  },
  {
    name: 'edge-case-coverage',
    description: 'Names the corner cases a test suite skipped.',
    type: 'rubric',
    body: `# Edge-case coverage

Given the behaviour this diff changes, ask which inputs the tests never try:

- **Numeric / size:** 0, 1, the limit, limit + 1, negative, overflow.
- **Collections:** empty, single element, duplicates, out of order, very large.
- **Absence:** null, undefined, missing key, empty string vs absent field.
- **Text:** unicode, emoji, very long values, leading/trailing whitespace.
- **Time:** timezone, DST, clock skew, expiry exactly at the boundary.
- **Concurrency:** two callers at once, retry after partial failure, an
  operation applied twice (is it idempotent?).
- **Tenancy:** the same operation from another workspace or user.

Report the missing case, not the missing test file. One finding per distinct
case that would plausibly break, with the input that triggers it. If the tests
already cover the cases that matter, say so and report nothing.`,
  },
  {
    name: 'mock-overuse-gate',
    description: 'Catches tests that assert against their own mocks.',
    type: 'custom',
    body: `# Mock overuse gate

A test that mocks too much stops testing the code and starts testing the mock.
Flag these shapes:

- **The subject itself is mocked** — the unit under test is stubbed, so the
  assertion can never fail for the right reason.
- **Asserting call counts where behaviour is observable.** \`expect(fn).toHaveBeenCalledTimes(1)\`
  pins the implementation; prefer asserting the result or the persisted state.
  Call-count assertions are legitimate only when the call IS the behaviour
  (an email sent, a payment charged, a request not retried).
- **A stub deep enough to survive a rewrite.** If the subject could be
  reimplemented correctly and the test would still fail — or reimplemented
  wrongly and it would still pass — the test is pinned to the wrong thing.
- **A mock encoding a contract the real dependency does not have**: a return
  shape, an error type, or an ordering the real implementation never produces.
  The test then guarantees the mock, not reality.

Prefer the real thing where it is cheap and deterministic — a real object, an
in-memory implementation, a fixture. Mock the outside world (network, clock,
randomness, paid APIs), not your own code.`,
  },
];

/** Skills linked to a seeded agent, by agent name → ordered skill names. */
export const SEED_AGENT_SKILLS: Record<string, string[]> = {
  'General Reviewer': ['uncovered-branches', 'edge-case-coverage', 'mock-overuse-gate'],
};
