# Agents

Subagent definitions for Claude Code. One agent per `.md` file, no nesting —
frontmatter (`name`, `description`, `tools`, optional `model`) plus a body that is
the agent's system prompt. This file is the map of the set; each agent's own file
is authoritative for its rules.

Agents are invoked for a task and run in their own context window, returning a
condensed report. Compare [`../skills/README.md`](../skills/README.md): skills are
domain knowledge loaded on demand; agents are the workers that load them.

## Catalog

| Agent | Model | Tools | Responsibility |
|---|---|---|---|
| [researcher](researcher.md) | `sonnet` | Read, Grep, Glob, Bash, WebSearch, WebFetch | Answers a question with quoted evidence — repo, external, or both. Never edits. |
| [planner](planner.md) | inherit | Read, Grep, Glob, Bash, Write, Skill | Turns a request into a Development Plan file. Never touches application code. |
| [implementer](implementer.md) | inherit | Read, Write, Edit, Grep, Glob, Bash, Skill, TodoWrite | Executes an approved plan across the four packages, with its own tests. Never commits. |
| [architecture-reviewer](architecture-reviewer.md) | inherit | Read, Grep, Glob, Bash, Skill | Read-only boundary verdict with `file:line` evidence: Onion, `client/` layering, `reviewer-core` purity, the two shared copies, alias-only imports. Fixes nothing. |
| [plan-verifier](plan-verifier.md) | inherit | Read, Grep, Glob, Bash | Read-only item-by-item traceability of an implementation against its plan, spec, or requirements. No code review. |
| [doc-writer](doc-writer.md) | inherit | Read, Write, Edit, Grep, Glob, Bash, Skill | Writes documentation into the right per-package folder, after reading that folder's README, with Mermaid diagrams. Never a plan. |

`inherit` means the frontmatter omits `model`, so the agent runs on the main
conversation's model. Only `researcher` pins one, because evidence-gathering is
cheap to run on a smaller model.

The frontmatter here uses four fields, but the format supports more — `effort`,
`skills`, `disallowedTools`, `permissionMode` and others. Keeping to four is this
repo's convention, not a platform limit; widening it is a deliberate change to
`## Adding an agent`, not something to do in passing.

## Inputs and outputs

| Agent | Consumes | Produces |
|---|---|---|
| researcher | a question; optional `mode: repo` / `mode: external` | a report in the chat — findings with evidence, `Not established`, search coverage. No files. |
| planner | a request; a spec from `<pkg>/specs/` or [`../../docs/superpowers/specs/`](../../docs/superpowers/specs/) | one plan file — `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` (preferred) or `docs/plans/<name>-plan.md` plus its index entry — and a 10–15 line digest |
| implementer | a plan path; the plan's cited spec | code and tests in the working tree, ticked `- [x]` checkboxes, and a report: changed files, verification output, deviations, not-done, plan defects, insight candidates |
| architecture-reviewer | a review surface (branch diff, files, or a package) | a report in the chat — a verdict row per boundary B1–B6, findings with `file:line`, quoted code and a severity, verbatim `arch:check` output, what it did not review. No files. |
| plan-verifier | an implementation surface **and** an item source (plan, spec, or written requirements) | a report in the chat — one row per item with a four-value status and evidence, a `Could not verify` table, plan defects, and a `Coverage:` line. No files. |
| doc-writer | material to document (a shipped feature, a plan, a spec, a review) and optionally a destination folder | documentation files in the working tree, the folder README's index or "Empty on purpose" line updated, plus a report: placement rationale, diagrams, claims with evidence |

