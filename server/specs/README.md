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

Empty on purpose — nothing in the starter was built spec-first.
