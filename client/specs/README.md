# `client/specs/`

Specifications for UI work: what a screen or flow is *supposed* to do, written
before or alongside the implementation. The reference an implementation and its
tests get checked against.

A spec here should carry:

- **The journey** — entry point, the steps a user takes, the exit. Route paths.
- **States** — loading, empty, error, partial, and *live* (something still
  running). The non-happy states are the ones that get skipped and then shipped
  broken.
- **Data** — which endpoints/hooks feed it, and what happens when a call fails
  (toast vs inline vs full-screen — the taxonomy `ApiError` exists to support).
- **Interaction** — keyboard, focus, what's disabled when, what's optimistic and
  what waits for the server.
- **Acceptance** — a checklist concrete enough to write component tests from, plus
  whether the journey deserves an [`e2e`](../../e2e/README.md) flow.

Conventions:

- One screen or flow per file, kebab-case: `pr-detail.md`, `agent-editor.md`.
- Describe behaviour, not markup. Class names and element structure belong in the
  code; a spec that pins them just goes stale.
- Reference the Zod contract for any shape rather than restating fields.

## Index

- [`run-cost-display.md`](run-cost-display.md) — the four surfaces that show what
  a review run cost: PR list column, agent-runs timeline, trace drawer, review-run
  header + verdict banner. Server half:
  [`server/specs/run-cost.md`](../../server/specs/run-cost.md).
- [`findings-counters-display.md`](findings-counters-display.md) — per-severity
  findings badges on the PR list column, run timeline, and review accordions,
  each opening a click-to-open breakdown card. Server half:
  [`server/specs/pr-findings-counters.md`](../../server/specs/pr-findings-counters.md).
- [`finding-deep-links.md`](finding-deep-links.md) — the two ways out of that
  breakdown card: `file:line` to the PR's Files-changed view on GitHub, title to
  the finding itself on the PR detail page. Client-only; no server half.
- [`smart-diff-display.md`](smart-diff-display.md) — the Files changed tab's
  default rendering: files grouped by role, findings marked inline, collapse
  precedence, the order toggle, and the on-demand ✨ per-file summary. Server
  half: [`server/specs/smart-diff.md`](../../server/specs/smart-diff.md).
