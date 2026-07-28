# `server/docs/`

Documentation scoped to **this package**. Anything too deep or too long for
[`../README.md`](../README.md) lives here as its own file — module deep-dives,
data-flow notes, adapter contracts, decision records ("why the DI container",
"why static module registration", "why the reaper runs on boot").

Cross-cutting docs that aren't about the API specifically stay at the repo root:
[`../../README.md`](../../README.md), [`../../TESTING.md`](../../TESTING.md),
[`../../docs/`](../../docs/).

Conventions:

- One topic per file, kebab-case: `repo-intel-indexing.md`, `run-lifecycle.md`.
- Link it from [`../README.md`](../README.md) or [`../CLAUDE.md`](../CLAUDE.md),
  otherwise nobody finds it.
- Document the **why**. Mechanics drift and the code is the source of truth for
  those; intent doesn't age the same way.
- When behaviour changes, update the doc in the same commit or delete it. A
  confidently wrong doc is worse than no doc.

Empty on purpose — the starter's documentation all still fits in the READMEs.
