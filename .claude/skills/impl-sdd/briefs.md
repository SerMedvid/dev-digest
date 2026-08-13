# Briefs

Three templates. Two of them are what a dispatched subagent reads instead of the
repository; the third is the paragraph that keeps a reviewer pointed at the code
this run actually wrote.

## Task brief

Written to `briefs/task-N.md` **before** the implementer is dispatched. Five
parts, and nothing else:

1. **The task text, copied verbatim from the plan** — its `Files:`,
   `Interfaces:`, `Skills:`, `Verify:`, `Satisfies:` lines and every numbered
   step. Copied, not summarised: a paraphrase is where a step quietly loses its
   expected failure or its exact command.
2. **The plan's `## Global Constraints`**, whole.
3. **The `AC-N` rows quoted from the spec** that this task's `Satisfies:` line
   names, with their `Verified by` lanes.
4. **The `Interfaces: Consumes` signatures** produced by earlier tasks, exactly
   as those tasks stated them.
5. **The insight lines the plan header cites**, quoted with their file and date.

Why a file and not a prompt: the brief exists so the subagent does not re-read
the repository. Root `CLAUDE.md` already arrives as project memory, part 2
already carries the guardrails, and the task's own `Skills:` line already names
its skills — so every file the subagent still opens is one the brief named. In a
run of a dozen tasks that difference is most of the token bill.

An example, so the shape is not left to interpretation:

````markdown
# Brief — Task 3: pulls repository

## Your task, verbatim from the plan
**Files:** Create `server/src/modules/pulls/repository.ts`; Test `server/src/modules/pulls/repository.it.test.ts`
**Skills:** drizzle-orm-patterns, onion-architecture
**Verify:** `cd server && pnpm typecheck && pnpm exec vitest run src/modules/pulls/repository.it.test.ts --reporter=dot --bail=1`
**Satisfies:** AC-4, AC-9
<…the task's steps, copied whole…>

## Global constraints (binding on this task)
<…the plan's `## Global Constraints`, copied whole…>

## The acceptance criteria you are closing
- **AC-4** — WHEN a pull is imported, the system shall … *(Verified by: `*.it.test.ts`)*
- **AC-9** — IF the repository is not indexed, THEN the system shall …

## Interfaces you consume
- `listPullsByRepo(repoId: string, workspaceId: string): Promise<PullRow[]>` — from Task 2

## Insights that apply here
- `server/INSIGHTS.md`, 2026-07-14 — <the line, quoted>

## Rules
Invoke the skills above before you edit the file they govern. Report a conflict
between this brief and the spec; do not resolve it. Do not commit.
````

## Remediation brief

Written per **group of findings**, never per finding — findings that share a file
or a package are one brief and one dispatch. Contents: each finding verbatim with
its id, its `file:line`, the rule it cites, and the reviewer's one-line fix
direction. Then this constraint, verbatim:

> Change only what this finding names. No refactor, no rename, no new dependency,
> and no file outside the plan's `Files:` lists. A second problem you notice is
> reported, not fixed.

That paragraph is what keeps remediation from turning into a second, unplanned
change — the one that shows up later as `Beyond the plan` in a verification
report and that nobody asked for.

## Review surface

Pasted verbatim into every review and re-review dispatch:

> **Surface:** the working tree, not a branch diff. This run has committed
> nothing, so `git diff main...HEAD` is empty and reviewing it would report a
> pass on nothing. Review: the output of `git status --porcelain` and
> `git diff`, plus these untracked paths from the plan's `## File Structure`:
> `<paths>`.

For a **scoped** re-review, replace the untracked list with only the paths the
last remediation round touched, and add the finding ids to re-judge:

> Re-judge only these findings: `<ids>`. Files touched since your last pass:
> `<paths>`.