The handoff between `planner` and `implementer` is deliberately **a file, not a
chat message** — see [Sources](#sources).

## Responsibility boundaries

What each agent must *not* do matters as much as what it does.

- **researcher** reads and reports. No `Write`, no `Edit`; its `Bash` grant is
  read-only inspection (`git log`, `git show`, listing). It never delegates to
  deep research — it *is* the research primitive.
- **planner** names skills, it does not apply them. Its `Skill` grant covers
  process skills only (`superpowers:writing-plans`, `superpowers:brainstorming`);
  loading project implementation skills would burn the context it needs for
  reading code. `Write` is scoped by prompt rule to the plan file. No `Edit`, so
  it cannot alter an existing source file at all.
- **implementer** verifies four mechanical things — typecheck, tests,
  `arch:check`, plan coverage — and **does not** judge architecture or security.
  That is left to separate blackbox reviewers, which is the one role split
  Anthropic's guidance endorses. It also does not commit, push, create branches or
  worktrees, or run `superpowers:finishing-a-development-branch`. It **does** write
  the tests for its own work — that is contract rule 3, and no other agent takes
  it over.
- **architecture-reviewer** and **plan-verifier** have **no `Write` and no `Edit`
  grant at all**, which is the strongest form of read-only available: omitting
  `tools` would inherit everything, so the guarantee is the allowlist itself.
  Together they are the "dedicated verification subagent" the multi-agent guidance
  in [Sources](#sources) endorses.
- **architecture-reviewer** judges boundaries only, and states a verdict for each
  of its six. It gives no security, performance, style or test-quality verdict, so
  its silence on those is not an all-clear. It proposes at most a one-line fix
  direction — never a refactor plan — and never runs `arch:baseline`.
- **plan-verifier** checks traceability to stated items and refuses code review:
  one row per item, and generic advice in place of a row is the failure it exists
  to prevent. It never ticks a checkbox — that stays the implementer's one
  permitted plan edit.
- **doc-writer** owns `<pkg>/docs/` and `<pkg>/specs/` and never `docs/plans/`
  (the planner's), `CLAUDE.md`, or `INSIGHTS.md`. It reads the destination
  folder's README before writing, and it will not reconstruct a spec from shipped
  behaviour when no statement of intent exists.

## Permissions

Tool *grants* live in each agent's `tools:` frontmatter. Fine-grained
`allow`/`deny`/`ask` rules cannot go there — they exist only in
[`../settings.local.json`](../settings.local.json) and are **session-global, not
per-agent**, so the `deny` list on `git commit` / `git push` /
`docker compose down -v` applies to the main conversation too. That is intentional.

Because a `deny` rule matches from the start of the command and ignores shell
operators, those rules are a second line of defence; the load-bearing
prohibitions are written into each agent's body. See the 2026-08-05 entry in
[`../../INSIGHTS.md`](../../INSIGHTS.md).

## Relationship to skills

Neither `planner` nor `implementer` carries its own list of coding rules. Both
read [`../skills/README.md`](../skills/README.md) first and route from *place in
the codebase* → *skill*; the planner writes the resulting skill names into each
task, the implementer invokes them before touching the file. One catalog, two
readers, no drift.

Two project skills are outside that loop by design:
[`pr-self-review`](../skills/pr-self-review/SKILL.md) runs after the work as a
pre-PR gate, and [`engineering-insights`](../skills/engineering-insights/SKILL.md)
is invoked by the caller, not by the implementer — which only nominates
candidates.

The three review-and-document agents narrow that loop deliberately.
`architecture-reviewer`'s `Skill` grant is restricted by prompt to
[`onion-architecture`](../skills/onion-architecture/SKILL.md) and
[`frontend-architecture`](../skills/frontend-architecture/SKILL.md), because it
must cite the rule it applies rather than paraphrase it from memory.
`plan-verifier` is granted **no `Skill` tool at all**, so nothing can pull it
toward the code review its contract forbids. `doc-writer` invokes exactly one,
[`mermaid-diagram`](../skills/mermaid-diagram/SKILL.md).

## Sources

The rules in `planner.md` and `implementer.md` are not house preference; each
comes from something citable.

**External — Claude Code and Anthropic guidance**

| Source | What it settles |
|---|---|
| [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents) | Only `name` + `description` are required; `tools` omitted inherits everything, `model` omitted means `inherit`. The read-only-vs-write-capable pattern (`code-reviewer` has no `Edit`; `debugger` does). Body shape: numbered workflow → checklist → output-format contract. `use proactively` in a description to encourage delegation. |
| [code.claude.com/docs/en/permissions](https://code.claude.com/docs/en/permissions) | `allow`/`deny`/`ask` are settings-file constructs, not agent fields. `Bash(cmd *)` / `Bash(cmd:*)` wildcard syntax, and that shell operators fall outside a rule's match. |
| [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills) | Progressive disclosure — descriptions load, bodies load on invocation, and an invoked skill's content persists for the rest of the session. Hence the planner's refusal to load implementation skills. |
| [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Section-delimited prompts and "the minimal set of information that fully outlines your expected behavior". Why a subagent returns a condensed report rather than its working context. |
| [When to use multi-agent systems](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them) | That a planner/implementer/tester/reviewer split is a documented anti-pattern — "the subagents spent more tokens on coordination than on actual work" — and that context-centric decomposition plus a dedicated **verification** subagent is what works. The four mitigations in our split answer this directly. |
| `superpowers` v6.2.0 `writing-plans` / `executing-plans` SKILL.md (plugin cache, not this repo) | The plan format the planner emits and the execution loop the implementer follows, including the `Step N: Commit`, worktree and `finishing-a-development-branch` steps our implementer must refuse. |

**Internal — this repository**

| Source | What it settles |
|---|---|
| [`../../CLAUDE.md`](../../CLAUDE.md) | The guardrails both agents restate: two physical `@devdigest/shared` copies, per-package package managers, migrations not applied on boot, the `*.it.test.ts` lane split, `pathToFileURL` entrypoints, never `docker compose down -v`. |
| `<pkg>/CLAUDE.md` | Package-local law — Onion layering and `arch:check` in [`../../server/CLAUDE.md`](../../server/CLAUDE.md), the purity rule in [`../../reviewer-core/CLAUDE.md`](../../reviewer-core/CLAUDE.md), determinism in [`../../e2e/CLAUDE.md`](../../e2e/CLAUDE.md). |
| [`../../docs/plans/README.md`](../../docs/plans/README.md) | The fallback plan format, and the precedence rule both agents enforce: when a plan and a spec disagree, the spec wins. |
| [`../../docs/plans/pr-findings-counters-plan.md`](../../docs/plans/pr-findings-counters-plan.md) · [`../../docs/superpowers/plans/2026-08-03-conventions-extractor-server.md`](../../docs/superpowers/plans/2026-08-03-conventions-extractor-server.md) | The two format precedents the planner extends, one per format. |
| `<pkg>/INSIGHTS.md` | Required reading for both agents before work in a package; append-only, and treated as high-confidence. |
| [`researcher.md`](researcher.md) | The house style the other two follow: numbered contract, an explicit stop-and-ask gate, a fenced output template, a tool-discipline section. |

## Not in this set yet

`planner.md` and `implementer.md` both hand off to an **architecture reviewer** and
a **security reviewer**. The architecture reviewer now exists —
[`architecture-reviewer.md`](architecture-reviewer.md). A **security reviewer does
not**, so that half of the implementer's `For the review agents` hand-off is still
the caller's to arrange, and neither the implementer's silence nor the architecture
reviewer's is an all-clear on security.

A **test-writer** was designed and deliberately dropped (see
[`../../docs/superpowers/plans/2026-08-05-agent-set-expansion.md`](../../docs/superpowers/plans/2026-08-05-agent-set-expansion.md)).
Tests stay with the implementer, whose contract already makes code and its tests
one task. The multi-agent guidance in [Sources](#sources) names a
planner/implementer/tester/reviewer split as an anti-pattern and endorses a
dedicated verification subagent instead — which is what the two read-only
reviewers above are.

## Adding an agent

Follow [`researcher.md`](researcher.md) for shape. Keep the frontmatter to
`name`, `description`, `tools` and — only when a smaller model is genuinely right
for the job — `model`. Write the `description` so delegation is unambiguous: what
it is for, and what it will not do. Grant the narrowest tool set that still lets
the agent finish, and state the prohibitions in the body as well, because
settings-file rules are global and coarse. Then add a row to the catalog above.
