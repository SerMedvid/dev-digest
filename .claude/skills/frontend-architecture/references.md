# Sources — frontend architecture research

Research pass run **2026-08-02** for the `frontend-architecture` skill. Six parallel
sweeps covering: folder architecture, component decomposition, constants/utils/module
boundaries, business-logic placement, styling/tests/tooling, and Next.js App Router
architecture.

Every URL below was **fetched and read**, not taken from a search snippet. Pages that
404'd, 403'd or failed DNS are listed at the bottom rather than silently dropped.

**Tier legend**

| Tier | Meaning |
|---|---|
| **OFFICIAL** | Framework/library/tool documentation, or a first-party engineering blog |
| **AUTHORITATIVE** | Named author with standing in the ecosystem (maintainers, React team alumni, widely-cited writers) |
| **COMMUNITY** | Named practitioner or org handbook — useful as a field report, not as an authority |

Where a claim is contested, the disagreement is recorded in
[Unresolved conflicts](#unresolved-conflicts) rather than smoothed over. Those are the
places the skill must present a decision procedure instead of a rule.

---

## A. Methodology — whole-application architecture

| # | Source | Tier | What it settles |
|---|---|---|---|
| A1 | [Feature-Sliced Design — Overview](https://feature-sliced.design/docs/get-started/overview) | OFFICIAL | The seven layers, slices, segments; the strictly-below import rule |
| A2 | [FSD — Layers](https://feature-sliced.design/docs/reference/layers) | OFFICIAL | `app`/`shared` are slice-less; layers are optional; **segments named by purpose, not essence** |
| A3 | [FSD — Slices and segments](https://feature-sliced.design/docs/reference/slices-segments) | OFFICIAL | Same-layer slices may not import each other; `ui`/`api`/`model`/`lib`/`config` |
| A4 | [FSD — Public API](https://feature-sliced.design/docs/reference/public-api) | OFFICIAL | Public-API contract, `@x` cross-imports, and FSD's own admission of index-file costs |
| A5 | [FSD — Tutorial](https://feature-sliced.design/docs/get-started/tutorial) | OFFICIAL | Start with three layers; "avoid excessive decomposition" |
| A6 | [FSD — Alternatives](https://feature-sliced.design/docs/about/alternatives) | OFFICIAL | The Atomic Design critique; comparisons vs DDD/Clean Arch are **still WIP** |
| A7 | [FSD blog — Building Scalable Systems](https://feature-sliced.design/blog/scalable-react-architecture) (Evan Carter, 2026-01-16) | OFFICIAL (advocacy) | How type-based structures fragment business logic |
| A8 | [bulletproof-react — repo](https://github.com/alan2207/bulletproof-react) | OFFICIAL (project) | "Not a template… an opinionated guide" |
| A9 | [bulletproof-react — Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) | OFFICIAL (project) | `src/features/*`; unidirectional `shared → features → app`; the copy-pasteable ESLint zones |
| A10 | [bulletproof-react — Components and Styling](https://github.com/alan2207/bulletproof-react/blob/master/docs/components-and-styling.md) | OFFICIAL (project) | Colocate; "identify repetitions **before** creating the components" |
| A11 | [bulletproof-react — API Layer](https://github.com/alan2207/bulletproof-react/blob/master/docs/api-layer.md) | OFFICIAL (project) | One client instance; endpoint = schema + fetcher + hook, colocated |
| A12 | [Redux Style Guide](https://redux.js.org/style-guide/) | OFFICIAL | "Structure Files as Feature Folders" (Priority B); logic in reducers; actions as events |
| A13 | [Redux FAQ: General](https://redux.js.org/faq/general) | OFFICIAL | When *not* to use Redux — Abramov and Pete Hunt quotes |
| A14 | [Nx — Enforce Module Boundaries (features)](https://nx.dev/docs/features/enforce-module-boundaries) | OFFICIAL | `scope:` × `type:` tag axes; untagged projects depend on nothing |
| A15 | [Turborepo — Structuring a Repository](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository) | OFFICIAL | `apps/` vs `packages/`; prefer `exports` over barrels; the `../` smell |
| A16 | [Atomic Design, ch. 2](https://atomicdesign.bradfrost.com/chapter-2/) (Brad Frost, 2016) | OFFICIAL | The five stages — as a **vocabulary**, "not a linear process" |
| A17 | [Where Atomic Design Fell Short](https://bradfrost.com/blog/link/where-atomic-design-fell-short/) (Frost, 2015-03-05) | OFFICIAL | Frost defends only the built-in hierarchy of the naming, never a folder layout |
| A18 | [Screaming Architecture](https://blog.cleancoder.com/uncle-bob/2011/09/30/Screaming-Architecture.html) (Robert C. Martin, 2011-09-30) | OFFICIAL (origin) | "Frameworks are tools to be used, not architectures to be conformed to" |
| A19 | [File Structure — React legacy docs](https://legacy.reactjs.org/docs/faq-structure.html) | OFFICIAL (legacy) | **The only official React statement on structure.** Max 3–4 nested folders; the five-minute rule |
| A20 | [React Folder Structure in 5 Steps](https://www.robinwieruch.de/react-folder-structure/) (Robin Wieruch, upd. 2026-05-05) | AUTHORITATIVE | The evolutionary ladder; move on pressure, not upfront |
| A21 | [Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/) (Josh Comeau, upd. 2025-12-03) | AUTHORITATIVE | The by-function dissent; helpers vs utils; the pro-barrel case |
| A22 | [Screaming Architecture — evolution of a React folder structure](https://dev.to/profydev/screaming-architecture-evolution-of-a-react-folder-structure-4g25) (Johannes Kettmann, 2022-02-25) | AUTHORITATIVE | Five-stage refactor narrative ending in business-entity features |
| A23 | [How to structure your React projects](https://sandroroth.com/blog/project-structure/) (Sandro Roth, 2023-02-16) | AUTHORITATIVE | The substantive critique of bulletproof-react's per-feature type folders |
| A24 | [Clean Architecture on Frontend](https://bespoyasov.me/blog/clean-architecture-on-frontend/) (Alex Bespoyasov, 2021-09-02) | AUTHORITATIVE | domain → application → adapters; prioritize dependency direction over purity |
| A25 | [React project structure for scale](https://www.developerway.com/posts/react-project-structure) (Nadia Makarevich) | AUTHORITATIVE | Layering *inside* a feature: data / shared / UI |
| A26 | [Rethinking Atomic Design in React Projects](https://cheesecakelabs.com/blog/rethinking-atomic-design-react-projects/) (Natam Oliveira, 2019-12-16, upd. 2022) | COMMUNITY | Five observed field failures of literal Atomic Design |
| A27 | [React Guidelines and Best Practices](https://infinum.com/handbook/frontend/react/react-guidelines-and-best-practices) (Infinum handbook) | COMMUNITY | Notable for what it **omits**: no line/prop thresholds, "Guides are not rules" |

## B. React — official docs

| # | Source | Tier | What it settles |
|---|---|---|---|
| B1 | [Thinking in React](https://react.dev/learn/thinking-in-react) | OFFICIAL | "A component should ideally only be concerned with one thing"; one component ≈ one piece of the data model |
| B2 | [Your First Component](https://react.dev/learn/your-first-component) | OFFICIAL | Several components per file is fine; **never nest component definitions** |
| B3 | [Keeping Components Pure](https://react.dev/learn/keeping-components-pure) | OFFICIAL | Purity; local mutation is allowed |
| B4 | [Components and Hooks must be pure](https://react.dev/reference/rules/components-and-hooks-must-be-pure) | OFFICIAL | Idempotence, immutability of props/state/JSX args |
| B5 | [Extracting State Logic into a Reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer) | OFFICIAL | The five-axis `useState` vs `useReducer` decision; reducers are the testable unit |
| B6 | [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) | OFFICIAL | No hooks called ⇒ not a hook; never `useMount`; "Some duplication is fine" |
| B7 | [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) | OFFICIAL | Derive during render; `key` to reset; handlers vs effects |
| B8 | [Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure) | OFFICIAL | Minimal state, no duplication, avoid redundancy |
| B9 | [Passing Props to a Component](https://react.dev/learn/passing-props-to-a-component) | OFFICIAL | `children` as a hole; **the `{...props}` spread smell** |
| B10 | [Passing Data Deeply with Context](https://react.dev/learn/passing-data-deeply-with-context) | OFFICIAL | Officially *pro* prop-drilling; the props → children → context ladder |
| B11 | [Sharing State Between Components](https://react.dev/learn/sharing-state-between-components) | OFFICIAL | Lifting state; single source of truth; controlled vs uncontrolled |
| B12 | [Server Components](https://react.dev/reference/rsc/server-components) | OFFICIAL | What server components can do; passing an un-awaited promise across the boundary |
| B13 | [Server Functions](https://react.dev/reference/rsc/server-functions) | OFFICIAL | ⚠️ Contains **no** security caveats — the warnings live only in framework docs |
| B14 | [`'use client'`](https://react.dev/reference/rsc/use-client) | OFFICIAL | Module-graph boundary; serializable prop list |
| B15 | [`'use server'`](https://react.dev/reference/rsc/use-server) | OFFICIAL | "Arguments… are fully client-controlled"; not recommended for data fetching |
| B16 | [React Compiler](https://react.dev/learn/react-compiler) | OFFICIAL | Replaces manual memoization; adoption is incremental |
| B17 | [React Compiler — Installation](https://react.dev/learn/react-compiler/installation) | OFFICIAL | `babel-plugin-react-compiler` must run first |
| B18 | [`lazy`](https://react.dev/reference/react/lazy) | OFFICIAL | Never declare `lazy` inside a component — state resets |
| B19 | [Render Props — legacy docs](https://legacy.reactjs.org/docs/render-props.html) | OFFICIAL (legacy) | Official status: "aren't very common… replaced by custom Hooks" |
| B20 | [Presentational and Container Components](https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0) (Dan Abramov, 2015, **retracted 2019**) | AUTHORITATIVE | "I don't *suggest* splitting your components like this anymore" |

## C. Next.js — App Router architecture

> **Version note:** every `nextjs.org/docs` page fetched reports **v16.2.12**. The largest
> architectural change against older material: **`middleware.ts` is deprecated and renamed
> `proxy.ts`**. Anything written for Next 13–15 is stale on this point.

| # | Source | Tier | What it settles |
|---|---|---|---|
| C1 | [Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure) (upd. 2026-07-22) | OFFICIAL | Explicitly **unopinionated**; three legal strategies; `_private`, `(groups)` |
| C2 | [`src` Folder](https://nextjs.org/docs/app/api-reference/file-conventions/src-folder) (upd. 2025-10-17) | OFFICIAL | `src/app` silently ignored if root `app/` exists; `proxy.ts` must move into `src/` |
| C3 | [Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) (upd. 2025-06-16) | OFFICIAL | Multiple root layouts cost a **full page reload**; conflicting paths are a build error |
| C4 | [Parallel Routes](https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes) (upd. 2026-03-03) | OFFICIAL | Slots as named props; role-conditional layouts; one dynamic slot forces all dynamic |
| C5 | [`layout.js`](https://nextjs.org/docs/app/api-reference/file-conventions/layout) (upd. 2026-03-05) | OFFICIAL | No re-render on navigation; no `searchParams`/`pathname`; **cannot pass data to `children`** |
| C6 | [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) (upd. 2026-06-23) | OFFICIAL | Leaf-level `'use client'`; the children escape hatch; providers wrap `{children}` |
| C7 | [How to think about data security](https://nextjs.org/docs/app/guides/data-security) (upd. 2026-06-23) | OFFICIAL | **The densest architecture source.** DAL + DTOs; "only the DAL should access `process.env`"; audit checklist |
| C8 | [Authentication](https://nextjs.org/docs/app/guides/authentication) (upd. 2026-07-22) | OFFICIAL | Optimistic vs secure checks; auth in layouts discouraged; `return null` guards "not recommended" |
| C9 | [Server Actions and Mutations](https://nextjs.org/docs/app/guides/server-actions) (upd. 2026-06-23) | OFFICIAL | Actions are public POST endpoints; sequential dispatch; **pass an ID, re-read the rest** |
| C10 | [Next.js as a backend](https://nextjs.org/docs/app/guides/backend-for-frontend) (upd. 2026-07-22) | OFFICIAL | "Fetch data in Server Components directly from its source, **not via Route Handlers**" |
| C11 | [Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers) (upd. 2026-03-03) | OFFICIAL | `route.js` cannot coexist with `page.js`; lowest-level routing primitive |
| C12 | [`proxy.js`](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) (upd. 2026-05-13) | OFFICIAL | The rename; "recommended to be used as a last resort"; matcher traps |
| C13 | [Single-page applications with Next.js](https://nextjs.org/docs/app/guides/single-page-applications) (upd. 2026-07-22) | OFFICIAL | A client-rendered Next app is **supported**; the promise-hoisting bridge pattern |
| C14 | [Forms with Server Actions](https://nextjs.org/docs/app/guides/forms) (upd. 2026-06-23) | OFFICIAL | Client validation is UX; the server `safeParse` is the gate |
| C15 | [Environment Variables](https://nextjs.org/docs/app/guides/environment-variables) (upd. 2026-03-03) | OFFICIAL | Dynamic `process.env[x]` lookups are **not inlined**; public vars frozen at build |
| C16 | [Font Optimization](https://nextjs.org/docs/app/getting-started/fonts) (upd. 2026-06-23) | OFFICIAL | Fonts can live anywhere; scoped to the component that uses them |
| C17 | [`transpilePackages`](https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages) (upd. 2026-06-23) | OFFICIAL | Usually unnecessary now — Turbopack handles workspace packages |
| C18 | [`optimizePackageImports`](https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports) (upd. 2025-12-19) | OFFICIAL | Still flagged experimental |
| C19 | [How to Think About Security in Next.js](https://nextjs.org/blog/security-nextjs-server-components-actions) (**Sebastian Markbåge**, 2023-10-23) | AUTHORITATIVE | Origin of DAL/DTO; the class-instance trick; `.bind()` args are not encrypted |
| C20 | [How we optimized package imports in Next.js](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js) (Shu Ding, 2023-10-13) | OFFICIAL | Measured barrel costs across MUI/lucide |
| C21 | [Postmortem on Next.js Middleware bypass](https://vercel.com/blog/postmortem-on-next-js-middleware-bypass) (Ty Sbano, Vercel CISO, 2025-03-25) | AUTHORITATIVE | "We do not recommend Middleware to be the sole method of protecting routes" |
| C22 | [Understanding CVE-2025-29927](https://securitylabs.datadoghq.com/articles/nextjs-middleware-auth-bypass/) (Datadog Security Labs, 2025-03-28) | AUTHORITATIVE | Root cause; reinforce checks beyond middleware |
| C23 | [Barrel imports discussion #92926](https://github.com/vercel/next.js/discussions/92926) | OFFICIAL (maintainer) | **`optimizePackageImports` covers external packages only — not your own `src/` barrels** |
| C24 | [Avoid barrel file imports](https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/rules/bundle-barrel-imports.md) (Vercel Labs) | OFFICIAL | `lucide-react` 3-icon import = 1,583 modules, ~2.8s dev cost |
| C25 | [Turborepo — Internal Packages](https://turborepo.dev/docs/core-concepts/internal-packages) | OFFICIAL | Just-in-Time vs Compiled; JIT forfeits caching and `compilerOptions.paths` |
| C26 | [Turborepo — Next.js guide](https://turborepo.dev/docs/guides/frameworks/nextjs) | OFFICIAL (thin) | Workspace wiring; `basePath` for microfrontends |
| C27 | [Making Sense of React Server Components](https://www.joshwcomeau.com/react/server-components/) (Josh Comeau, upd. 2025-05-09) | AUTHORITATIVE | The client boundary; the inversion pattern; RSC misconceptions |
| C28 | [App Router Project Structure](https://makerkit.dev/blog/tutorials/nextjs-app-router-project-structure) (Makerkit, 2024-12-18) | COMMUNITY | Route colocation camp; actions/services/loaders/schemas split |
| C29 | [Reusable Architecture for Large Next.js Applications](https://www.freecodecamp.org/news/reusable-architecture-for-large-nextjs-applications/) (Abisoye Alli-Balogun, 2026-04-03) | COMMUNITY | "Server Components read, Server Actions write, Client Components are the interactive surface" |
| C30 | [Server Actions vs API Routes](https://u11d.com/blog/nextjs-server-actions-vs-api-routes-guide/) (Paweł Sobolewski, 2026-04-15) | COMMUNITY | Reframes the choice as UI layer vs transport layer |

## D. Component decomposition and composition

| # | Source | Tier | What it settles |
|---|---|---|---|
| D1 | [When to break up a component](https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components) (Kent C. Dodds, 2019-07-19) | AUTHORITATIVE | Problem-driven splitting: "NOT BEFORE" |
| D2 | [Prop Drilling](https://kentcdodds.com/blog/prop-drilling) (2018-05-21) | AUTHORITATIVE | First fix is to stop extracting eagerly |
| D3 | [State Colocation will make your React app faster](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster) (2019-09-23) | AUTHORITATIVE | Push state down; the performance argument |
| D4 | [Application State Management with React](https://kentcdodds.com/blog/application-state-management-with-react) (2020-07-21) | AUTHORITATIVE | Lift content up; "not all of your context needs to be globally accessible" |
| D5 | [React Hooks: Compound Components](https://kentcdodds.com/blog/compound-components-with-react-hooks) (2019-02-18) | AUTHORITATIVE | Parent owns state, publishes via context |
| D6 | [Colocation](https://kentcdodds.com/blog/colocation) (2019-06-17) | AUTHORITATIVE | The principle; **responsible deletion**; the E2E exception |
| D7 | [Component Composition is great btw](https://tkdodo.eu/blog/component-composition-is-great-btw) (TkDodo, 2024-09-21) | AUTHORITATIVE | Children + early returns for multi-state UI; layout duplication is acceptable |
| D8 | [Components composition: how to get it right](https://www.developerway.com/posts/components-composition-how-to-get-it-right) (Makarevich, 2022-04-12) | AUTHORITATIVE | The one quotable size heuristic; "don't stop halfway" |
| D9 | [React component as prop: the right way](https://www.developerway.com/posts/react-component-as-prop-the-right-way) (2022-02-15) | AUTHORITATIVE | Element vs ComponentType vs render prop — the decision rule |
| D10 | [The mystery of React Element, children, parents and re-renders](https://www.developerway.com/posts/react-elements-children-parents) (2022-07-04) | AUTHORITATIVE | Why children-as-props avoids re-creation — memo-free optimization |
| D11 | [Why custom react hooks could destroy your app performance](https://www.developerway.com/posts/why-custom-react-hooks-could-destroy-your-app-performance) (2022-01-24) | AUTHORITATIVE | A stateful hook re-renders its host regardless of memoization |
| D12 | [Goodbye, Clean Code](https://overreacted.io/goodbye-clean-code/) (Dan Abramov, 2020-01-11) | AUTHORITATIVE | "Traded the ability to change requirements for reduced duplication" |
| D13 | [Headless Component: a pattern for composing React UIs](https://martinfowler.com/articles/headless-component.html) (Juntao Qiu, 2023-11-07) | AUTHORITATIVE | Brain vs looks; explicit drawbacks |
| D14 | [Radix — Composition (`asChild` / Slot)](https://www.radix-ui.com/primitives/docs/guides/composition) | OFFICIAL | The contract: spread all props, forward refs |
| D15 | [TanStack Table — Introduction (headless UI)](https://tanstack.com/table/latest/docs/introduction) | OFFICIAL | What headless buys and costs |
| D16 | [React Aria — Customization](https://react-aria.adobe.com/customization) | OFFICIAL | Slots via per-component contexts; one root element, no fragments |
| D17 | [Building Component Slots in React](https://sandroroth.com/blog/react-slots/) (Sandro Roth, upd. 2023-05-28) | COMMUNITY | Three named-slot implementations with trade-offs |
| D18 | [Container/Presentational Pattern](https://www.patterns.dev/react/presentational-container-pattern/) | COMMUNITY | Confirms hooks superseded the pattern |

## E. Business logic and state placement

| # | Source | Tier | What it settles |
|---|---|---|---|
| E1 | [Does TanStack Query replace Redux/MobX?](https://tanstack.com/query/latest/docs/framework/react/guides/does-this-replace-client-state) | OFFICIAL | Server state vs client state; Query is not a client-state replacement |
| E2 | [TanStack Router — Search Params](https://tanstack.com/router/latest/docs/framework/react/guide/search-params) | OFFICIAL | URL as "global state living inside the URL"; validate at the route boundary |
| E3 | [Practical React Query](https://tkdodo.eu/blog/practical-react-query) (TkDodo, upd. 2023-10-21) | AUTHORITATIVE | Never copy query data into local state; `queryKey` as a dependency array |
| E4 | [React Query as a State Manager](https://tkdodo.eu/blog/react-query-as-a-state-manager) (2021-08-20) | AUTHORITATIVE | The frontend doesn't own the data; `staleTime` strategy |
| E5 | [Effective React Query Keys](https://tkdodo.eu/blog/effective-react-query-keys) (upd. 2022-04-23) | AUTHORITATIVE | Per-feature `queries.ts`; key factories; keys stay module-private |
| E6 | [The Query Options API](https://tkdodo.eu/blog/the-query-options-api) (2024-01-17) | AUTHORITATIVE | Supersedes "always wrap in a custom hook" |
| E7 | [Working with Zustand](https://tkdodo.eu/blog/working-with-zustand) (2022-11-20) | AUTHORITATIVE | Export only hooks; atomic selectors; actions namespace; **multiple small stores** |
| E8 | [Zustand — Slices Pattern](https://zustand.docs.pmnd.rs/learn/guides/slices-pattern) | OFFICIAL | Slice composition; middleware only on the combined store |
| E9 | [Zustand — Flux inspired practice](https://zustand.docs.pmnd.rs/learn/guides/flux-inspired-practice) | OFFICIAL | **Single store** — contradicts E7 |
| E10 | [Jotai — Composing atoms](https://jotai.org/docs/guides/composing-atoms) | OFFICIAL | Derived/action atoms; wide graph over deep |
| E11 | [Why React Context is Not a "State Management" Tool](https://blog.isquaredsoftware.com/2021/01/context-redux-differences/) (Mark Erikson, 2021-01-18) | AUTHORITATIVE | Context is DI; "past 2–3 state contexts you're re-inventing React-Redux" |
| E12 | [React Hook Form — Get Started](https://raw.githubusercontent.com/react-hook-form/documentation/master/src/content/get-started.mdx) | OFFICIAL | Schema at `useForm({ resolver })` (site 403s to fetchers; docs source used) |
| E13 | [Orval](https://orval.dev/) | OFFICIAL | OpenAPI → typed client + query hooks + Zod schemas + MSW handlers |
| E14 | [Testing Implementation Details](https://kentcdodds.com/blog/testing-implementation-details) (2020-08-17) | AUTHORITATIVE | False negatives and false positives — the placement-by-testability argument |
| E15 | [RTL — `renderHook`](https://testing-library.com/docs/react-testing-library/api/#renderhook) | OFFICIAL | "You should prefer `render`"; `renderHook` is for library authors |

## F. Constants, utils, types, environment

| # | Source | Tier | What it settles |
|---|---|---|---|
| F1 | [TS Handbook — Enums](https://www.typescriptlang.org/docs/handbook/enums.html) | OFFICIAL | **TS itself:** "you may not need an enum when an object with `as const` could suffice"; `const enum` caveats |
| F2 | [Why I don't like TypeScript enums](https://www.totaltypescript.com/why-i-dont-like-typescript-enums) (Matt Pocock) | AUTHORITATIVE | Assignability hole, nominal typing, reverse maps |
| F3 | [TS Handbook — Project References](https://www.typescriptlang.org/docs/handbook/project-references.html) | OFFICIAL | Compiler-enforced boundaries; unreferenced import = compile error |
| F4 | [tsconfig — `strict`](https://www.typescriptlang.org/tsconfig/#strict) | OFFICIAL | What `strict` does **not** include |
| F5 | [The utility module antipattern](https://www.yanglinzhao.com/posts/utils-antipattern/) (Yanglin Zhao, 2020-05-19) | COMMUNITY | "util is just too loose of a name"; the staging-module + CI-size-cap trick |
| F6 | [Why utils & helpers is a dump](https://dev.to/sergeysova/why-utils-helpers-is-a-dump-45fo) (Sergey Sova, 2021-11-23) | COMMUNITY | Promote clusters into named internal libraries |
| F7 | [ESLint — `no-magic-numbers`](https://eslint.org/docs/latest/rules/no-magic-numbers) | OFFICIAL | Options; the rule is frozen |
| F8 | [T3 Env](https://env.t3.gg/docs/introduction) | OFFICIAL | Validated env schema; Proxy + safe-parse so server vars throw in client code |
| F9 | [Vite — Env Variables and Modes](https://vite.dev/guide/env-and-mode) | OFFICIAL | `VITE_*` "should *not* contain sensitive information" |
| F10 | [JavaScript Naming Conventions](https://www.robinwieruch.de/javascript-naming-conventions/) (Wieruch, 2019-10-06) | AUTHORITATIVE | The cross-OS case-sensitivity argument for kebab-case files |

## G. Barrel files and the module graph (measured evidence)

| # | Source | Tier | What it settles |
|---|---|---|---|
| G1 | [Please Stop Using Barrel Files](https://tkdodo.eu/blog/please-stop-using-barrel-files) (TkDodo, 2024-07-26) | AUTHORITATIVE | 11k → 3.5k modules (68% cut); the library-entry-point exception |
| G2 | [The barrel file debacle](https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/) (Marvin Hagemeister, 2023-10-08) | AUTHORITATIVE | Module-load timings; **test runners don't tree-shake at all** |
| G3 | [`unbarrelify`](https://github.com/webpro-nl/unbarrelify) (Lars Kappert) | COMMUNITY (tooling) | Codemod with `--check`/`--ci` for enforcement |

> Also relevant here: **C20**, **C23**, **C24** (Vercel's measurements and the scope limit),
> **A4** (FSD's own admission of index-file costs), **A21** (Comeau's dissent).

## H. Boundary enforcement tooling

| # | Source | Tier | What it settles |
|---|---|---|---|
| H1 | [`import/no-restricted-paths`](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-restricted-paths.md) | OFFICIAL | Zones; resolution-based matching; glob negation for feature isolation |
| H2 | [`eslint-plugin-boundaries`](https://github.com/javierbrea/eslint-plugin-boundaries) | OFFICIAL | Element classification; the `entry-point` rule; `capture` for generic policies |
| H3 | [`@nx/enforce-module-boundaries`](https://nx.dev/docs/technologies/eslint/eslint-plugin/guides/enforce-module-boundaries) | OFFICIAL | `depConstraints`, `allSourceTags`, `banTransitiveDependencies` |
| H4 | [dependency-cruiser — rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) | OFFICIAL | Whole-graph reasoning; the `$1` back-reference trick |
| H5 | [Steiger](https://github.com/feature-sliced/steiger) | OFFICIAL | FSD linter; `insignificant-slice`, `no-public-api-sidestep` |
| H6 | [The Beyoncé Rule](https://frontendatscale.com/issues/36/) (Maxi Ferreira, 2024-11-24) | AUTHORITATIVE | Unenforced architecture decays; the tool-selection matrix |
| H7 | [`eslint-plugin-perfectionist` — `sort-imports`](https://perfectionist.dev/rules/sort-imports) | OFFICIAL | Default groups; `internalPattern` `@/`, `~/`, `#`; **`sortSideEffects: false`** |

## I. Styling and design system

| # | Source | Tier | What it settles |
|---|---|---|---|
| I1 | [Tailwind — Styling with utility classes](https://tailwindcss.com/docs/styling-with-utility-classes) | OFFICIAL | The duplication ladder: loops → multi-cursor → **components** → custom CSS |
| I2 | [Tailwind — Adding custom styles](https://tailwindcss.com/docs/adding-custom-styles) | OFFICIAL | "You probably don't need these types of classes as often as you think" |
| I3 | [Tailwind — Functions and directives](https://tailwindcss.com/docs/functions-and-directives) | OFFICIAL | `@apply` scoped to third-party interop; `@reference` for CSS Modules/SFCs |
| I4 | [Tailwind — Theme variables](https://tailwindcss.com/docs/theme) | OFFICIAL | Tokens in `@theme`, not JS config; `:root` vs `@theme`; `@theme inline` |
| I5 | [cva — Variants](https://cva.style/docs/getting-started/variants) | OFFICIAL | Variant logic separated from render logic |
| I6 | [Tailwind Variants — Introduction](https://www.tailwind-variants.org/docs/introduction) | OFFICIAL | `slots` for multi-element components; built-in conflict resolution |
| I7 | [shadcn/ui — Introduction](https://ui.shadcn.com/docs) | OFFICIAL | "Not a component library. It is how you build your component library" |
| I8 | [shadcn/ui — Monorepo](https://ui.shadcn.com/docs/monorepo) | OFFICIAL | **The clearest official ui-vs-feature boundary statement** |
| I9 | [shadcn/ui — `components.json`](https://ui.shadcn.com/docs/components-json) | OFFICIAL | Placement is configured via aliases, not hardcoded |
| I10 | [Vite — Features](https://vite.dev/guide/features.html) | OFFICIAL | `.module.css` convention; `?url`/`?raw`; glob-import constraints |
| I11 | [State of CSS 2025 — Other Tools](https://2025.stateofcss.com/en-US/other-tools/) | COMMUNITY (survey) | Raw adoption counts. ⚠️ Counts, not percentages |
| I12 | [SVGR — Getting Started](https://react-svgr.com/docs/getting-started/) | OFFICIAL | ⚠️ Gives **no** project-organization guidance — icon layout is a convention gap |
| I13 | [react-i18next — Multiple Translation Files](https://react.i18next.com/guides/multiple-translation-files) | OFFICIAL | Namespaces. ⚠️ `public/locales/{lng}/{ns}.json` is an http-backend convention, **not** a mandate |

## J. Tests and Storybook

| # | Source | Tier | What it settles |
|---|---|---|---|
| J1 | [Vitest — `include`](https://vitest.dev/config/include) | OFFICIAL | Default is **suffix-only** — `__tests__/foo.ts` is not picked up |
| J2 | [Vitest — Features](https://vitest.dev/guide/features.html) | OFFICIAL | In-source testing via `import.meta.vitest` |
| J3 | [Vitest — Test Projects](https://vitest.dev/guide/projects) | OFFICIAL | The supported way to split test kinds; `extends: true` |
| J4 | [Vitest — Browser Mode](https://vitest.dev/guide/browser/) | OFFICIAL | `vitest-browser-react`; prefer Playwright over the preview provider |
| J5 | [Jest — Configuration](https://jestjs.io/docs/configuration) | OFFICIAL | `__tests__` is a **Jest inheritance** — the default `testMatch` |
| J6 | [RTL — Setup](https://testing-library.com/docs/react-testing-library/setup/) | OFFICIAL | Custom `render` in `test-utils`; resolve via tsconfig `paths` |
| J7 | [Testing Library — Guiding Principles](https://testing-library.com/docs/guiding-principles/) | OFFICIAL | Tests resemble how software is used |
| J8 | [MSW — Structuring handlers](https://mswjs.io/docs/best-practices/structuring-handlers) | OFFICIAL | Happy paths in the base file; errors via per-test `server.use()` |
| J9 | [Storybook — How to write stories](https://storybook.js.org/docs/writing-stories) | OFFICIAL | Colocation is the documented default |
| J10 | [Storybook — Configure](https://storybook.js.org/docs/configure) | OFFICIAL | Default globs; `titlePrefix` for package-level discovery |
| J11 | [Storybook — Vitest addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon) | OFFICIAL | Stories become component tests — changes what `.test.tsx` is for |

## K. Linting, formatting, dead code, code splitting

| # | Source | Tier | What it settles |
|---|---|---|---|
| K1 | [ESLint — Configuration Files (flat config)](https://eslint.org/docs/latest/use/configure/configuration-files) | OFFICIAL | Later objects override earlier — the mechanism for test-scoped relaxations |
| K2 | [`eslint-plugin-react-hooks`](https://github.com/facebook/react/tree/main/packages/eslint-plugin-react-hooks) | OFFICIAL (React team) | **Now ships the React Compiler rules** — the highest-value 2025-26 addition |
| K3 | [`eslint-plugin-jsx-a11y`](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y) | OFFICIAL | Static only — "should be paired with runtime testing tools" |
| K4 | [Prettier vs. Linters](https://prettier.io/docs/comparison) | OFFICIAL | Prettier formats; linters catch bugs. Never both |
| K5 | [Biome — Getting Started](https://biomejs.dev/guides/getting-started/) | OFFICIAL | Single toolchain, zero-config, migration guides |
| K6 | [Biome — JavaScript rules](https://biomejs.dev/linter/javascript/rules/) | OFFICIAL | Has React/a11y rules but **not** the Compiler set, and is not type-aware |
| K7 | [Knip — Getting Started](https://knip.dev/overview/getting-started) | OFFICIAL | Unused files, exports, dependencies |
| K8 | [Knip — Configuration](https://knip.dev/reference/configuration) | OFFICIAL | Tune `entry`/`project`, not `ignore` |
| K9 | [React Router — Automatic Code Splitting](https://reactrouter.com/explanation/code-splitting) | OFFICIAL | Route module as the natural chunk boundary |

---

## Unresolved conflicts

These are the places where credible sources genuinely disagree. The skill must give a
**decision procedure**, not a rule — and say which sources back each side.

1. **Barrel files.** bulletproof-react (A9), TkDodo (G1), Hagemeister (G2), Turborepo (A15)
   and Vercel Labs (C24) say delete them from application code, with measurements. Comeau
   (A21) and Wieruch (A20) keep them; FSD (A4) makes them *mandatory* as its public-API
   mechanism while documenting their costs in the same page.
   **Reconciler:** cost scales with **fan-out per import**, not with the number of barrel
   files. Note also that Comeau argues about *bundler* time while G2's largest numbers are
   *test-runner* time, where there is no tree-shaking — and that Comeau's "<1% of modules"
   claim is the only figure in this dispute not backed by a measurement.
   **Trap to avoid:** C23 establishes that `optimizePackageImports` does **not** help
   first-party barrels, so it can't be cited as a reason to keep them.

2. **Segment naming inside a feature.** FSD (A2) forbids `components`/`hooks`/`types` as
   segment names ("purpose, not essence"); bulletproof-react (A9) prescribes exactly those.
   Roth (A23) sides with FSD: type-named subfolders recreate the by-type problem one level
   down.

3. **By-function vs by-feature.** Comeau (A21, updated Dec 2025) against essentially
   everyone else (A9, A12, A20, A22, A23, A1). Likely a scale difference, not a correctness
   one.

4. **Size as a splitting trigger.** Makarevich (D8): if you must scroll, it's too big.
   Kent (D1): "I don't mind if the JSX… gets really long" — split only on a listed problem.
   **No credible source publishes a line-count or prop-count threshold.** Infinum (A27)
   deliberately gives none. Any "max 150 lines / max 5 props" rule is untraceable.

5. **Extract more vs less to fix prop drilling.** react.dev (B10) says drilling means you
   forgot to extract; Kent (D2) says over-extraction *causes* drilling. Compatible only if
   you are precise about which extraction.

6. **Zustand: one store or many.** Official (E9) says single store with slices; TkDodo (E7)
   says multiple small per-domain stores. Direct contradiction.

7. **Custom hook per query.** TkDodo 2020 (E3) vs TkDodo 2024 (E6). The newer position
   supersedes; both are still widely cited.

8. **How much global state.** Kent (D4) vs Erikson (E11) — same facts, opposite thresholds.

9. **Where update logic lives.** Redux (A12) and Zustand (E7/E9) say in the store;
   Bespoyasov (A24) says the store is an adapter and logic belongs in a framework-agnostic
   domain layer. Reconcilable — reducers can delegate to pure functions — but neither
   literature says so.

10. **Feature folders vs route colocation in Next.js.** Wieruch (A20) keeps `app/` routes-only
    and explicitly rejects `app/_features/`; Makerkit (C28) and freeCodeCamp (C29) colocate.
    Docs (C1) refuse to choose. All three agree on the one-way dependency invariant.
    **Deciding variable: reuse across routes.**

11. **Are Server Actions a service layer?** Markbåge 2023 (C19) put authz in the action body;
    current docs (C7) say thin actions over a DAL; Makerkit (C28) is hardest. An evolution,
    not a conflict — but plenty of live material still teaches the old shape.

12. **Where auth checks belong.** Proxy: optimistic only, never sole defense (C8, C12, C21,
    C22). Layout: explicitly discouraged (C8) but very widely done. DAL: recommended (C7).
    Action/handler: mandatory regardless (C9). **Many auth libraries' quickstarts still lead
    with middleware-based route protection — directly at odds with current first-party
    guidance.**

13. **`@apply`.** Tailwind v4 (I2, I3) routes you away from it *by omission and redirection*
    but ships `@reference` specifically to make it work in CSS Modules. There is no official
    warning against it in v4 — the "Tailwind says don't use `@apply`" claim is folklore from
    older posts. Don't repeat it as fact.

14. **Colocated tests vs `__tests__`.** Kent (D6) argues colocation; Jest defaults (J5) bless
    `__tests__`; Vitest defaults (J1) penalize it. The tool default is the concrete tiebreaker.

15. **Stories vs tests as the behavioral spec.** J11 makes stories the test artifact; J6/J7
    assume a dedicated test file. Doing both duplicates coverage.

16. **Biome vs ESLint.** K5/K6 market Biome as a replacement, but it lacks the React Compiler
    rules (K2) and type-aware rules. A real capability gap for React, not a preference.

17. **File casing.** Official sources contradict each other: Storybook docs (J9) show
    `Button.stories.js`; the shadcn CLI (I8, I9) emits `button.tsx`. Wieruch (F10) has the
    only *reasoned* position (cross-OS case sensitivity).

18. **`utils` vs `helpers` vs `lib`.** Comeau (A21) draws a clear line; Zhao (F5) and Sova (F6)
    say both names are equally meaningless. Consensus exists only on the failure mode.

---

## Notable gaps found

Worth stating explicitly in the skill, because their absence is often misreported:

- **react.dev has no file-structure page.** The only official React statement is the legacy
  FAQ (A19), which caps deliberation at five minutes.
- **Next.js declares itself unopinionated** (C1) — no structure can be presented as
  officially mandated.
- **react.dev's Server Functions reference (B13) carries no security caveats.** The warnings
  exist only in Next.js docs (C7, C9). Reading React docs alone leaves a real trap.
- **FSD's own comparisons against DDD / Clean Architecture / Feature-Driven are still WIP**
  (A6) — it has not published the argument it is most often cited for.
- **SVGR (I12) and react-i18next (I13) prescribe no folder layout.** Widely repeated
  "conventions" for both are inventions of the ecosystem.
- **Turborepo docs (C25, C26) never cover how `"use client"`/`"use server"` behave across
  package boundaries**, nor where shared contracts belong.

## Unreachable during research

Attempted and failed — listed so a later pass can retry rather than assume they were skipped:

- `alexkondov.com/tao-of-react` — 403
- `alexkondov.com/hexagonal-inspired-architecture-in-react` — 403
- `profy.dev/article/react-folder-structure` — DNS failure (the dev.to mirror A22 was used)
- `blog.serghei.pl/posts/where-your-types-live-matters/` — 403
- `react-hook-form.com/docs/*` — 403 to fetchers (the docs source in E12 was used)
- `nuqs.dev/docs` — fetched but contained install instructions only

## Not researched

- **Valtio** — no doc fetched; treat as uncovered.
- Vue/Svelte/Angular equivalents — out of scope for this skill.
