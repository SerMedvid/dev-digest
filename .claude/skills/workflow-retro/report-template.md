# Retro — <run name>

- **Session** `<sessionId>` · **mode** `workflow` | `agent-fanout`
- **Ran** `<startedAt>` → `<endedAt>`
- **Trigger** what was asked for, in one sentence

## At a glance

| | |
|---|---|
| Agents | `<n>` in `<w>` wave(s) |
| Billable tokens | `<n>` (in `<n>` · out `<n>` · cache-write `<n>`) |
| Cache reads | `<n>` — served from cache, ~10× cheaper |
| Wall clock | `<n>`s |
| Agent time | `<n>`s |
| Parallel speedup | `<n>`× |
| Critical path | `<agent>` → `<agent>` |

## Timeline

One row per wave. `Span` is the wave's wall clock, set by its slowest lane.

| Wave | Agents | Slowest | Span |
|---|---|---|---|
| 1 | | | |

## Cost by lane

Sorted by output tokens — the expensive column.

| Agent | Type | Model | Out | Cache-write | In | Cache-read | Duration | Turns |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

## Duplicated work

Files read by more than one lane, and work two lanes did independently.

| What | Lanes | Cost | Evidence |
|---|---|---|---|
| | | | |

> Nothing significant — the lanes did not overlap. *(if that is the case, say so
> and delete the table)*

## Per lane

### `<agent label>`

- **Went well** —
- **Struggled** —
- **Prompt gaps** — what it needed that the dispatch did not give it

## Gaps

What the run was asked for and did not deliver: a question no lane answered, a
lane whose output was never used, a dimension nobody covered.

| Gap | Why it matters |
|---|---|

## Prompt fixes

Concrete and addressed to a file. Proposals only — this report changes nothing.

| Target | Change | Rationale |
|---|---|---|
| `.claude/agents/<x>.md` | | |

## Trend

Against the previous retro of the same run. State "first recorded run of
`<slug>` — no baseline" when there is none.

| Metric | Previous | This run | Δ |
|---|---|---|---|
| Agents | | | |
| Billable tokens | | | |
| Wall clock | | | |
| Parallel speedup | | | |

## Caveats

- Token estimates for duplicated reads are file size ÷ 4, indicative only.
- The orchestrator's own token spend is not counted; subagents only.
- `<anything the analyzer listed as unverified>`
