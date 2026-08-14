---
name: workflow-retro
description: Use after a multi-agent run — a Workflow tool run or an Agent fan-out such as pr-self-review or impl-sdd — to produce a retrospective on the run itself: tokens spent split by kind, how many agents ran and in what order, the critical path, work duplicated between lanes, where lanes struggled, and what to change in their prompts. Also handles "how did that workflow go", "how much did that run cost", "why was that so slow", "retro on the last run", and "оціни як пройшов workflow".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, Skill
---

# Workflow retro

A fan-out finishes, the answer arrives, and everything about *how* it arrived is
thrown away: which lane burned 300k tokens to contribute one paragraph, which
three lanes each read the same six files, which lane spent half its turns
looking for context that should have been in its prompt. The next run repeats
all of it.

This skill turns one run into a report. It is about the **orchestration**, never
about the work product — whether the findings were correct is
[`pr-self-review`](../pr-self-review/SKILL.md)'s job, not this one's.

## When to fire

- Right after any run that dispatched **two or more agents**. One agent is not a
  workflow and has no orchestration to critique.
- When a run felt expensive, slow, or repetitive, and you want the number
  instead of the feeling.
- Before changing an agent definition or a lane prompt — the retro is the
  evidence for the change.

Skip it for single-agent dispatches and for runs that died in the first minute.

## Where the data is

Everything below already exists on disk; nothing needs instrumenting.

| Source | What it carries |
|---|---|
| `~/.claude/projects/<project>/<sessionId>.jsonl` | every `Task`/`Agent` dispatch with its timestamp, `subagent_type`, `description` and full prompt — the launch order |
| `~/.claude/projects/<project>/<sessionId>/subagents/agent-*.jsonl` | per agent: `attributionAgent` (its type), model, effort, every `usage` block, every tool call and result, the final answer |
| `~/.claude/projects/<project>/<sessionId>/journal.jsonl` | present only for **Workflow** tool runs — each `agent()` call's return value |

Two things about this data are easy to get wrong, and the collector already
handles both. **Usage repeats per streamed chunk** — one assistant message is
written across several lines, each carrying a `usage` block, so summing lines
multiplies the real cost; dedupe by `message.id`. **The orchestrator transcript
records no `agentId`** — a dispatch is matched to its transcript by the prompt,
because the subagent's first user message is that prompt verbatim.

## Procedure

### 1. Collect the deterministic half

```bash
node .claude/skills/workflow-retro/scripts/collect-run.mjs
```

Defaults to the newest session for the current directory and writes
`.devdigest/workflow-retro/run-<sessionId>.json`. Use `--session <id>` for an
earlier run, `--cwd <dir>` for another checkout, `--quiet` to suppress the
stdout summary.

Exit 1 means the session ran no subagents — say so and stop. Do not
hand-assemble numbers from transcripts when the collector found nothing; a
retro with invented figures is worse than no retro.

### 2. Read the JSON, not the transcripts

The JSON is a few KB. The transcripts are megabytes and must never enter the
main context — that is the entire reason the collector exists.

### 3. Dispatch one analyzer subagent

One, not one per lane: the whole point is a reader that sees every lane at once
and can spot what two of them did twice. Dispatch a `general-purpose` agent —
it reads and reports, it must not edit anything — with this brief:

> Read `<path to run-*.json>` and the agent transcripts it lists under
> `agents[].transcript`. You are analysing **how the run was orchestrated**, not
> whether its conclusions were right. Do not edit any file.
>
> For each agent report: what it was asked for, what it actually did, where it
> stalled or backtracked, and what it needed that its prompt did not give it.
>
> Then across agents: work two or more lanes did independently; context repeated
> in several prompts that belonged in one shared preamble; questions in the
> dispatch that no lane answered; lanes whose output the orchestrator never
> used.
>
> Quote evidence — a line from a transcript, a tool call, a file path. A claim
> with nothing behind it is worse than a gap you admit to.
>
> Return JSON: `{ perAgent: [{ label, went_well, struggled, prompt_gaps }],
> duplication: [{ what, agents, evidence }], gaps: [{ what, why_it_matters }],
> prompt_fixes: [{ target, change, rationale }], unverified: [string] }`

