# `@devdigest/e2e` — working notes

Read [`README.md`](README.md) first: it explains the spec format, the env knobs,
and the current flow coverage. Root rules: [`../CLAUDE.md`](../CLAUDE.md).

Package manager: **npm** (`package-lock.json`) — not pnpm.

## Docs & specs

- [`docs/`](docs/) — suite-scoped documentation: debugging flaky waits,
  agent-browser command notes, how the hermetic stack is composed.
- [`specs/`](specs/) — **executable** flow definitions (`NN-name.flow.json`), not
  prose. In this package "spec" means an agent-browser command list; written
  specifications go in `docs/`.
- [`INSIGHTS.md`](INSIGHTS.md) — non-obvious things earlier sessions learned here.
  Read it before you start; append via the `engineering-insights` skill.

## What this is

Deterministic browser flows driven by Vercel **agent-browser** (a Rust+CDP CLI).
**No Playwright, no LLM, no API key.** agent-browser isn't a test framework, so
[`run.ts`](run.ts) adds the convention: a spec is a JSON list of CLI commands run
in order against one shared browser session.

## Rules for specs

- Specs are `specs/NN-name.flow.json`. Each `cmd` is passed **verbatim** to
  agent-browser; a non-zero exit fails the step and the flow.
- **`wait --text` / `wait --url` *are* the assertions** — they exit non-zero on
  timeout. There's no separate assert library; optional
  `"assert": { "stdoutIncludes": … }` adds a substring check.
- **Deterministic locators only**: `--url`, `--text`, `find role|text|label`.
  **Never use the AI `chat` command** — that would make runs non-reproducible and
  require a model key.
- `{BASE}` is substituted with `E2E_BASE_URL`.
- Flows target **read-only seeded data** (`acme/payments-api`, PR #482, the seeded
  agents). Nothing may trigger a model call or mutate state.

## Running — use the hermetic runner

```sh
npm i -g agent-browser && agent-browser install   # once
./scripts/e2e.sh                                  # or: npm run e2e:hermetic
```

`scripts/e2e.sh` boots an isolated freshly-seeded stack on alternate ports
(Postgres 5433, API 3101, web 3100), runs the flows, tears it down, and never
touches your dev DB.

**`npm test` against your own stack usually fails**, and not because of a bug:
flows 02/04/05 follow the home redirect to the *first* repo, so they assume the
seeded demo repo is the only one. Your dev DB has other imported repos.

> **Never `docker compose down -v`** to "reset" a dev DB — it drops
> `devdigest_pgdata` and every imported repo and review with it.

## Adding a flow

Keep it typological: one flow per *journey*, not per assertion. Add the spec, add
a row to the coverage table in [`README.md`](README.md), and check it passes under
`./scripts/e2e.sh` (the CI environment) rather than only locally. Failure
screenshots land in `test-results/` (git-ignored, uploaded as a CI artifact).
