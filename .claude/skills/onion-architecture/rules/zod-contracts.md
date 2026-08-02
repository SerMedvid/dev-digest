# Zod — validation vs. domain types

`SKILL.md` puts Zod at the boundary only: edge validation and LLM
structured-output contracts, never the domain itself. This file is that split
in detail — the two roles Zod plays, where a shared schema lives, and the trap
that comes from `@devdigest/shared` being two physical copies.

For schema-authoring mechanics — `z.object`, refinements, `safeParse`,
`z.infer` — see the `zod` skill. This file is only about where a schema is
allowed to sit.

## Zod lives at boundaries, never in the domain

Domain types are plain TypeScript types in a module's `domain.ts`. A Zod
schema in a `service.ts` signature is a sign the HTTP or LLM boundary has moved
inward — the core should receive already-validated plain data, not a schema
object it has to parse itself. If a service needs to call `.parse()`, that
call belongs at the edge that produced the untrusted value, not partway
through the use-case.

## Two distinct roles

Zod does two unrelated jobs in this codebase, and a schema doing one should
not be reused for the other just because the shapes look similar:

1. **HTTP edge validation**, declared next to the route and wired in through
   `fastify-type-provider-zod` (`validatorCompiler` / `serializerCompiler` in
   [`src/app.ts`](../../../../server/src/app.ts)). This schema describes what
   an HTTP client is allowed to send and what the route is allowed to answer —
   it is a contract with the network, not with the domain.
2. **LLM structured-output contracts**, passed as the `schema` in a
   `completeStructured({ schema })` call (see the `StructuredRequest`/
   `LLMProvider` shape in
   [`vendor/shared/adapters.ts`](../../../../server/src/vendor/shared/adapters.ts)).
   This schema describes what the model must produce — a contract with an
   external SDK, not with an HTTP client.

Two PR-review fields that happen to both be `{ severity: string }` are not the
same contract merely because they parse the same shape; one changes when the
API changes, the other when the prompt or model changes, and coupling them
means an unrelated change on one side breaks a `.parse()` on the other.

## Shared contracts

Cross-package request/response and structured-output shapes live under
[`src/vendor/shared/contracts/*.ts`](../../../../server/src/vendor/shared/contracts/)
— for example `review-api.ts`, `findings.ts`, `observability.ts`, `trace.ts`,
`brief.ts`, `knowledge.ts`, `eval-ci.ts`, `productionize.ts`, `why.ts`, and
`platform.ts`. When describing one of these in code review or a doc, name the
contract file rather than restating its field list — the file is the source of
truth and a restated list drifts the moment the schema changes.

## The two-copies trap

The root [`CLAUDE.md`](../../../../CLAUDE.md) states this concretely:
`@devdigest/shared` is a tsconfig path alias that resolves to **two physical
directories** — `server/src/vendor/shared/` for `server/` and
`reviewer-core/`, and `client/src/vendor/shared/` for `client/`. Nothing keeps
them in sync, and per that same file `adapters.ts`, `contracts/trace.ts`,
`knowledge.ts`, `eval-ci.ts`, and `productionize.ts` have **already drifted**,
with the client copy behind. Changing a shared contract means editing both
physical files, then typechecking both packages
(`cd server && pnpm typecheck` and `cd client && pnpm typecheck`) — a
server-only edit compiles green and only breaks the client build later, in
someone else's session.

The same root doc calls out the corollary: each package installs its own
`zod`, so `err instanceof z.ZodError` can be `false` across the boundary even
for a genuine `ZodError`. `server/src/app.ts`'s error handler already works
around this by matching by shape as well as by `instanceof` — see
`rules/fastify.md`. Never add a new cross-package `instanceof` check against a
library class; it will pass in one package's tests and silently fail in the
other's.

## Related

- [`rules/fastify.md`](fastify.md) — the HTTP-edge half of this split, and
  the shape-matching `ZodError` fallback in `app.ts`.
- [`rules/di-container.md`](di-container.md) — the same two-copies trap, as it
  applies to a port interface rather than a Zod schema.
