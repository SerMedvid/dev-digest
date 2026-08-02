---
name: frontend-architecture
description: "Where frontend code lives and how it is layered — folder structure, component decomposition, constants, utils/helpers, business-logic placement, module boundaries, and Next.js App Router architecture. Use when creating a new component/feature/route, deciding where a file belongs, splitting an oversized component, extracting shared code, reviewing structure, or planning a refactor. Complements react-best-practices (runtime behaviour) and next-best-practices (framework conventions and performance)."
---

# Frontend Architecture

Answers one class of question: **where does this code belong, and what may it import?**

Runtime behaviour is out of scope — for hooks, effects, memoization, keys and rendering
see [`react-best-practices`](../react-best-practices/SKILL.md); for RSC conventions,
metadata and bundle optimisation see [`next-best-practices`](../next-best-practices/SKILL.md).
Those two answer *how code behaves*. This one answers *where it goes*.

**Supporting files**

| File | Use it for |
|---|---|
| [`decisions.md`](decisions.md) | The contested calls — barrels, segment naming, component size, state libraries. Read before ruling on any of them. |
| [`examples.md`](examples.md) | Folder trees and good/bad code for every rule below. |
| [`references.md`](references.md) | ~120 sourced citations, tiered, with the conflicts recorded. |

**Severity**

- **CRITICAL** — creates cycles, leaks data, or forces a later rewrite
- **HIGH** — degrades maintainability or velocity as the codebase grows
- **MEDIUM** — consistency and ergonomics

---

## 0. Two facts that shape everything below

**There is no official structure to appeal to.** react.dev has no file-structure page; the
only official React statement is the legacy FAQ, which caps deliberation at *five minutes*
and at 3–4 levels of nesting. Next.js calls itself "unopinionated" and lists three equally
valid strategies. Anyone citing an "official React project structure" is citing something
that does not exist.

**So argue from consequences, not authority.** Every rule here states what breaks if you
ignore it. Where credible sources genuinely disagree, this skill gives a decision procedure
and the evidence on both sides rather than inventing a consensus — see [`decisions.md`](decisions.md).

---

## 1. Where code lives (CRITICAL)

### 1.1 Match the structure to the scale

