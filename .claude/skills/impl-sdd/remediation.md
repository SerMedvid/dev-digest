# Remediation

P4. The review produced findings; this phase closes the ones that belong to this
change, defers the ones that do not, and ends whether or not everything closed.

## The findings record

`findings.md` in the workspace root, one row per finding:

| Column | Contents |
|---|---|
| `id` | `F1`, `F2`, … — assigned once and never reused |
| `source` | which reviewer raised it; both names when two agreed |
| `severity` | `error` / `warn` / `info` from the architecture reviewer, or the correctness and security reviewers' own grade |
| `file:line` | where it is, always — a finding that cannot be located cannot be fixed or refuted |
| `bucket` | one of the four below |

Two rules about the record itself:

- **Dedupe on `(file, line, claim)`.** When two reviewers report the same defect
  it is one row: keep the higher severity and name both sources. Two ids for one
  defect means two remediation dispatches for one fix.
- **No findings at all is a normal outcome.** Append `round · R0 · no findings`
  and go straight to P5. So is every finding landing in `defer`: nothing is
  dispatched, and all of them are carried into the report as follow-up.

## Triage — every finding lands in exactly one bucket, before any fix

| Bucket | Rule |
|---|---|
| `must-fix` | `severity: error` **and** `confidence: confirmed` from the architecture reviewer; any security finding at high or above; any correctness bug with a stated reproduction |
| `fix-in-scope` | `warn`, or any finding whose file appears in some task's `Files:` list |
| `defer` | `info`, or a finding naming only files absent from every `Files:` list. Ledgered and carried into the report as follow-up — **never** fixed, because widening the diff turns up as `Beyond the plan` in the next verification and was never what the plan asked for |
| `conflict` | the finding contradicts the spec or the plan. **Stop and ask.** The spec is the authority and amending it is the user's act — this is the one place this command deliberately refuses `superpowers:subagent-driven-development`'s "rule and continue" |

Triage happens once, for all findings, before the first dispatch. Bucketing as
you go produces a round that fixes finding 1 and only then discovers finding 4
was a `conflict` that should have stopped the run.

## The round protocol

R = 1..3. Each round:

1. **Group by file or package** — never one dispatch per finding. Three findings
   in one service are one brief and one implementer; a fresh subagent per finding
   is where the token budget goes.
2. **Dispatch** [`implementer`](../../agents/implementer.md) with the remediation
   brief from [briefs.md](briefs.md), whose constraint paragraph is what keeps
   the fix from becoming a refactor.
3. **Re-run the gates for the touched packages only** — typecheck, the targeted
   tests, and `cd server && pnpm arch:check` when `server/` moved.
4. **Dispatch a scoped re-review** — only the files this round touched, naming
   the finding ids to re-judge. A full branch re-review every round is what makes
   fix loops expensive, and it re-litigates findings nobody touched.
5. **Append one `round` line** with the counts: dispatched, closed, still open.

**A gate that fails inside a round does not close the round.** A fix that breaks
a test which passed in P1 becomes a new finding in that same round, bucketed
`must-fix`, and the round runs to its re-review with it open — it is not carried
silently into the next round's count.

## At the cap

**Round 3 does not dispatch a fourth fix.** A finding that survives three rounds
is almost never a coding failure — it is a defect in the plan or the spec, and a
fourth attempt at the code will fail the same way for the same reason. Stop and
present the residuals with four options:

1. **Amend the spec** — [`specreator`](../../agents/specreator.md), appending a
   new `AC-N` or withdrawing one. Never renumbering.
2. **Amend the plan** — [`implementation-planner`](../../agents/implementation-planner.md).
3. **Waive it**, with the reason recorded as a `ruling` line in the ledger.
4. **Accept it as follow-up**, carried into the report.

A later session that "restores" an unbounded loop is removing this rule, not
fixing a limitation.

## When a reviewer itself fails

A reviewer that fails, times out, or returns output that does not parse is
**retried exactly once**, as a `retry` ledger line — never a silent retry. An
unparseable response is retried with the output contract restated; a crash or a
timeout is retried as-is.

If the retry also fails, that axis is recorded as
`not reviewed: <axis> — <reason>`. It is **not** a finding: a finding is by
definition something an implementer can act on, and a crashed reviewer is not.
The other axes still remediate, and the run's outcome word becomes
`incomplete — <axis> not reviewed`, never `clean`. If all three fail, stop at P3:
there is nothing to remediate.

This is the disclosure pattern, not the blocking pattern. Blocking would throw
away two completed axes to recover one; silence would let an unreviewed surface
read as an all-clear, which is the same failure `uncomparable_prs` exists to
prevent in the product itself.

## The regression guard

Record in the ledger which round touched which file. If any of those files
carries `AC-N` coverage, re-run [`plan-verifier`](../../agents/plan-verifier.md)
for **those items only** before P5, and append a `phase-verify` line. A fix that
closes F2 and breaks AC-7 must not reach the handoff.

## Frozen violations are not findings

`cd server && pnpm arch:check` ending `24 known violations, 0 new` is a **pass**.
A frozen violation is never a finding and never a remediation target, and
`pnpm arch:baseline` is never run to make a failure go away. This is restated
here rather than left to the architecture reviewer's own B6, because P4 is where
the temptation appears: a red gate in the middle of a fix round is exactly when
regenerating the baseline looks like progress.
