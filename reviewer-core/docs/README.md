# `reviewer-core/docs/`

Documentation scoped to **the engine**. Anything too deep for
[`../README.md`](../README.md) belongs here — grounding rationale, the
single-pass/map-reduce trade-off, scoring calibration, structured-output repair,
injection-hardening decisions.

Two related docs live elsewhere and should be linked, not duplicated:

- [`../../docs/agent-prompts/`](../../docs/agent-prompts/) — how a `system_prompt`
  becomes messages, and the prompt-authoring conventions. Read it before changing
  prompt assembly or the output contract.
- [`../../TESTING.md`](../../TESTING.md) — the suite-per-package strategy.

Conventions:

- One topic per file, kebab-case: `grounding-gate.md`, `scoring.md`.
- Link it from [`../README.md`](../README.md) or [`../CLAUDE.md`](../CLAUDE.md).
- Record the **why**, especially for the numbers: severity penalties, thresholds,
  and retry budgets are all calibration choices that look arbitrary later.

Empty on purpose — the starter's documentation all still fits in the README.
