# `@devdigest/web` — working notes

Read [`README.md`](README.md) first: it has the UI route map and which endpoints
each screen leans on. Root rules are in [`../CLAUDE.md`](../CLAUDE.md).

Package manager: **pnpm**. Next.js 15 App Router, React 19, TanStack Query,
Tailwind 4.

## Docs & specs

- [`docs/`](docs/) — UI-scoped documentation: screen walkthroughs, data-flow notes,
  decision records. Anything too long for the README.
- [`specs/`](specs/) — what a screen or flow is *supposed* to do: the journey, all
  its states (loading/empty/error/live), data sources, acceptance checklist.
- [`INSIGHTS.md`](INSIGHTS.md) — non-obvious things earlier sessions learned here.
  Read it before you start; append via the `engineering-insights` skill.

Both have a README stating what belongs in them. Specs describe behaviour, never
markup — a spec that pins class names goes stale immediately.

## Component folder convention — follow it exactly

Every component is a **folder**, not a file:

```
ComponentName/
  ComponentName.tsx      the component
  ComponentName.test.tsx co-located test (where one exists)
  constants.ts           literals, option lists, label maps
  helpers.ts             pure functions
  styles.ts              Tailwind class strings, exported as consts
  index.ts               re-export
  _components/           children used only by this component
```

- **Tailwind classes live in `styles.ts`**, exported as named consts — not inline
  in JSX. Match the neighbours; long `className` literals in a `.tsx` are the
  exception, not the norm.
- `_components/` is for local children; anything reused across routes moves to
  [`src/components/`](src/components/).
- Route files (`app/**/page.tsx`) stay thin — they compose, they don't hold logic.

## Data access

One path only: **component → hook in [`src/lib/hooks/`](src/lib/hooks/) → `api`
from [`src/lib/api.ts`](src/lib/api.ts)**.

- Never call `fetch` from a component. `apiFetch` normalizes failures to
  `ApiError` (with `status`/`code`), which the error-UX taxonomy branches on.
- New endpoint → new hook next to its siblings (`core`, `agents`, `reviews`,
  `repo-intel`, `trace`), with a `queryKey` matching the existing shape and
  explicit `invalidateQueries` on mutation.
- This app is a **client-side SPA that happens to be Next** — no server actions,
  no RSC data fetching, no route handlers proxying the API. Don't introduce one
  without a reason.

## Live run state is two mechanisms, both required

`useRunEvents` opens an SSE `EventSource` per run **and** `usePrRuns` /
`usePrActiveRuns` poll every 4s while anything is `running`. That's not
redundancy to clean up: SSE is in-memory server-side and dies with the process,
so the poll is what recovers after a restart or reload. Note the stream's end is
detected via `onerror` (EventSource has no clean server-closed event) — fragile
by nature, so don't "simplify" it without testing a mid-run API restart.

## The two vendor directories

- [`src/vendor/shared/`](src/vendor/shared/) (`@devdigest/shared`) — Zod contracts.
  **A copy of the server's**, and already drifted. Any contract change must be
  applied to `server/src/vendor/shared/` too. See [`../CLAUDE.md`](../CLAUDE.md).
- [`src/vendor/ui/`](src/vendor/ui/) (`@devdigest/ui`) — vendored design system
  (primitives, kit, shell, charts, command palette). Treat as third-party: compose
  it, don't refactor it, and don't fork a primitive into a feature folder.

## i18n

`next-intl`, messages in `messages/<locale>/*.json` (only `en` today). User-facing
strings go through the message catalogue rather than being hardcoded in JSX.

## Tests

vitest + jsdom with `fetch` mocked — no API, no DB, no browser. Test rendered
behaviour and interaction (React Testing Library), not internals. Real browser
journeys belong in [`../e2e/`](../e2e/README.md), not here.

`pnpm typecheck` before declaring done.
