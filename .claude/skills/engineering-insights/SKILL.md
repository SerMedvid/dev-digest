---
name: engineering-insights
description: Records durable engineering insights into a module's INSIGHTS.md, and reads them back before work starts in that module. Use whenever a session surfaces something non-obvious and reusable — a hidden constraint, an approach that failed for a structural reason, a dependency quirk, a decision and the reason behind it, a recurring error and its fix — and again when wrapping up a task. Also handles "write this down", "remember this", "add to insights", and "what do we know about this module".
allowed-tools: Read, Write, Edit, Glob, Grep
---

# Engineering insights

Every session starts cold. What was learned the hard way — a trap that cost an
hour, a constraint the code doesn't state, an approach that looked right and
wasn't — evaporates when the session ends, and the next session re-learns it.

`INSIGHTS.md` closes that loop. One per module, sitting next to its `CLAUDE.md`.
**Read it before working in the module; append to it when the module teaches you
something.**

## The bar — three tests

An insight must pass **all three**. Two out of three is noise.

1. **Non-obvious.** Would a competent engineer reading the code already know
   this? If yes, don't write it. *If it would be obvious to anyone reading the
   code, don't write it.*
2. **Durable.** Will it still be true next month? A fact about the codebase
   qualifies; a fact about today's task does not.
3. **Actionable cold.** Does it name the thing and say what to do about it? An
   entry that sends the reader off to re-investigate has saved nobody anything.

The test that catches the most bad entries is the third. Compare:

- ❌ "Promises can be tricky."
- ✅ "`Promise.all()` on the ingest pipeline times out past 30 items — use
  `Promise.allSettled()` batched at 10 for that module."

Both are "about promises". Only one lets the next session act.

## Never record

Keeping the file dense matters more than making it complete. A noisy
`INSIGHTS.md` gets skimmed and then ignored, which is worse than an empty one.

- **What the code already states plainly.** `docs/README.md`'s rule holds here:
  the code is the source of truth for mechanics. Insights are for what the code
  *doesn't* say.
- **What a `CLAUDE.md`, `README.md`, or spec already says.** If the rule belongs
  there, improve *that* file instead — and say that's what you did.
- **Task-local state.** What you changed this session, what's half-done, TODOs.
  That's a commit message or a PR description.
- **Slips with no lesson in them.** A typo, a wrong path, a misread line. You
  made a mistake; the codebase didn't teach you anything.
- **Generic engineering advice.** If it would be true in any repo, it doesn't
  belong in this one's `INSIGHTS.md`.
- **Anything already recorded.** Check before writing — see the procedure below.

## Which file

Route by **whose behaviour the insight constrains**, not by where you happened
to find it:

| Insight about | File |
|---|---|
| Fastify routes, DI container, Drizzle/migrations, runs & SSE, jobs | [`server/INSIGHTS.md`](../../../server/INSIGHTS.md) |
| React/Vite UI, routing, client state, the design system | [`client/INSIGHTS.md`](../../../client/INSIGHTS.md) |
| The review pipeline, prompts, the grounding gate, scoring | [`reviewer-core/INSIGHTS.md`](../../../reviewer-core/INSIGHTS.md) |
| Agent-browser flows, the hermetic runner, flaky waits | [`e2e/INSIGHTS.md`](../../../e2e/INSIGHTS.md) |
| MCP tools & their projections, the `devdigest review` CLI, MCP-client behaviour | [`mcp/INSIGHTS.md`](../../../mcp/INSIGHTS.md) |
| Spans packages, tooling, portability, cross-cutting conventions | [`INSIGHTS.md`](../../../INSIGHTS.md) (repo root) |

When it could go in two places, file it where someone would **look for it**.
Never write the same entry into two files — put it at the root and cross-link
from the packages if it genuinely spans them.

A module here means a package (one with its own `package.json`), plus the repo
root. Sub-modules like `server/src/modules/repo-intel/` do **not** get their own
file; their insights go in the package's.

## The six sections

Every `INSIGHTS.md` carries these headings, in this order. Don't invent new ones
— if nothing fits, the entry probably fails the bar.

| Section | What belongs in it |
|---|---|
| `What works` | An approach that succeeded for a reason worth repeating |
| `What doesn't work` | A dead end, an anti-pattern, an approach that fails structurally |
| `Codebase patterns & tool notes` | A convention the code follows but doesn't state; a dependency quirk |
| `Decisions` | A choice **and its reason** — so it isn't re-argued next month |
| `Recurring errors & fixes` | An error you'll see again, paired with what actually fixes it |
| `Open questions` | Something unresolved, so the next session doesn't assume it's settled |

