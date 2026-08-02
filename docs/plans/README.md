# `docs/plans/`

Cross-package execution plans: the ordered "how and in what order" for a
feature that spans more than one package. A plan is a snapshot written before
implementation — the per-package `specs/` stay authoritative for *what* the
feature does; when a plan and a spec disagree, the spec wins. Plans are not
updated after the feature ships; they document how the work was laid out.

## Index

- [`pr-findings-counters-plan.md`](pr-findings-counters-plan.md) — per-severity
  findings counters on the PR list and Agent-runs surfaces, with a click-to-open
  breakdown card. Specs: [`server/specs/pr-findings-counters.md`](../../server/specs/pr-findings-counters.md),
  [`client/specs/findings-counters-display.md`](../../client/specs/findings-counters-display.md).
- [`finding-deep-links-plan.md`](finding-deep-links-plan.md) — deep links out of
  that breakdown card (GitHub Files-changed, and the finding on the PR detail
  page). Client-only, kept here as the successor of the plan above. Spec:
  [`client/specs/finding-deep-links.md`](../../client/specs/finding-deep-links.md).
