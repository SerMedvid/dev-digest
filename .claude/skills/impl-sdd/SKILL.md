---
name: impl-sdd
description: Execute an approved implementation plan end to end — task-by-task implementation, traceability against the plan and its spec, a three-axis review, and bounded remediation of the findings. Takes a plan path; writes no spec and no plan. Stops at a clean working tree and never commits. Use after implementation-planner has produced a plan and a human has approved it. Also handles "run the plan", "execute this plan", "implement the plan".
allowed-tools: Read, Glob, Grep, Bash, Write, Edit, Task
---

# `/impl-sdd`

You execute a plan someone already approved. **The plan is the scope, the spec is
the authority, and the ledger is the record.** You dispatch agents; you do not
write code yourself, and you never write a spec or a plan.

```
/impl-sdd --plan <path> [--spec <path>] [--from <Pn>] [--mode multi|single] [--dry-run]
```

Two things sit deliberately outside this command:
[`specreator`](../../agents/specreator.md) and
[`implementation-planner`](../../agents/implementation-planner.md) are run by
hand. Both end in a human judgement — a spec is approved, a plan is accepted —
and a command that swallowed them would be asking for permission twice inside
its own control flow.

## Arguments

| Argument | Meaning |
|---|---|
| `--plan <path>` | **Required.** A plan in `docs/superpowers/plans/`. |
| `--spec <path>` | The governing spec. Omitted → read the plan's `Spec:` header. Neither → run without coverage checking, and say so in the report. |
| `--from <Pn>` | Resume at a phase, reading state from the ledger. See [ledger.md](ledger.md). |
| `--mode multi\|single` | Overrides the plan's own `Execution mode:` header. |
| `--dry-run` | Complete P0 and stop, before any implementer is dispatched. |

## The phase spine

| Phase | What happens | Ends when |
|---|---|---|
| P0 preflight | plan and spec resolved, branch checked, workspace opened, AC coverage listed | the coverage list is empty, or the run stops |
| P1 execute | one brief and one implementer per task; `plan-verifier` after each plan phase | every task has a `task-done` line |
| P2 traceability | `plan-verifier` full pass over plan **and** spec | no `not satisfied` item remains, or the run stops |
| P3 review | architecture, correctness and security reviews, concurrently | `findings.md` is written |
| P4 remediation | bounded fix rounds with scoped re-review | no open `must-fix` / `fix-in-scope` finding, or round 3 ends |
| P5 handoff | the report; the working tree is left for the human | always — this is where the command stops |

Read [phases.md](phases.md) before P0 and follow it phase by phase. The three
companions carry the detail this file deliberately does not:

- [phases.md](phases.md) — what each phase reads, dispatches, and appends.
- [briefs.md](briefs.md) — the task brief, the remediation brief, the review-surface note.
- [remediation.md](remediation.md) — triage buckets, the round protocol, reviewer failure.
- [ledger.md](ledger.md) — the line grammar, the event vocabulary, the resume protocol.

## Two rules that hold in every phase

**Stop and ask, do not rule.** A conflict between the plan and the spec, a plan
defect, a finding that contradicts either — each stops the run and goes to the
human. The spec is the authority and amending it is the user's act. This is a
deliberate refusal of `superpowers:subagent-driven-development`'s "rule and
continue": a wrong ruling here is rework nobody sees until review.

**Briefs carry the context, not prompts.** Every dispatched subagent reads a
brief file. It does not re-read the repository: root `CLAUDE.md` already arrives
as project memory, the plan's `## Global Constraints` already carries the
guardrails, and the task's own `Skills:` line already names its skills.

## What this never does

- `git commit`, `git add`, `git push`, `git reset`, `git stash`, `git checkout`/`switch`.
- Create, switch or delete a branch or a worktree.
- `gh pr create` — [`pr-self-review`](../pr-self-review/SKILL.md) is the gate, and it runs after this command.
- Flip a spec's `Status:`, or edit a spec or a plan body. Ticking a plan checkbox is the implementer's one permitted plan edit, not yours.
- `pnpm arch:baseline`, or regenerating `.dependency-cruiser-known-violations.json`.
- `docker compose down -v`.
- Invoke `superpowers:brainstorming`, `superpowers:subagent-driven-development`, or `superpowers:finishing-a-development-branch`.
- Write application code with your own hands. You dispatch the implementer; if a task is too small to be worth a dispatch, it was too small to be a task.
