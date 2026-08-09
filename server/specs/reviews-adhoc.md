# Spec — `POST /reviews/adhoc`: review a diff, with no PR behind it

**Status:** DONE (2026-08-09)
**Owner:** server · **Consumers:** mcp (the `devdigest review` CLI)
**Design:** [`docs/superpowers/specs/2026-08-09-blast-radius-and-working-review-design.md`](../../docs/superpowers/specs/2026-08-09-blast-radius-and-working-review-design.md) §5
**Related:** [`mcp/README.md`](../../mcp/README.md) (the CLI, its exit codes and
untracked-file handling), `modules/reviews/run-executor.ts` (the PR path this
mirrors)

Today a review can only happen after a PR exists. This endpoint extends the
same review flow backwards in time: post a raw unified diff, get the same
reviewer, the same grounding gate and the same blocker count — before `git
push`. It is the server side of `devdigest review --mode working`.

## 1. Scope

**In scope:** one synchronous, stateless endpoint composing the engine's
exported pieces.

**Out of scope:** persisting adhoc reviews (no `runs`, `reviews`, `findings`,
`run_traces`, no SSE); a shared extraction of `runOneAgent`'s engine-call core;
any PR-shaped context the caller does not have.

## 2. Contract

`POST /reviews/adhoc`, rate limited 10/min — the same limit as
`POST /pulls/:id/review`, because one call is one LLM run.

Body: `{ diff: string, agent?: string }`. `agent` is an agent **name**, not an
id — a CLI user types a name.

| Condition | Status |
|---|---|
| Success | **200**, the body below |
| Body over `MAX_ADHOC_DIFF_BYTES` (1 MB) | **413**, from Fastify's `bodyLimit`, before the handler runs |
| `diff` empty | **422** (zod) |
| `diff` parses to zero files | **422**, code `empty_diff` |
| `agent` names nothing enabled | **404**, message listing the enabled agents |
| No enabled agents at all | **409**, code `no_agents` |
| Provider failure | propagates to the shared handler (502 for `ExternalServiceError`, else 500) |

Every refusal above lands **before** any model call — asserted in
[`reviews-adhoc.it.test.ts`](../test/reviews-adhoc.it.test.ts) against the LLM
mock's call count, not read off the code.

```
200 {
  review, blockers, dropped[], scope_dropped[],
  agent: { name, ci_fail_on }, model, tokens_in, tokens_out, cost_usd
}
```

## 3. Behaviour

Four steps, all reusing what the PR path uses
([`service.ts`](../src/modules/reviews/service.ts) `runAdhocReview`):

1. **Agent resolution.** A name matches case-insensitively over
   `listEnabled(workspaceId)`. Omitted → the enabled agent with the earliest
   `createdAt`, tie-broken on `id` so the choice cannot flip between two calls
   with identical timestamps.
2. **`parseUnifiedDiff(body.diff)`** — the same parser
   ([`adapters/git/diff-parser.ts`](../src/adapters/git/diff-parser.ts)) the PR
   path uses, so the CLI and the web flow agree on what a diff means, including
   which lines exist for grounding to check against.
3. **`reviewPullRequest({ systemPrompt, model, diff, llm, strategy })`** — the
   same engine call. The PR-context slots (`intent`, `repoMap`, `callers`,
   `prDescription`, `memory`, `specs`) are simply **absent**; by the engine's
   contract an omitted slot renders no section, so this is the same reviewer
   minus context it genuinely cannot have, not a second implementation.
4. **`countBlockers(findings, agent.ciFailOn)`** — the same deterministic gate,
   so the CLI's exit code and the CI gate agree.

**Grounding still applies.** The engine grounds against the posted diff, so a
hallucinated `file:line` is dropped — and the drop is **reported** in
`dropped[]` rather than swallowed, exactly as the web flow reports it. The CLI
prints the count.

**Nothing is persisted.** Not as an optimisation — there is no PR to hang a
`runs` row off, and the result of a pre-push check is the exit code, not a
record. Token counts go to the route log via `log.info`, never to a
`run_traces` document. The it-test proves this by counting rows in `agent_runs`,
`reviews`, `findings` and `run_traces` before and after a 200.

`runOneAgent` is deliberately **not** refactored into a shared core. The two
paths share three exported functions today; extracting before they actually
diverge would buy an abstraction over one call site. If a later lesson makes
them drift, that is the moment.

## 4. Acceptance

| # | Item | Covered by |
|---|---|---|
| 1 | Reviews a posted diff with the same engine and reports the verdict, findings and blockers | [`reviews-adhoc.it.test.ts`](../test/reviews-adhoc.it.test.ts) |
| 2 | An ungrounded finding is dropped and the drop is reported | same, "reports what grounding dropped" |
| 3 | Blockers respect the agent's own `ci_fail_on` | same |
| 4 | Nothing is persisted | same, row counts before/after |
| 5 | Agent selection is deterministic and name lookup is case-insensitive | same |
| 6 | 413 / 422 / 422 / 404 / 409 all land before a model call | same, against the mock's call count |

## 5. Known gaps

- **No spend cap beyond the rate limit.** Ten 1 MB diffs a minute is ten full
  reviews a minute; the only ceiling is `MAX_ADHOC_DIFF_BYTES` × the rate
  limit. Acceptable for a local-first tool with the user's own key, and worth
  revisiting if this ever runs somewhere shared.
- **The workspace comes from the auth stub**, like every other route, so "whose
  agents" is decided the same way it is everywhere else in the app today.
