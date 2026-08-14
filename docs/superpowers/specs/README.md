# `docs/superpowers/specs/`

Cross-cutting specifications: what a feature is *supposed* to do, written before
the plan and before the code. A spec here is the statement of intent that
[`implementation-planner`](../../../.claude/agents/implementation-planner.md)
plans *to* and [`plan-verifier`](../../../.claude/agents/plan-verifier.md) checks
an implementation *against*.

This folder is for features that span more than one package, or whose design was
settled in a design/brainstorming session. **Per-package specs stay per package**
— [`server/specs/`](../../../server/specs/),
[`client/specs/`](../../../client/specs/),
[`reviewer-core/specs/`](../../../reviewer-core/specs/) — each with its own
required sections and its own owner (`doc-writer`). When a feature has both, the
spec here is the source of truth for intent and the per-package files carry the
contract and journey halves, linking back.

Plans do **not** live here. They go to [`../plans/`](../plans/).

## Two generations of file in this folder

| | Naming | Header |
|---|---|---|
| **Design docs** (2026-08-02 … 2026-08-10) | `YYYY-MM-DD-<feature>-design.md` | `Date:` + `Status:`, prose sections. No Spec ID. |
| **Specs** (current) | `SPEC-YYYY-MM-DD-<feature>.md` | `Spec ID: SPEC-YYYY-MM-DD-<feature>`, EARS acceptance criteria with `AC-N` ids. |

The design docs are **not** retro-numbered — they record what was decided and
when, and rewriting their headers would destroy that. New work uses the
`SPEC-YYYY-MM-DD-<feature>` form, produced by the
[`specreator`](../../../.claude/agents/specreator.md) agent.

## Writing a new spec

The [`specreator`](../../../.claude/agents/specreator.md) agent's own file is
authoritative for the template and the rules. The short version:

- **Spec ID** — `SPEC-YYYY-MM-DD-<feature>`, identical to the file's own name:
  `SPEC-2026-08-13-blast-filters` lives in `SPEC-2026-08-13-blast-filters.md`. The
  date is the day the spec was **written**, and it does not change when the spec
  is later revised or approved — `Status:` carries that. No counter, so nothing
  has to be allocated and two people cannot mint the same ID.
- **`<feature>` is a kebab-case slug** naming the capability, since this is what
  other documents will cite for years — not the sprint, the package, or the UI
  element it happens to land in today.
- **A file that already exists under that name** is the same feature on the same
  day: amend it, or supersede it with a new spec dated today. Never resolve a
  collision by appending a digit.
- **Sections** are fixed and ordered: problem & user, goals/non-goals, user
  stories, acceptance criteria (EARS), edge cases, decisions & assumptions, design
  review, module interactions, non-functional requirements, inputs and provenance,
  untrusted inputs, proposals, open questions. An empty section says
  `N/A — <reason>`; it is never dropped.
- **Every requirement is EARS** — `shall`, with `WHEN` / `WHILE` / `IF … THEN` /
  `WHERE` and the combined `WHEN … WHILE …` for the conditional patterns — and
  carries an `AC-N` id, so a plan task and a test can cite it. Each row also names
  the lane that could falsify it (`Verified by`).
- **`AC-N` ids are permanent.** A revision appends the next free number. It never
  renumbers, never reuses a retired number, and retires a requirement by marking
  the row `withdrawn — superseded by AC-M`. Everything downstream cites these ids
  and nothing detects a silent renumber.
- **Decisions are recorded, not absorbed** — `## Decisions and assumptions` says,
  per question, who settled it: the caller, or a default the agent applied because
  nobody did. That is how a reader tells a decision from a guess later on.
- **`Status: draft` until a human approves it.** The vocabulary is
  `draft | approved | implemented | superseded`, and it applies to `SPEC-*` files
  only — the design docs below keep their prose status. No agent promotes a spec
  on its own judgement.
