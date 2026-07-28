# `client/docs/`

Documentation scoped to **this package**. Anything too deep or too long for
[`../README.md`](../README.md) belongs here — screen walkthroughs, state/data-flow
notes, the design-system relationship, decision records ("why hooks-only data
access", "why SSE and polling both exist", "why `styles.ts` instead of inline
classes").

Cross-cutting docs stay at the repo root:
[`../../README.md`](../../README.md), [`../../TESTING.md`](../../TESTING.md),
[`../../docs/`](../../docs/).

Conventions:

- One topic per file, kebab-case: `run-streaming.md`, `component-conventions.md`.
- Link it from [`../README.md`](../README.md) or [`../CLAUDE.md`](../CLAUDE.md),
  otherwise nobody finds it.
- Document the **why**, not the component tree — the tree is discoverable, the
  reasoning isn't.
- Update in the same commit as the behaviour, or delete it.

Empty on purpose — the starter's documentation all still fits in the READMEs.
