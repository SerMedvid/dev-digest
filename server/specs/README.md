# `server/specs/`

Specifications for API work: what a module or endpoint is *supposed* to do,
written before or alongside the implementation. A spec is the reference an
implementation and its tests are checked against — not a description of what the
code currently happens to do.

A spec here should carry:

- **Scope** — the endpoints/modules touched, and explicitly what's out of scope.
- **Contract** — request/response shapes (name the Zod contract in
  `src/vendor/shared/contracts/` rather than restating field lists), status codes,
  and the error cases.
- **Behaviour** — ordering, idempotency, what happens on partial failure, what is
  persisted. This is where most API bugs actually live.
- **Degradation** — what the feature does when a dependency is missing: no LLM
  key, no GitHub token, repo not indexed, Docker absent. The house rule is degrade
  visibly, never fail the caller.
- **Acceptance** — a checklist concrete enough to write tests from.

Conventions:

- One feature per file, kebab-case: `pr-import.md`, `run-cancellation.md`.
- Reference the Zod contract as the source of truth for shapes; don't duplicate
  it here, or the two will disagree.
- Mark a spec as superseded rather than quietly editing it after ship, so the
  original intent stays readable.

## Index

- [`run-cost.md`](run-cost.md) — persisting per-run LLM cost on `agent_runs`,
  exposing it on `RunSummary` / `RunTrace.stats`, and the per-PR roll-up on the
  pulls list. Client half: [`client/specs/run-cost-display.md`](../../client/specs/run-cost-display.md).
- [`pr-findings-counters.md`](pr-findings-counters.md) — per-severity findings
  roll-up + top-6 preview embedded in the pulls list endpoint (non-dismissed
  only, one query per page, null-not-zeros degradation). Client half:
  [`client/specs/findings-counters-display.md`](../../client/specs/findings-counters-display.md).
- [`intent.md`](intent.md) — deriving what a PR is trying to do: the two
  endpoints, the five sources and their caps, the computed confidence tiers,
  what lands in `pr_intent`, the `intent` prompt slot and the deterministic
  scope gate's exact drop rule.
