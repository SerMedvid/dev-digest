# `@devdigest/reviewer-core` — working notes

Read [`README.md`](README.md) first (the pipeline diagram and public API), and
[`../docs/agent-prompts/README.md`](../docs/agent-prompts/README.md) before
touching prompt assembly or the output contract — it documents why the JSON shape
must **not** be described in prompt text. Root rules: [`../CLAUDE.md`](../CLAUDE.md).

Package manager: **npm** (`package-lock.json`) — not pnpm.

## Docs & specs

- [`docs/`](docs/) — engine-scoped documentation: grounding rationale, scoring
  calibration, the single-pass/map-reduce trade-off.
- [`specs/`](specs/) — per-stage contracts and **invariants**. The invariants below
  are exactly what belongs there, including the deliberate non-guarantees.
- [`INSIGHTS.md`](INSIGHTS.md) — non-obvious things earlier sessions learned here.
  Read it before you start; append via the `engineering-insights` skill.

Both have a README stating what belongs in them. Prompt-authoring conventions are
*not* here — they live in
[`../docs/agent-prompts/`](../docs/agent-prompts/README.md).

## The purity rule

`diff → prompt → LLM → grounded findings`. **No DB, no GitHub, no filesystem, no
`fetch` of its own.** The single side effect is a call through the *injected*
`LLMProvider`. That's what makes the engine mock-testable and what lets the
studio server and (from L06) the CI runner share one review path.

Concretely, in this package:

- Don't import `node:fs`, `postgres`, `drizzle-orm`, `octokit`, or anything from
  `server/`. Runtime deps are `zod` + `openai` only.
- Don't add a new runtime dependency without a strong reason.
- Callers own I/O and error types. The engine takes `onEvent` for progress and
  `checkCancelled` — which the caller implements to **throw** — so cancellation
  needs no engine-side error class.
- Anything resolved from the outside (skill bodies, memory, specs, repo map) must
  arrive as an already-resolved **string**. The engine never fetches context.

## Two wiring surprises

- `@devdigest/shared` here aliases to **`../server/src/vendor/shared/`** — this
  package reads the *server's* copy of the contracts, not the client's.
- `zod` is explicitly pinned to `./node_modules/zod` in
  [`tsconfig.json`](tsconfig.json) to stop the alias pulling in a second zod
  instance. Leave that path mapping alone.

Never emits JS: `build` is `tsc --noEmit`, and consumers import the TypeScript
source through their own path alias. Don't add an `outDir` or a `main`.

## Invariants the rest of the system depends on

Change any of these and the UI starts contradicting itself:

- **Grounding is mandatory and mechanical.** A diff-finding survives only if its
  line range intersects a real hunk for that file
  ([`grounding.ts`](src/grounding.ts)). Kinds in `FULL_FILE_KINDS` only need the
  file to be present. Dropped findings are returned with reasons — never silently.
- **`score` is recomputed from the *grounded and scoped* findings**
  (`scoreFromFindings`: CRITICAL −35, WARNING −12, SUGGESTION −3). Since L03 the
  intent scope gate ([`scope.ts`](src/scope.ts)) runs after grounding and before
  scoring, so the score always matches the findings the user actually sees. The
  model's self-reported score is discarded. Don't reintroduce it.
- **`verdict` is passed through from the model** — currently the one number/field
  that can disagree with the findings beneath it. That's known, and it's why the
  verdict conventions in `docs/agent-prompts/` are load-bearing. Deriving it
  deterministically is a real change, not a refactor — don't do it incidentally.
- **Structured output is enforced out of band** via `response_format`
  `json_schema` (`strict: true`) from the Zod `Review` contract — not by prompt
  text.

## Prompt assembly

[`prompt.ts`](src/prompt.ts) is the one trusted defense point:

- **All** external content — diff, PR description, repo map, callers, specs — goes
  through `wrapUntrusted()`. Adding a new context slot without wrapping it opens
  an injection path.
- `INJECTION_GUARD` is appended to every agent's system prompt on every path. It
  is the *general* defense; we deliberately do **not** keyword-scan untrusted text
  (a denylist catches one phrasing in one language). Strengthen the guard rather
  than adding pattern matching downstream.
- Empty/undefined slot ⇒ section omitted entirely. Preserve that: it's how
  feature flags stay behaviour-neutral when off.

## Tests

`npm test` — hermetic, stubbed `LLMProvider`, no keys and no network. Cover the
seams: prompt assembly, the grounding gate, reduce, and a full `run`. `npm run
typecheck` doubles as the build.
