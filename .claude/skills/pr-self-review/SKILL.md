---
name: pr-self-review
description: Use before opening a pull request, and whenever the PreToolUse gate denies `gh pr create`. Reviews the committed branch diff against the skills that govern each changed file, runs the deterministic checks first, blocks on a closed list of critical findings, and drafts the PR description. Also handles "self review", "check my changes before PR", and the --override flow.
allowed-tools: Read, Glob, Grep, Bash, Write, Edit, Task
---

# PR self review

Review the **committed** branch diff against the skills that govern each changed
file, then write two artifacts and print a verdict.

A `PreToolUse` hook ([`scripts/pr-self-review-gate.mjs`](../../../scripts/pr-self-review-gate.mjs))
denies `gh pr create` until `.devdigest/pr-self-review/latest.json` says the
change is clean for the current HEAD. The hook never runs a review — it reads
the artifact and names this skill in its denial. Automatic and manual runs are
therefore the same code path.

Five phases. Do them in order; Phase 1 can end the run on its own.

## Phase 0 — Collect the diff

```bash
BASE=$(git merge-base origin/main HEAD 2>/dev/null || git merge-base main HEAD)
git rev-parse HEAD
git diff --name-status "$BASE"..HEAD
git status --porcelain
```

**Stop, with a specific message and no report written, when:**

- the current branch is `main` — there is nothing to open a PR from;
- `HEAD` has no commits ahead of `BASE` — there is no diff to review;
- neither `origin/main` nor `main` resolves — say so rather than guessing a base.

A **dirty working tree does not stop the run.** Record `dirty: true`, print the
warning line from [`report-template.md`](report-template.md), and continue. The
scope is committed code, and the SHA stamp is what keeps the report honest.

## Phase 1 — Deterministic checks

Derive the touched packages from the changed paths and run the command matrix in
[`routing.md`](routing.md). Nothing under `server/`, `client/`, `reviewer-core/`,
or `e2e/` changed means **no commands run at all**.

Any non-zero exit produces one `CRITICAL` finding tagged **B1**, carrying the
command and the last 30 lines of output.

**If Phase 1 produced any finding: write the report, print the verdict block, and
stop. Dispatch no lanes.** This is the common failure and it must cost nothing —
there is no value in a model reviewing code that does not compile.

## Phase 2 — Route

Apply the glob table in [`routing.md`](routing.md). Build one bucket per lane and
drop lanes whose bucket is empty.

Everything that reached no lane goes into exactly one of the three buckets
`routing.md` defines — *excluded*, *not routed by design*, or *unrouted*.
`unrouted` should normally be empty; a `.ts` file there means `routing.md` needs
a new row.

## Phase 3 — Review lanes

Dispatch **one subagent per lane** using `superpowers:dispatching-parallel-agents`,
at most six concurrent. Each subagent receives its skill, its bucket's diff
hunks, the mandatory context from [`routing.md`](routing.md), and
[`blockers.md`](blockers.md).

Put these three rules in every subagent prompt **verbatim**:

1. Report only on lines present in the diff. A pre-existing problem elsewhere in
   a changed file is out of scope.
2. Every finding cites `path:line` and quotes the line verbatim.
3. Severity comes from `blockers.md` and nowhere else. Do not invent a critical
   category, and do not carry over the `CRITICAL` labels inside
   `react-best-practices` — that scale is not this scale.

A lane that fails, times out, or returns unparseable output becomes one
`CRITICAL` finding tagged **B9** `lane-failed`. **Do not retry silently and do
not drop the lane** — an unreviewed bucket that reports as reviewed is the one
outcome this skill must never produce.

## Phase 4 — Ground, merge, decide

- **Grounding gate.** Discard — do not downgrade — any finding whose cited line
  is absent from the diff. This is what makes a blocking verdict safe: a
  hallucinated `CRITICAL` cannot stop a correct PR. It is the same gate
  `reviewer-core` applies to the product's own review output.
- **Dedupe** on `(path, line, category)`. When two lanes agree, keep the higher
  severity and record both skill names.
- **Assign IDs** per the scheme in [`blockers.md`](blockers.md) — sort first,
  then number.
- **Verdict:** `BLOCKED` if any `CRITICAL` survives, otherwise `PASS`.
- **Write both artifacts**, then print the console block from
  [`report-template.md`](report-template.md) verbatim.

### `latest.json` — the gate parses this

```json
{
  "head": "<full sha>",
  "base": "<full sha>",
  "verdict": "BLOCKED",
  "dirty": false,
  "counts": { "critical": 2, "high": 4, "medium": 7 },
  "critical": [
    { "id": "CRIT-1", "path": "server/src/modules/pulls/routes.ts", "line": 42, "summary": "query without workspaceId" }
  ],
  "overrides": [],
  "report": ".devdigest/pr-self-review/<short sha>.md"
}
```

Written to `.devdigest/pr-self-review/latest.json`; the prose report goes to
`.devdigest/pr-self-review/<head-sha>.md`.

`head` must be the **full** SHA from `git rev-parse HEAD`. The gate compares it
exactly — a short SHA never matches and every PR is denied as stale.

`critical[]` carries only `CRITICAL` findings. The gate lists them by ID in its
denial, so `summary` should read as one line a human can act on.

## Phase 5 — PR draft

Only when the verdict is **not** `BLOCKED`. Append the draft from
[`report-template.md`](report-template.md) to the report file, taking the "CI
that will run" line from the path-filter table in [`routing.md`](routing.md).

On `BLOCKED`, produce no draft. List the fixes instead.

## Overrides

```
/pr-self-review --override CRIT-1,CRIT-3 --reason "<text>"
```

Refuse the request yourself when any of these hold:

- **No `BLOCKED` verdict has been printed yet.** This is not a flag on the first
  run — the point is that a human reads the findings before waiving them.
- **No IDs were given.** There is no `--override all`. Refuse it.
- **The reason is empty, under 15 characters, or one of** `wip`, `later`, `ok`,
  `fix soon`, `n/a`, `-`.
- **The finding is tagged B1.** A red typecheck is not a judgement call; see
  [`blockers.md`](blockers.md).

On success:

1. append an entry to `overrides[]` in `latest.json`, each carrying the current
   `head`;
2. add the `⚠️ Overridden` section to the top of the report;
3. re-run Phase 5, now that the verdict is releasable;
4. print the verdict block again, showing the outstanding count.

**One SHA of lifetime.** The gate ignores an override minted for a different
SHA, so a new commit costs a new reason. That is deliberate: the code the reason
described is no longer the code being merged.

## Checklist

Create a todo per item.

1. Confirm the branch is not `main` and has commits ahead of the base.
2. Run Phase 1 and paste its output into the response.
3. Route; name every lane you are dispatching and every file under `unrouted`.
4. Dispatch lanes in parallel; do not review a bucket yourself in the main
   thread.
5. Apply the grounding gate before assigning any ID.
6. Write both artifacts; verify `latest.json` carries the **full** HEAD SHA.
7. Print the console verdict block verbatim.
8. On `PASS`, produce the PR draft. On `BLOCKED`, do not — list the fixes.
