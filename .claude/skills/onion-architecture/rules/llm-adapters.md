# LLM adapters — `LLMProvider`, model choice, cost

`SKILL.md` puts `@anthropic-ai/sdk`, `openai`, and OpenRouter in the
driven-adapter ring: the core knows exactly one interface,
[`LLMProvider`](../../../../server/src/vendor/shared/adapters.ts) from
`@devdigest/shared` — `listModels`, `complete`, `completeStructured`, `embed`.
This file is that boundary in detail — what the adapter owns, what the core
owns, and where degradation is a business rule rather than an SDK detail.

## The SDKs, and one exception to where they live

[`server/src/adapters/llm/`](../../../../server/src/adapters/llm/) holds
`anthropic.ts` (`AnthropicProvider`, wrapping `@anthropic-ai/sdk`), `openai.ts`
(`OpenAIProvider`, wrapping `openai`), and `pricing.ts` (the static cost
table — see below). Both classes implement `LLMProvider`, and nothing outside
this directory imports `@anthropic-ai/sdk` or `openai` directly.

OpenRouter is the exception, and it is worth knowing about before you go
looking for an `openrouter.ts` here: `OpenRouterProvider` physically lives in
[`reviewer-core/src/llm/openrouter.ts`](../../../../reviewer-core/src/llm/openrouter.ts),
imported into `server` via `@devdigest/reviewer-core`. Its own doc comment
explains why — it is "owned by the engine because BOTH consumers need it: the
CI runner (the GitHub Action runs reviewer-core directly) and the studio
server's openrouter path." OpenRouter is OpenAI-compatible, so the class drives
it with the `openai` SDK pointed at OpenRouter's `baseURL`; only
`completeStructured` is implemented, the rest are stubs. The ring placement is
unchanged — it is still a driven adapter, still implements `LLMProvider`, and
[`server/src/platform/container.ts`](../../../../server/src/platform/container.ts)
is still the only place that constructs it — the physical file is just outside
`server/`'s own tree because a second package consumes it too.

## What belongs in the adapter, not the use-case

- **Model selection.** The core asks for a provider by id
  (`container.llm('openai' | 'anthropic' | 'openrouter')`, per
  `rules/di-container.md`'s `llm(provider: Provider)` shape); which concrete
  class backs that id is the adapter's business, not the service's.
- **Retries and backoff** live in
  [`platform/resilience.ts`](../../../../server/src/platform/resilience.ts):
  `withTimeout` races a promise against a `TimeoutError`, and `withRetry` retries
  with exponential backoff (`baseDelayMs * 2^attempt`, capped at `maxDelayMs`,
  plus jitter) when `isRetryable` says so — by default, HTTP 429/5xx or
  `ECONNRESET`/`ETIMEDOUT`/`ENOTFOUND`. A service calling an LLM should never
  need to know a call was retried.
- **Token counting** goes through the `Tokenizer` port in
  [`server/src/adapters/tokenizer/index.ts`](../../../../server/src/adapters/tokenizer/index.ts) —
  one method, `count(text: string): number`. `TiktokenTokenizer` wraps
  `js-tiktoken`'s `cl100k_base` encoding and, per its own comment, is scoped
  in-process to the repo-map budget search under `modules/repo-intel`; on
  encoder failure it falls back to the `approxTokens` heuristic
  (`ceil(chars / 4)`) rather than throwing, because the repo-map renderer must
  never fail a review over a tokenizer glitch.
- **Cost estimation** is two layers.
  [`adapters/llm/pricing.ts`](../../../../server/src/adapters/llm/pricing.ts)
  exports `estimateCost(model, tokensIn, tokensOut)`, a static USD-per-1M-token
  table for OpenAI and Anthropic models (an unknown model returns `null`, not a
  guess).
  [`platform/price-book.ts`](../../../../server/src/platform/price-book.ts)'s
  `PriceBook` class sits in front of it: it caches OpenRouter's live `/models`
  pricing for six hours and prefers that when available, falling back to the
  static table for non-OpenRouter models or a cold/expired cache. `estimate()`
  is deliberately synchronous — it is injected into the OpenRouter provider's
  per-call cost hook, which cannot `await` — so a background refresh runs
  fire-and-forget while the current call uses whatever price is already
  cached.

## What belongs in the core

Prompt assembly and the grounding gate are business rules, not adapter
concerns, and both must be testable against a fake `LLMProvider` with no
network. Per `server/CLAUDE.md`'s "Known cruft" note,
`platform/{prompt,grounding,structured}.ts` in `server/src` are 3-line
re-export shims to `reviewer-core` — the real implementation (e.g.
`reviewer-core/src/grounding.ts`) lives in that package. Import from
`@devdigest/reviewer-core` directly in new code rather than through the shim.
What to do with a finding that fails the grounding gate — drop it, flag it,
demote its severity — is exactly the kind of decision this rule cares about:
it is domain policy, and it belongs where a unit test can exercise it without
a real model call.

## Degradation is a domain decision

Two concrete examples of the same principle. `modules/agents/service.ts` wraps
its `listModels()` call in a `try`/`catch` that returns `[]` on failure — when
no key is configured for a provider, the model picker in the editor still
renders, just empty, instead of the whole page failing. And per
`server/CLAUDE.md`, repo-intel enrichment is best-effort: a failure there
degrades to "section omitted" in the review output and logs to the run log; it
must never fail the review itself. Neither of these is an SDK-level retry —
they are decisions about what "acceptable" looks like when an external system
is unavailable, which is why they belong in the core alongside the rest of the
business rules.

## Every terminal path persists

`server/CLAUDE.md`'s "Runs, SSE, jobs" section states this precisely: success,
failure, and cancellation must each persist a status *and* a `run_traces`
document, or the UI shows a run stuck at "running" after reload. Cancellation
itself is in-memory only — a `Set` in `RunBus`
([`platform/sse.ts`](../../../../server/src/platform/sse.ts)) — and does not
survive a restart, which is why `buildApp()` awaits a stale-run reaper before
it starts listening. An LLM adapter change that adds a new failure path (a new
provider, a new retry exhaustion case) must still land on one of these three
terminal outcomes; there is no fourth path that skips persistence.

## Secrets

Per `server/CLAUDE.md`: secrets go through `container.secrets` only.
`process.env` is read in exactly two places — `platform/config.ts` and
`adapters/secrets/local.ts` — and an LLM adapter should never become a third.
After a key is written, call `container.invalidateSecretCaches()`; on
`Container` this clears the cached LLM providers as well as `_github` and
`_embedder`, so a newly-entered API key takes effect on the next call instead
of reusing a client built with the missing-key error already baked in.

## Model IDs, pricing tables, and API parameters

Not this file's job. For which model ids exist, current per-token pricing, and
the shape of API calls (streaming, tool use, structured output parameters),
use the `claude-api` skill. This file is only about which ring a concern lives
in.

## Related

- [`rules/layers.md`](layers.md) — the `adapters/<x>/` row and
  `adapters-no-modules`.
- [`rules/di-container.md`](di-container.md) — `AgentsServiceDeps`'
  `llm(provider: Provider)` shape, and the container as the one place that
  constructs a provider.
- [`rules/testing.md`](testing.md) — testing prompt assembly and the grounding
  gate against a fake `LLMProvider`, with no network.
- [`server/CLAUDE.md`](../../../../server/CLAUDE.md) — the run-lifecycle,
  secrets, and known-cruft sections cited above.