- **Superseding** — the new spec fills `Supersedes:`; the old one gains a
  `Superseded-by:` line and `Status: superseded`, and its body is otherwise left
  alone.
- Reference the Zod contracts in `vendor/shared/contracts/` rather than restating
  their fields, and describe behaviour rather than markup.

## Index

Newest first — a new `SPEC-*` row goes at the top. `Status` is the file's own
header value, copied verbatim. For a `SPEC-YYYY-MM-DD-<feature>.md` file the name
**is** the Spec ID, so there is no separate ID column; the design docs below have
no Spec ID at all.

| File | Status | Subject |
|---|---|---|
| [`SPEC-2026-08-13-project-context.md`](SPEC-2026-08-13-project-context.md) | draft | Repository `.md` documents discovered under configurable roots, attached by hand to agents and skills, and injected as untrusted text into the review prompt's `## Project context` slot. Expected halves: `server/specs/project-context.md`, `client/specs/project-context.md` |
| [`SPEC-2026-08-13-impl-sdd.md`](SPEC-2026-08-13-impl-sdd.md) | draft | `/impl-sdd` — executes an approved plan, traces it against the spec, reviews it on three axes, and remediates the findings in bounded rounds. Repo tooling only |
| [`2026-08-10-prior-prs-design.md`](2026-08-10-prior-prs-design.md) | approved, ready for planning | Merged/closed PRs overlapping this PR's files, and the `uncomparable_prs` disclosure. Shipped halves: [`server/specs/prior-prs.md`](../../../server/specs/prior-prs.md), [`client/specs/blast-radius-card.md`](../../../client/specs/blast-radius-card.md) |
| [`2026-08-10-blast-radius-ui-parity-design.md`](2026-08-10-blast-radius-ui-parity-design.md) | approved, ready for planning | `client/` — bringing the blast radius card to parity with the design comp |
| [`2026-08-09-blast-radius-and-working-review-design.md`](2026-08-09-blast-radius-and-working-review-design.md) | approved, not yet implemented | What a PR reaches: symbols, callers, downstream — plus `devdigest review --mode working` |
| [`2026-08-06-smart-diff-design.md`](2026-08-06-smart-diff-design.md) | approved, not yet implemented | Grouping a PR's files by how much they matter. Shipped halves: [`server/specs/smart-diff.md`](../../../server/specs/smart-diff.md), [`client/specs/smart-diff-display.md`](../../../client/specs/smart-diff-display.md) |
| [`2026-08-05-intent-layer-design.md`](2026-08-05-intent-layer-design.md) | approved, not yet implemented | Deriving what a PR is trying to do and injecting it into the review. Shipped half: [`server/specs/intent.md`](../../../server/specs/intent.md) |
| [`2026-08-03-conventions-extractor-design.md`](2026-08-03-conventions-extractor-design.md) | approved, not yet implemented | Repo house rules → an accepted, evidence-backed skill |
| [`2026-08-02-test-quality-reviewer-design.md`](2026-08-02-test-quality-reviewer-design.md) | **implemented** 2026-08-03 | A fourth built-in agent, with pluggable skills instead of prompt text |
| [`2026-08-02-skills-design.md`](2026-08-02-skills-design.md) | approved, not yet implemented | Skills as a reusable rule library shared across agents |
| [`2026-08-02-pr-self-review-skill-design.md`](2026-08-02-pr-self-review-skill-design.md) | approved, not yet implemented | The `pr-self-review` pre-PR gate |
| [`2026-08-02-onion-architecture-skill-design.md`](2026-08-02-onion-architecture-skill-design.md) | approved, not yet implemented | Turning `server/`'s stated layering into an enforced skill |

The ten `YYYY-MM-DD-*-design.md` rows are pre-scheme design docs and keep their
own prose status; the `SPEC-*` rows above them use the
`draft | approved | implemented | superseded` vocabulary.

A `Status` in this table that disagrees with the file is a bug in the table: the
file's header wins, and the row gets corrected.
