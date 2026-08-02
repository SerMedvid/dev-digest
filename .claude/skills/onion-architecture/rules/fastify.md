# Fastify — routes as driving adapters

`SKILL.md` puts Fastify in the driving-adapter ring: `routes.ts` / `app.ts` /
`server.ts` only, `FastifyRequest`/`Reply` never crossing into a service. This
file is that boundary in detail — what a route may do, what it must hand off,
and the two known ways this codebase already breaks the rule.

For hooks, serialization, and plugin mechanics, see the
`fastify-best-practices` skill. This file is only about the boundary.

## A route does four things

Validate input, resolve context, call **one** use-case, map the result to a
DTO. Anything else — a second use-case call, business logic, a raw query —
belongs in the service, not the route. If a route grows an `if` that decides
*what* happens rather than *how to respond*, that branch is the service's job.

## `FastifyRequest` / `FastifyReply` stop at the route

A service signature never mentions them. Tenancy is resolved once, at the
route, via
[`getContext(container, req)`](../../../../server/src/modules/_shared/context.ts),
which returns `{ workspaceId, userId }` (see the `RequestContext` interface
there). Those two strings travel onward as plain arguments — the service takes
`workspaceId: string`, not `req: FastifyRequest`. That is what keeps
`service.ts` testable with no HTTP: a fake `workspaceId` costs nothing to
construct, a fake `FastifyRequest` is a chore.

## Workspace scoping is load-bearing

Quoting [`server/CLAUDE.md`](../../../../server/CLAUDE.md): "Every route calls
`getContext(container, req)` and scopes queries by `workspaceId`. Auth is a
stub today, but the scoping is load-bearing — a query without it is a bug, not
a shortcut." `LocalNoAuthProvider` always resolving to the same default
workspace does not make the parameter optional; it makes every route's
`workspaceId` argument the seam that a real `AuthProvider` slots into later
without touching a single call site.

## Registration stays static

Adding a module is one import plus one entry in
[`src/modules/index.ts`](../../../../server/src/modules/index.ts). Do not
switch this to `@fastify/autoload` or a dynamic `import()` of a `.ts` file —
the dependency being present in `package.json` is not an invitation to use it.
As `server/CLAUDE.md` and the comment on `modules` in `modules/index.ts` both
say, the static form is what runs identically under tsx, vitest, and a
bundler; native dynamic `import()` of TypeScript source is not portable across
those three, and autoload's filesystem scan is exactly the kind of
environment-dependent behaviour this project avoids.

## Errors

Throw `AppError` or `NotFoundError` from
[`platform/errors.ts`](../../../../server/src/platform/errors.ts) and let the
handler in [`src/app.ts`](../../../../server/src/app.ts) map them to a status
code. Do not hand-build a `reply.status(...)` for a domain failure inside a
route — that is the handler's one job, and duplicating it in a route is how
the two drift.

That handler is also where the two-physical-`zod`-installs problem in the
`CLAUDE.md` two-copies note becomes visible in code, not just in principle.
`server/src/app.ts` checks `err instanceof z.ZodError` first, but then falls
back to matching the error **by shape** — `name === 'ZodError'` plus an
`issues` or `errors` array — because a `.parse()` call made against the
`zod` installed under `reviewer-core/` or `@devdigest/shared` can throw an
instance that fails `instanceof` against the `zod` installed under `server/`.
Keep that fallback; it is not defensive clutter, it is the fix for a real
cross-package failure mode. Do not "clean it up" to a single `instanceof`
check.

## The four known offenders

`polling/routes.ts`, `pulls/routes.ts`, `settings/routes.ts`, and
`workspace/routes.ts` query Drizzle directly instead of going through a
repository, and all four are in
`server/.dependency-cruiser-known-violations.json` — eight of the baseline's
24 frozen entries (two per file: the `drizzle-orm` import and the
`src/db/schema.ts` import), per `rules/layers.md`. They predate the
`routes-no-persistence` gate rule. Do not copy the pattern into a new route
or a route you are extending; if you touch one of these four, moving its
queries into a `repository.ts` shrinks the baseline, which is the only
direction it is allowed to move.

## Related

- [`rules/layers.md`](layers.md) — the `routes.ts` row of the import matrix
  and the `routes-no-persistence` rule.
- [`rules/drizzle.md`](drizzle.md) — where those four routes' queries belong
  instead.
- [`rules/zod-contracts.md`](zod-contracts.md) — the HTTP-edge half of the
  Zod split; `fastify-type-provider-zod` is what wires it into the route.