If a `journal.jsonl` exists and the collector flagged it unparsed, tell the
analyzer to read it directly and describe what it found — its schema is not
pinned in the collector on purpose.

### 4. Write the report

To `.devdigest/workflow-retro/YYYY-MM-DD-<slug>.md`, following
[`report-template.md`](report-template.md). `<slug>` names the run, not the
date: `pr-self-review`, `impl-sdd-project-context`.

The directory is gitignored. **Never move a retro into `docs/`** — these are
local run artifacts, the same as `.devdigest/pr-self-review/`, and they name
the tokens and timings of one person's session.

Before writing, glob the directory for earlier reports of the same slug. If one
exists, fill the trend section by comparing against the most recent; if none
does, say so in that section rather than leaving it empty.

### 5. Route the durable part to INSIGHTS.md

A hard boundary, and the one this skill most often gets wrong:

| Goes in the report | Goes to `INSIGHTS.md` via [`engineering-insights`](../engineering-insights/SKILL.md) |
|---|---|
| Token counts, durations, wave structure | Nothing numeric about one run |
| What this run's lanes did | A constraint on how lanes must be dispatched here |
| A prompt fix for one lane | A pattern that will bite the next fan-out too |

Run metrics are **task-local state**, which `engineering-insights` explicitly
forbids recording. Invoke that skill only for findings that clear its three
tests on their own — non-obvious, durable, actionable cold — and let it decide
the file. Most retros produce none, and that is the normal outcome.

### 6. Report one line and stop

`Retro: 28 agents, 4.8M billable tokens, 1.13x parallel — .devdigest/workflow-retro/…`

Never commit. Never push. Never edit an agent definition or a lane prompt as
part of the retro — the report proposes the change; a human decides.

## Reading the numbers

**Never quote one token number.** The collector splits four ways because they
differ in cost by an order of magnitude:

| Field | Meaning |
|---|---|
| `input` | fresh prompt tokens |
| `cacheCreation` | written to cache — costs more than plain input, pays back on reuse |
| `cacheRead` | served from cache — roughly a tenth of the price |
| `output` | generated tokens, the expensive column |

`billableTokens` sums the first three and excludes cache reads. A run showing
125M cache-read against 4.8M billable is **healthy**, not catastrophic; quoting
the 130M total would be alarming and wrong.

**`parallelSpeedup` is the orchestration verdict.** `agentTimeMs / wallClockMs`:
near `1.0` means the lanes ran sequentially and the fan-out bought nothing —
look for a barrier that should have been a pipeline. Near the agent count means
the fan-out worked.

**`waves[].slowest` is the critical path.** Only that agent's duration matters
for the wave; making a fast lane faster changes nothing.

**`fileOverlap[].approxWastedTokens` is an estimate** — file size over four,
times the number of re-reads. Treat the ordering as real and the absolute number
as indicative. It also cannot see two agents reading the same file at different
offsets as one overlap.

**`repeatedCalls`** counts a lane issuing a byte-identical tool call twice —
usually a lane that lost track of what it had already found.

**`orphanDispatches`** are agents dispatched with no transcript: still running,
or killed. A retro run while background agents are alive will list them; wait
for them and re-run rather than reporting a partial fan-out as the whole run.

## Limits worth stating in the report

- Cost is in tokens, never in currency — the collector knows no prices.
- The `journal.jsonl` reader is defensive because no Workflow run has been
  recorded in this repo yet. If one appears and the collector reports it
  unparsed, that is the expected path, not a bug.
- The main-loop orchestrator's own token spend is **not** counted. The report
  covers subagents only.
- Nothing here measures whether the run produced correct work.
