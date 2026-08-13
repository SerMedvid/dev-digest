# The ledger

One append-only file per run, at the workspace root. It is the operator's view of
what happened and the only thing that makes a run resumable.

Conversation memory does not survive compaction. A controller that lost its place
re-dispatches tasks that already finished — the most expensive failure this
command can have, because every re-dispatch costs a full implementer and produces
edits on top of edits. The ledger is the defence, and it only works if every
event is written when it happens rather than reconstructed afterwards.

## Grammar

```
<ISO8601> · <Pn> · <event> · <subject> · <outcome>
```

Five fields, separated by ` · `. UTC, seconds precision. Never rewrite a line and
never truncate the file: a resumed run appends to the ledger it already has.

## Events

| Event | Subject | Written when |
|---|---|---|
| `task-start` | the task number and title | immediately before an implementer is dispatched |
| `task-done` | the task number and title | after its verification passed — **never before** |
| `phase-verify` | the plan phase, or the AC ids re-checked | after a scoped or full `plan-verifier` pass |
| `finding` | the finding id | one line per finding recorded in `findings.md` |
| `retry` | the axis being retried | a reviewer failed and is being retried once |
| `round` | `R1`, `R2`, `R3`, or `R0` | at the end of a remediation round, with counts |
| `ruling` | the finding id | a finding was deferred or waived, with the reason |
| `stop` | what stopped it | the run ends — completed, or stopped to ask |

## Example

```
2026-08-13T09:12:40Z · P0 · stop · preflight · dirty tree recorded, 3 AC uncovered — asking
2026-08-13T09:14:22Z · P1 · task-start · Task 3 — pulls repository · —
2026-08-13T09:31:07Z · P1 · task-done · Task 3 — pulls repository · verify pass (41 tests)
2026-08-13T09:32:15Z · P1 · phase-verify · phase 1 · 8 satisfied / 0 partially
2026-08-13T09:33:10Z · P3 · finding · F2 · arch B4 error confirmed — one shared copy only
2026-08-13T09:40:02Z · P3 · retry · security · unparseable output, retrying once
2026-08-13T09:48:55Z · P4 · round · R1 · 3 dispatched, 2 closed
2026-08-13T09:52:01Z · P4 · ruling · F5 · deferred — pre-existing, outside plan Files:
2026-08-13T09:59:40Z · P5 · stop · run complete · incomplete — security not reviewed
```

## Rules

- **A failed verification writes no `task-done`.** Its output goes beneath the
  line it belongs to, capped at 30 lines — the first failure and its stack, not
  the whole run. A capped paste is a record; an uncapped one is a second copy of
  the test suite in your context.
- **`ruling` is for deferrals and waivers only.** It is not a licence to settle a
  conflict between the plan and the spec: those stop the run.
- **One plan, one ledger.** The workspace is keyed by the plan's basename. A
  ledger whose header names a different plan is never resumed from — say so and
  stop, rather than appending this run's events to another run's history.

## Resume

`--from <Pn>` reads the ledger and continues:

1. Confirm the ledger's header names this plan. If not, stop.
2. Replay nothing. The ledger is a record, not a script.
3. In P1, skip every task that already has a `task-done` line and start at the
   first that does not. A task with a `task-start` and no `task-done` is
   re-dispatched whole — a half-applied task is reported, never assumed complete.
4. Refuse to restart a phase whose lines show completed work unless the caller
   named that phase explicitly. `--from` is an instruction, not a guess.

Without `--from`, a run over a workspace that already holds a ledger starts at
P0 and reports what the ledger says was already done, rather than silently
redoing it.