Do not adopt more architecture than the project has earned. Reorganise **on pressure, not on
prediction** — every evolutionary source (Wieruch, Kettmann, the React FAQ, even the FSD
tutorial's three-layer start) frames structure as something you migrate into.

| Scale | Structure | Move on when |
|---|---|---|
| Small (< ~20 components) | Flat `src/components/`, one folder per component | `components/` mixes unrelated domains |
| **Medium (a team, several product areas) — the default** | `src/features/<domain>/` + a thin shared tier (`components/`, `lib/`, `hooks/`) | Multiple teams collide, or domain logic is genuinely reused across apps |
| Large (multi-team, or shared domain logic) | Explicit layers (FSD) or tagged packages (Nx), `apps/` + `packages/` with `exports` subpaths | — |

### 1.2 Colocate by default; promote on the second consumer

Code lives next to its only consumer. It moves outward when a **second** consumer actually
appears — never for a hypothetical one.

```
component-local  →  feature-local  →  shared tier  →  package
```

The strongest argument for colocation is not tidiness but **responsible deletion**: when a
feature is removed, everything it owned goes with it. Code parked in a global `utils/`
outlives its last caller silently.

- **CRITICAL** — Never pre-place code in a shared folder for reuse that has not happened.
  Identify repetition *before* abstracting; a wrong abstraction costs more than duplication.
- **HIGH** — Promotion is a deliberate act: give the thing a domain name, its own tests, and
  an explicit export list at the moment it becomes shared.

### 1.3 Dependencies flow one way and never cycle

This is the rule that actually holds the architecture together — more than any folder name.

```
shared  →  features  →  app/routes
```

- **CRITICAL** — `shared/` may never import from `features/` or `app/`.
- **CRITICAL** — **No cross-feature imports.** Compose sibling features at the route or app
  level. If two features must share something, that something belongs one layer down.
- **CRITICAL** — Any shared `types/` folder sits in the shared tier and obeys the same rule.
  A "shared types" folder that may import from features becomes the cycle hub of the codebase.
- **HIGH** — The top-level listing should name the domain, not the framework. `features/reviews`,
  `features/repos` tells a reader what the product is; `components/`, `hooks/`, `contexts/`
  only tells them it is React.

### 1.4 Cap the depth, alias the crossings

- **MEDIUM** — Maximum 3–4 levels of nesting.
- **MEDIUM** — Path aliases (`@/…`) for anything crossing a folder boundary; relative imports
  only for same-directory siblings. Register the alias in `tsconfig.json` **and** the bundler,
  or dev and prod diverge.

### 1.5 Atomic Design is a UI-kit vocabulary, not an app structure

Brad Frost designed it as a shared vocabulary and said explicitly it "is not a linear
process". It has no answer for where business logic lives, and `atoms/molecules/organisms`
folders structurally violate colocation — one feature's parts end up in three trees.

- **HIGH** — Use it, if at all, *inside* a UI-kit package. Never as the top-level app structure.

---

## 2. How components split (HIGH)

### 2.1 Split on a trigger, not on a line count

**No credible source publishes a line-count or prop-count threshold.** Infinum's engineering
handbook deliberately gives none. Treat any "max 150 lines / max 5 props" rule as folklore.

Split when one of these fires:

1. **Two responsibilities.** The component both *implements* markup and *orchestrates* other
   components. Go all the way — a component is either one or the other, never both.
2. **State that isn't its business.** A `useState` read by exactly one subtree belongs in that
   subtree. This is the highest-value split: it fixes readability and re-renders at once.
3. **A prop threaded through a layer that never reads it.** Restructure that layer to take
   `children`, or push the state down.
4. **`{...props}` spreading routinely.** Official smell: "If you're using it in every other
   component, something is wrong."
5. **Measured re-render cost** — not suspected.
6. **Reuse actually happened** — a second real caller exists.
7. **You need a boundary** — `key`-reset, an imperative API wrapped, a third-party integration
   isolated, or a client leaf inside a server tree.

Do **not** split to DRY near-duplicate JSX, for speculative reuse, or because a file feels long.

- **CRITICAL** — Never define a component inside another component. Its state resets on every
  parent render.
- **MEDIUM** — Long returned JSX is acceptable; long *logic* is the real signal. See
  [`decisions.md`](decisions.md) for the sourced disagreement here.

### 2.2 Pattern preference order

Reach for the cheapest thing that works:

1. **`children`** — the default for wrappers and layout
2. **Element props** (`icon`, `header`, `footer`) — render in a fixed place, unmodified
3. **`useReducer`** — many handlers mutating related state; one action per user interaction
4. **Custom hook** — logic reuse across ≥ 2 real call sites
5. **Compound components + context** — a component family whose flat prop API has gone verbose
6. **`ComponentType` prop / render prop** — the receiver must control the child's props, or
   hand render-time values back to consumer markup
7. **Headless (logic hook + unstyled primitives)** — many visual treatments over one behaviour
8. **`asChild` / Slot** — only to avoid a wrapper DOM node; hard contract (spread all props,
   forward refs, single root, no fragments)

Container/Presentational is **retracted** — Dan Abramov, 2019: "I don't *suggest* splitting your
components like this anymore." Keep the logic/markup separation; drop the mandatory `*Container`
wrapper. The substance survives as custom hooks and headless components.

### 2.3 Prop drilling is verbose, not wrong

react.dev is explicitly pro-drilling: passing a dozen props through a dozen components "makes it
very clear which components use which data". Escalate in order — props → extract components and
pass `children` → context. Context is dependency injection (theme, current user, routing, a
store handle), not a prop-drilling anaesthetic.

- **HIGH** — Before adding context, try composition: pass built elements
  (`header={<Header user={user} />}`) instead of threading `user` down. Elements created in the
  outer component are not re-created when the inner one re-renders — a memo-free optimisation.

---

## 3. Constants, utils, types, env (HIGH)

### 3.1 Three different things — don't merge them

| Kind | Varies by | Lives in |
|---|---|---|
| **Constants** | nothing — compile-time invariants | colocated, then feature, then shared |
| **Config** | environment/deploy | one validated module (§3.4) |
| **Feature flags** | runtime, per user | a provider reading remote config, never `constants.ts` |

- **MEDIUM** — Prefer `as const` objects + derived unions over `enum`. The TypeScript Handbook
  itself now says "you may not need an enum when an object with `as const` could suffice".
  Numeric enums have an assignability hole, enums are nominally typed, and reverse-map emission
  is inconsistent between numeric and string variants.
- **CRITICAL** — Never `const enum` in a codebase with `isolatedModules`.

### 3.2 Ban the meaningless folder names

`utils`, `helpers`, `common`, `misc`, `shared` give no admission criteria, so nothing is ever
rejected and the folder becomes a dump.

- **HIGH** — Name modules for their domain: `datetime.ts`, `currency.ts`, `permissions.ts`.
- **HIGH** — If a `utils/` directory must exist, it is a *namespace of domain files*
  (`utils/array.ts`, `utils/url.ts`) — never a single `utils.ts`.
- **MEDIUM** — Graduate a helper into its own named module when it has 2+ cross-feature
  consumers, its own invariants, or enough surface to need tests and docs.

If the codebase already distinguishes them, the workable line is: **helper** = project-specific,
**util** = generic and portable to any project, **lib** = wrapper around a third-party dependency.
Sources disagree that the distinction is real at all — consistency matters more than the choice.

### 3.3 Types live with what they describe

- **HIGH** — Colocate (`Component.types.ts`, `features/x/types.ts`). Reserve a root `types/`
  for ambient declarations and module augmentation, not domain models — otherwise it degrades
  exactly like `utils/`.
- **HIGH** — For contracts shared with a backend, make a schema the single source of truth
  (Zod / Standard Schema) and derive types with `z.infer`. One definition, validated at runtime
  and typed at compile time, so the two cannot drift.

### 3.4 Exactly one module reads the environment

- **CRITICAL** — One module reads `process.env` / `import.meta.env`; everything else imports
  from it. This is not stylistic: **dynamic lookups are not inlined**. `process.env[name]` and
  `const e = process.env; e.NEXT_PUBLIC_X` both silently yield `undefined` in the browser bundle.
- **CRITICAL** — Every `NEXT_PUBLIC_*` / `VITE_*` value is public and **frozen at build time**.
  No secrets, and no expectation that it can change post-build.
- **HIGH** — Validate that module's schema at startup so a missing variable fails the build, not
  production. A `d.ts` augmentation is *declared* typing — it lies when the variable is absent.

---

## 4. Where business logic lives (CRITICAL)

### 4.1 The placement ladder — take the first that fits

1. **Pure TS module** (`domain/`, or a named module in the feature) — anything computable from
   inputs. No React import. Unit-testable with no rendering.
2. **Reducer / store action** — state transitions. Pure, event-named, testable in isolation.
3. **Custom hook** — only when React primitives are genuinely needed.
4. **Component** — rendering and event wiring only.

**Testability is the tiebreaker.** Logic in a pure module or reducer is a genuinely testable
public unit. Logic in a custom hook is neither cleanly unit-testable (Testing Library: "you
should prefer `render`"; `renderHook` is for library authors) nor cleanly integration-testable
(it is an implementation detail). If a piece of logic can only be tested via `renderHook`, it is
in the wrong place.

- **CRITICAL** — If a function calls no hooks, it is not a hook. `getSorted`, not `useSorted` —
  a plain function can be called anywhere, including conditionally.
- **HIGH** — Never write `useMount` / `useEffectOnce` / `useUpdateEffect`. Lifecycle wrappers are
  an explicit React anti-pattern.
- **HIGH** — Don't extract a hook wrapping a single `useState`. Some duplication is fine.
- **HIGH** — To isolate re-renders, extract a **component**, not a hook. A stateful custom hook
  re-renders its host on every internal state change, memoization notwithstanding — it has
  effectively lifted that state to the call site.

### 4.2 Decide state placement in this order

1. **Owned by the server?** → a server-state library (TanStack Query / RTK Query). It is a
   snapshot you hold, not data you own.
2. **Should it survive refresh, be shareable, be bookmarkable?** → URL search params, schema-
   validated at the route boundary.
3. **Being edited in a form?** → the form library.
4. **Otherwise** → local `useState`, lifted only to the least common ancestor. A store only past that.

- **CRITICAL** — Never copy server-state into `useState` or a client store. You silently opt out
  of every background update.
- **HIGH** — Client stores hold client-only state (theme, sidebar, wizard step). Not server data.
- **MEDIUM** — Context is DI, not state management. Past 2–3 state-bearing contexts, adopt a real store.

### 4.3 One data-access path

- **CRITICAL** — Components never call `fetch` directly.
- **HIGH** — One pre-configured client instance owns auth headers, retries and **error
  normalisation**, so every consumer branches on one error shape.
- **HIGH** — An endpoint declaration is three colocated things: schema/types + fetcher + hook.
  Per-feature `api/`; hoist to shared only on real sharing.
- **HIGH** — Query keys live in a per-feature factory (`all` → `lists()` → `detail(id)`), ordered
  generic → specific. Every dynamic parameter belongs in the key. Export hooks; keep keys and
  query functions module-private.
- **HIGH** — Choose one data-fetching approach per codebase and do not mix them.

---

## 5. Next.js App Router architecture (CRITICAL)

> Written against **Next.js 16**. The load-bearing change: **`middleware.ts` is deprecated and
> renamed `proxy.ts`**, and the framework now calls it a last resort. Guidance written for
> Next 13–15 is stale on this point.

### 5.1 Routes are one axis, features are another

`app/` mirrors URLs; features mirror the domain. Both camps in the literature agree on the
dependency invariant and differ only on folder placement, so resolve it by **reuse**:

- **HIGH** — Colocate in the route segment (`_components/`, `_lib/`) while a single route uses it.
  The moment a second route needs it, promote to `features/<domain>/` with an explicit public API.
- **MEDIUM** — Use `_private` folders even though colocation is already safe: their durable value
  is collision-proofing against *future* Next.js file conventions.
- **MEDIUM** — Route groups `(marketing)` / `(app)` / `(admin)` encode access posture, not just
  tidiness. Two groups must never resolve the same path — that is a build error. A second **root**
  layout is an app boundary: crossing it costs a full page reload.
- **MEDIUM** — Reach for `@slots` only for independent streaming, per-region loading/error
  boundaries, role-conditional layouts, or URL-addressable modals — never as general organisation.

If you adopt `src/`: `src/app` is **silently ignored** when a root `app/` also exists, and
`proxy.ts` must move inside `src/`.

### 5.2 `layout.tsx` is a shell, `page.tsx` is the composition root

The framework constrains this — these are not preferences:

- `layout.tsx` **does not re-render on navigation**, has **no `searchParams` and no `pathname`**,
  and **cannot pass data to `children`**. The sanctioned answer to the last one is to refetch in
  both places and let `React.cache` / fetch dedup collapse it. Do not invent prop-drilling workarounds.
- **CRITICAL** — No authorization checks in layouts, and no `return null` guards. Both are
  explicitly discouraged: layouts don't re-check on navigation, and the app has multiple entry
  points. Check at the data layer, which every path must traverse.
- **HIGH** — Never top-level-`await` runtime data in a layout: it holds `{children}`, and
  `loading.js` sits below the layout so it cannot cover it. Push the work into a nested Server
  Component under its own `<Suspense>`.

So: **`layout.tsx` = shell + providers + slots. `page.tsx` = resolve params, call the data layer,
compose feature components.** Business logic belongs in the feature module.

### 5.3 The client boundary is a module-graph boundary

- **CRITICAL** — `'use client'` marks a module *and all its transitive imports* as client code.
  It belongs on **leaves**. A `'use client'` on a layout, page, or large section component is a defect.
- **CRITICAL** — Cross the boundary with `children`/props, never imports. Server Components passed
  as props are not pulled into the client module graph — they render on the server and arrive as output.
- **HIGH** — Providers wrap `{children}`, never `<html>`.
- **HIGH** — The same file can be server or client depending on who imports it. The question is
  never "is this component server or client?" but "who imports it?".
- **HIGH** — Wrap client-only third-party components in your own one-line `'use client'` re-export
  instead of pushing the boundary upward.

### 5.4 Data access layer

- **CRITICAL** — Anything touching secrets, the database, or internal business logic is marked
  `import 'server-only'`. **Only the data-access layer reads `process.env`.** Client Components
  must not be able to import it.
- **CRITICAL** — Never pass a raw database row into a Client Component. Return minimal,
  purpose-shaped DTOs. A broad prop type (`user: User`) is a review flag — it encourages passing
  everything downward.
- **HIGH** — Wrap identity lookups in `React.cache` so call sites *read the current user back*
  rather than receiving it as a prop. That discourages threading identity through the tree, and it
  also solves the layout-cannot-pass-data problem.

### 5.5 Server Actions are a public HTTP surface

A Server Action is a POST endpoint reachable by anyone who can send the request. A file-level
`'use server'` marks **every export** callable.

- **CRITICAL** — Every action independently: authenticate → authorize **the specific resource** →
  validate input → constrain the return value. A page-level auth check does **not** extend to an
  action defined on that page, and render-time gating is not a security boundary.
- **CRITICAL** — Take an **ID plus the change**, then re-read everything else from a trusted source
  using the session. Schema validation checks *shape*, not ownership: a well-formed object can
  still name a row the caller doesn't own.
- **HIGH** — Actions stay thin: validate → call the service/DAL → revalidate. They are not a
  service layer.
- **HIGH** — Actions dispatch **sequentially per client**. Never `Promise.all` them; parallelise
  inside one action or use a Route Handler.

⚠️ react.dev's Server Functions reference page contains **no** security caveats — those live only
in the Next.js docs. Reading React docs alone leaves this trap open.

### 5.6 Route Handlers vs Server Actions vs a separate backend

| Need | Use |
|---|---|
| Read data for a rendered page | Server Component → data layer, **directly from source** |
| Mutate from your own UI | Server Action (thin) |
| Webhooks, OAuth callbacks, mobile/third-party clients | Route Handler |
| Non-UI content (`rss.xml`, `.well-known`) | Route Handler |
| Genuinely parallel client requests, full HTTP control | Route Handler |
| Existing backend team / non-JS services | Keep the API; fetch it from Server Components |

- **CRITICAL** — Do not build an internal `/api` layer for your own Server Components to fetch
  from. Prerendered pages **fail the build** (no server listening) and on-demand pages pay a
  pointless round trip.
- **HIGH** — `route.ts` cannot coexist with `page.tsx` in the same segment. Route Handlers get
  **no automatic CSRF protection**, unlike Server Actions.

A client-rendered Next app talking to a separate API **is a supported architecture**. Bridge it
with the promise-hoisting pattern — start the fetch unawaited in a Server Component, pass the
promise to a client provider, unwrap with `use()` — rather than `ssr: false` everywhere. In that
setup all authorization lives in the external API and client route guards are UI affordance only.

### 5.7 `proxy.ts` is a last resort

- **CRITICAL** — Never the sole authorization layer. CVE-2025-29927 let a spoofable internal
  header skip middleware entirely; Vercel's own postmortem: "We do not recommend Middleware to be
  the sole method of protecting routes." Enforce close to the data.
- **HIGH** — Cookie-only optimistic checks. No database calls — it runs on every request including
  prefetches. No reliance on shared modules or globals; it may run on a CDN outside your runtime.
- **HIGH** — Always set a `matcher` excluding `_next/static` and `_next/image`, or auth logic
  blocks your own assets. Use an allow list, not a deny list.
- **HIGH** — Server Functions are POSTs to the *page* route, so moving one to another route can
  **silently remove proxy coverage**. Never depend on it for action authorization.

---

## 6. Enforce it, or it decays (HIGH)

An architectural rule that isn't machine-checked is a suggestion. Every boundary above should
fail CI.

- **HIGH** — Encode the dependency direction in `import/no-restricted-paths` zones on day one.
  It's ~15 lines and needs no new dependency. Escalate to `eslint-plugin-boundaries` (public-API
  entry points), `dependency-cruiser` (cycles, orphans, reachability — the whole graph), Nx tags
  (monorepos) or Steiger (FSD) as needed.
- **HIGH** — Run one ESLint-based tool for editor feedback *and* dependency-cruiser in CI for the
  graph properties ESLint cannot see.
- **HIGH** — Enable `import/no-cycle`. Cycles usually surface as unreadable bundler crashes.
- **MEDIUM** — `eslint-plugin-react-hooks` now ships the React Compiler rules (`purity`,
  `immutability`, `set-state-in-effect`, `static-components`, …). These catch structural defects
  no previous linter caught. Note Biome does **not** carry them and is not type-aware.
- **MEDIUM** — Run `knip` in CI with tuned `entry`/`project` globs. Dead exports and orphaned
  components are what rot a feature tree.
- **MEDIUM** — Keep `sortSideEffects: false` in import sorting. Reordering side-effect imports
  changes behaviour.

---

## 7. Contested calls

Do not state a position on these without reading [`decisions.md`](decisions.md) — each has
credible sources on both sides, and several have measurements:

barrel files · segment naming inside a feature · by-function vs by-feature · component size ·
one Zustand store or many · custom hook per query · colocated tests vs `__tests__` ·
file casing · `@apply` · Biome vs ESLint

---

## 8. Appendix — DevDigest (`client/`)

This repo is **Next.js 15 App Router + React 19 + TanStack Query + Tailwind 4**, and is a
**client-side SPA that happens to be Next** — no server actions, no RSC data fetching, no route
handlers proxying the API. §5.4–5.6 therefore apply only if that changes; today **all
authorization lives in the server API**, and client-side guards are UI affordance only.

Local rules that **override** the generic guidance above, per
[`client/CLAUDE.md`](../../../client/CLAUDE.md):

- **Every component is a folder**, not a file: `ComponentName/{ComponentName.tsx, ComponentName.test.tsx,
  constants.ts, helpers.ts, styles.ts, index.ts, _components/}`. This is a per-component barrel
  and it is fine — barrel cost scales with **fan-out per import**, and a barrel re-exporting one
  component is close to free. §7 explains where the cost actually appears.
- **Tailwind classes live in `styles.ts`** as named consts, not inline in JSX. This diverges from
  Tailwind's own duplication ladder (§ `decisions.md`); match the neighbours regardless —
  consistency wins over the upstream preference here.
- `_components/` is for local children; anything reused across routes moves to `src/components/`.
  That is §1.2's promotion rule with the repo's naming.
- **One data path**: component → hook in `src/lib/hooks/` → `api` from `src/lib/api.ts`. Never
  `fetch` from a component. `apiFetch` normalises failures to `ApiError` — this is §4.3's error
  normalisation, already built.
- New endpoint → new hook beside its siblings (`core`, `agents`, `reviews`, `repo-intel`, `trace`)
  with a matching `queryKey` shape and explicit `invalidateQueries` on mutation.
- **`@devdigest/shared` is two physical copies** (`server/src/vendor/shared/` and
  `client/src/vendor/shared/`) and they have already drifted. A contract change must be applied to
  both, and both packages type-checked. This violates §3.3's single-source-of-truth rule — treat
  it as known debt, not a pattern to copy.
- **`@devdigest/ui`** (`src/vendor/ui/`) is a vendored design system. Treat it as third-party:
  compose it, don't refactor it, and never fork a primitive into a feature folder.
- User-facing strings go through `next-intl` message catalogues, not JSX literals.

Read [`client/INSIGHTS.md`](../../../client/INSIGHTS.md) before working there.