`Decisions` is the one most often skipped and the one that pays back hardest.
*"We chose Postgres for ACID guarantees, not Redis"* stops the same debate
reopening every time someone notices the cache-shaped hole.

## Entry format

```markdown
- **2026-07-28** — `Promise.all()` in [`src/ingest.ts`](src/ingest.ts) times out
  past ~30 items. Use `Promise.allSettled()` batched at 10 here.
  (`src/ingest.ts:88`)
```

- **Date first**, `YYYY-MM-DD`, bold, followed by an em dash.
- **One bullet = one insight.** No nesting, no sub-bullets.
- **Newest first** within its section.
- **Evidence is mandatory** — a trailing `` (`path/to/file.ts:41`) `` citing
  where the insight came from. The only exception is `Open questions`, which may
  have nothing to cite yet. An entry with no evidence can't be re-verified when
  it ages, and every entry eventually ages.
- **Paths are relative to the file's own package** — `src/ingest.ts` in
  `server/INSIGHTS.md`, not `server/src/ingest.ts`.
- Follow house markdown style: inline links with backticked path text, backticked
  identifiers, hard-wrapped at ~80 columns.

## Procedure

1. **Read the target `INSIGHTS.md` in full.** Not a grep — you need to know what
   is already there before adding to it.
2. **Check the bar.** All three tests, and nothing on the "never record" list.
   If it fails, say so and move on rather than writing a weaker entry.
3. **Check for a duplicate**, across the whole file and not just the target
   section — the same fact filed under a different heading is still a duplicate.
   If one exists:
   - Says the same thing → **don't write anything.** Say it's already recorded.
   - Adds a genuinely new fact → write a new entry stating *what is different*,
     not a restatement of the old one.
   - Contradicts it → write a new dated entry that says so explicitly, e.g.
     *"supersedes the 2026-05-02 entry: the reaper does now survive restart."*
4. **Append.** Insert the bullet directly under its heading, above any existing
   entries. If the file still carries its `Empty on purpose — nothing recorded
   yet.` sentinel line, delete that line in the same edit.
5. **Report in one line and resume** what you were doing:
   `Recorded to server/INSIGHTS.md → What doesn't work` plus the entry text.
   Don't ask permission first — these are plain markdown in git and get reviewed
   in the diff like anything else.

**Append-only.** Never rewrite or delete an existing entry as part of recording a
new one. Being able to see what was believed, and when, is most of the value
when an entry turns out to be wrong. Corrections are new dated entries.
Deletion happens only in a deliberate pruning pass (below).

## When to fire

Two moments, both of them:

- **As you go** — the instant something non-obvious lands. Don't defer it to the
  end of the task; the end of the task is where it gets forgotten.
- **At wrap-up** — before reporting a task complete, sweep for anything the
  session taught you that isn't recorded yet.

Skip it for trivial edits. The cadence worth aiming at is any session over ~30
minutes that involved a problem, a decision, or a discovery.

## Reading side

Before starting work in a package, read its `INSIGHTS.md` alongside its
`CLAUDE.md`. Treat entries as high-confidence guidance — but they are
**observations, not standing rules**. An entry naming a file, flag, or line may
have aged out; verify before relying on one, and if it's stale, correct it with
a new dated entry while you're there.

A useful way for a user to force an active read rather than a passive one:

> Before we begin, confirm you've read `server/INSIGHTS.md` and summarise the
> top 3 points relevant to this task.

That proves the file was actually processed, not just loaded.

## Maintenance

Past roughly **200 entries in one file**, signal-to-noise collapses and people
stop reading it. Two remedies, in order of preference: prune superseded entries,
or split by domain (`INSIGHTS-auth.md`, `INSIGHTS-jobs.md`) and link them from
the package `CLAUDE.md`.

Prune periodically, and always in its own commit — never mixed into feature
work, where nobody will review it. What to remove:

- Entries a newer dated entry has superseded.
- Entries whose claim you just verified is no longer true.
- Near-duplicates that accumulated despite step 3; consolidate them into one.

A confidently wrong insight is worse than no insight, so removing a stale entry
is a contribution, not a loss.

## See also

- [`examples.md`](examples.md) — good and bad entries side by side, drawn from
  real traps in this codebase. Read it if you're unsure whether something clears
  the bar.
- [`references.md`](references.md) — where these rules came from and why.
