# `e2e/docs/`

Documentation scoped to **the browser suite**. Anything too deep for
[`../README.md`](../README.md) belongs here — agent-browser command notes,
debugging a flaky wait, how the hermetic stack is composed, why a journey was
deliberately left uncovered.

Conventions:

- One topic per file, kebab-case: `debugging-flows.md`, `hermetic-stack.md`.
- Link it from [`../README.md`](../README.md) or [`../CLAUDE.md`](../CLAUDE.md).

> **No `specs/` README here.** [`../specs/`](../specs/) already exists and holds
> the executable flow definitions (`NN-name.flow.json`) — in this package "spec"
> means an agent-browser command list, not a written specification. The format is
> documented in [`../README.md`](../README.md); prose about the flows goes in this
> folder instead.

Empty on purpose — the starter's documentation all still fits in the README.
