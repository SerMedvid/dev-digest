# Contested calls

Ten places where credible sources genuinely disagree. Each gives the **decision procedure**,
then the evidence on both sides, so a ruling can be defended rather than asserted.

Citation keys refer to [`references.md`](references.md).

---

## 1. Barrel files (`index.ts` re-exports)

**Decide by fan-out, not by whether the file exists.**

```
How many modules does one import through this barrel pull in?
  1–3   → harmless. Keep it if it buys encapsulation.
  ~10+  → measure before keeping.
  100+  → delete it. This is where the seconds are.
```

Then: is this a **published package's entry point**? Keep it — that is the one case every source
agrees on. Is it a **`components/index.ts` re-exporting the whole kit**, or an icon set? Delete it.

**Against (measured).** TkDodo [G1]: 11,000+ modules and 5–10 s page start-up dropped to ~3,500
modules — a **68% cut** — after removing internal barrels. Vercel [C20]: `@material-ui/icons`
10.2 s → 2.9 s (11,738 → 632 modules); ~28% faster production builds; up to 40% faster serverless
cold starts. Vercel Labs [C24]: importing three icons from `lucide-react` loads **1,583 modules**,
~2.8 s of extra dev time. Hagemeister [G2] measured raw module-graph construction: 10k modules
3.12 s, 25k 16.81 s, 50k 48.44 s. bulletproof-react [A9] and Turborepo [A15] both say avoid.

**For.** Comeau [A21] (updated Dec 2025) keeps per-component `index.ts`: "The bundler will spend
most of its time dealing with third-party dependencies. Less than 1% of modules encountered will
be barrel files." Wieruch [A20] treats `index.ts` as a folder's public interface. FSD [A4] makes
barrels **mandatory** — they *are* its public-API mechanism.

**Three things that resolve most of it:**

1. **The dispute is about fan-out.** A barrel re-exporting one component costs nothing; one
   re-exporting 200 costs seconds. Both camps are right about their own case.
2. **Comeau argues bundler time; Hagemeister's worst numbers are test-runner time** — where there
   is no tree-shaking at all, so the cost is unmitigated and invisible. With 100 test files at 4
   parallel, a 10k-module graph is ~1 m 18 s of pure overhead before a single assertion runs.
3. **Comeau's "<1%" is the only figure in this dispute not backed by a measurement.**

**Traps.**

- `optimizePackageImports` covers **external packages only, not your own `src/` barrels** [C23].
  It cannot be cited as a reason to keep first-party ones. It is also still flagged experimental [C18].
- A single non-re-export line (`export const x = 5`) makes the file non-optimizable — side effects
  can't be ruled out [G1][C20].
- `export *` is discouraged even by FSD [A4]: it hurts discoverability and leaks internals. Note
  Comeau's recommended pattern uses it — the pro-barrel camp is not internally consistent here.
- Barrels are the usual source of circular imports. Enable `import/no-cycle`.

**Migrating:** `unbarrelify` [G3] with `--check`/`--ci`. Measure module count before and after —
that is the number that matters.

---

## 2. Segment naming inside a feature

**Decide by whether the subfolder name would survive being read alone.**

Head-on conflict. FSD [A2] **forbids** `components`, `hooks`, `types` as segment names — "purpose,
not essence" — and mandates `ui` / `api` / `model` / `lib` / `config`. bulletproof-react [A9]
prescribes **exactly** `components/`, `hooks/`, `types/`, `utils/` inside each feature.

FSD has the stronger argument, articulated by Roth [A23]: a type-named subfolder recreates the
by-type problem one level down — you split by domain at the top, then immediately re-split by file
kind underneath, and a feature's logic scatters again.

**Practical ruling:** either is defensible and **consistency within the repo beats the choice**.
If starting fresh, prefer purpose names (`ui`, `model`, `api`) — they force you to answer "what is
this *for*", which `hooks/` never does. If the repo already uses type names, do not churn it.

---

## 3. By-function vs by-feature

**Decide by team count and product breadth, not by taste.**

Comeau [A21] organises `src/components|hooks|helpers` by function and argues feature folders create
friction from blurry category boundaries and force restructuring as the product evolves. Against
him: bulletproof-react [A9], Redux [A12] (a Priority B "strongly recommended" rule), Kettmann [A22],
Wieruch [A20], Roth [A23], FSD [A1].

This is a **scale difference, not a correctness one**. Comeau's target is content-heavy sites and
mid-size apps — and his folder-per-component *is* colocation, one level down. The feature camp
targets multi-team product apps where the failure mode is two teams editing the same `components/`.

Note Comeau's structure and the feature structure agree on far more than they disagree: both
colocate a component's tests, styles, helpers and types beside it.

---

## 4. Component size

**There is no threshold. Use the trigger list in `SKILL.md` §2.1.**

Makarevich [D8] offers the only concrete heuristic anywhere in the corpus: "If I need to scroll to
read through the component's code — it's a clear sign that it's too big." Kent [D1] rejects size
outright: "I don't mind if the JSX I return in my component function gets really long"… split when
you hit a listed problem, "**NOT BEFORE**."

**Reconciler:** Makarevich's threshold bites on *logic-heavy* components; Kent's tolerance is
explicitly about *returned JSX*. Long JSX is fine. Long logic is the signal.

Infinum's engineering handbook [A27] — a real org's React guidelines — contains **no** max-lines,
max-props or nesting numbers at all, and opens with "Guides are not rules and should not be
followed blindly." Any "max 150 lines / max 5 props" rule you encounter is untraceable to a
credible source.

The closest official proxy for "too many props" is react.dev's spread smell [B9]: routine
`{...props}` means you should split and pass `children`.

---

## 5. Extract more, or extract less, to fix prop drilling

react.dev [B10]: passing data through layers that don't use it "often means you forgot to extract
some components along the way" — extract *more*, then pass `children`. Kent [D2]: unnecessary
extraction is what *creates* drilling — "no reason to break things out prematurely."

**Compatible only if you are precise about which extraction:** extract a component to become the
`children` payload (react.dev), don't extract a component that then needs props threaded into it
(Kent). If your extraction *adds* a prop to an intermediate layer, it was the wrong one.

---

## 6. One Zustand store or many

Direct contradiction. Official docs [E9]: "Your applications global state should be located in a
single Zustand store," split into slices. TkDodo [E7]: "Zustand encourages you to have multiple,
small stores," one per domain.

**Decide by what you're optimising:** the official position exists because **middleware must be
applied to the combined store** — applying it inside individual slices "can lead to unexpected
issues" [E8]. TkDodo's position aligns better with feature-folder architecture and its
no-cross-feature-imports rule.

If you use middleware heavily → one store, slices per domain. Otherwise → per-domain stores.
Either way: export only custom hooks (never the raw store), use atomic selectors returning stable
values, group actions in an `actions` namespace, model them as events not setters, and keep server
state out.

---

## 7. Custom hook per query

**TkDodo contradicts himself across four years, and the newer position wins.**

2020 [E3]: create custom hooks per query, even for single queries. 2024 [E6]: "there's nothing
wrong with calling `useQuery` directly in your component" — `queryOptions` objects now carry the
colocation and type-tagging that the hook wrapper used to provide.

Both are still widely cited. Prefer the 2024 shape: a per-feature `queries.ts` exporting
`queryOptions` objects and a key factory, with hooks added only when they contribute logic beyond
wrapping.

---

## 8. Colocated tests vs `__tests__`

**The tool default is the tiebreaker, and the two runners disagree.**

- Vitest [J1] default `include` is `['**/*.{test,spec}.?(c|m)[jt]s?(x)']` — **suffix only**. A file
  at `__tests__/button.ts` is silently not collected.
- Jest [J5] default `testMatch` accepts **both** `__tests__/**/*` (any filename) and suffix files.

So `__tests__` is a **Jest inheritance**. Migrating Jest → Vitest silently drops bare-named files
in those folders unless `include` is widened.

**Ruling:** use `<name>.test.tsx` colocated. It is the intersection of both defaults and survives a
runner migration. Kent [D6] argues colocation on principle and states the exception explicitly:
**E2E and cross-component integration tests belong at the project root**, not beside a component.

Related: Storybook's Vitest addon [J11] turns stories into component tests. If you adopt it, don't
also duplicate the same interactions in `.test.tsx` — keep those for hooks, pure logic and
non-visual edge cases.

---

## 9. File casing

**No correct answer; official sources contradict each other.** Storybook's docs [J9] show
`Button.stories.js`; the shadcn CLI [I8][I9] emits `button.tsx` and `login-form.tsx`.

Wieruch [F10] has the only *reasoned* position: kebab-case avoids case-sensitivity bugs when a
case-insensitive filesystem (macOS, Windows) meets a case-sensitive one (CI, Linux) — a rename
that only changes case can fail to propagate through Git.

**Ruling:** kebab-case files with PascalCase exported identifiers, *if starting fresh* — it also
matches what `shadcn add` generates, so a mixed convention appears the moment you use the CLI. If
the repo already uses PascalCase, the churn costs more than the benefit. Consistency wins.

Suffixes are not a matter of taste — they are machine-meaningful: `.test.tsx`, `.stories.tsx`,
`.module.css`, `.test-d.ts`, `.bench.ts`.

---

## 10. Tailwind `@apply` and extracted class strings

**Correct the folklore first:** Tailwind v4 docs contain **no warning against `@apply`**. The
guidance is by omission and redirection — [I3] scopes it to "when you need to write custom CSS
(like to override the styles in a third-party library) but still want to work with your design
tokens", and v4 ships `@reference` specifically to make `@apply` work inside CSS Modules and SFC
`<style>` blocks. The "Tailwind officially says don't use `@apply`" claim comes from older posts.

The actual official guidance [I1] is an ordered ladder for handling duplication:

```
1. loops            — most repeated markup is authored once already
2. multi-cursor edit — "You'd be surprised at how often this ends up being the best solution"
3. a component      — "the best strategy is to create a component"
4. custom CSS       — last
```

For multi-variant components the ecosystem answer is `cva` [I5], or `tailwind-variants` [I6] when
the component has several styled sub-elements (needs `slots`) or you want class-conflict merging.
Define the variant object at module scope, never inside render.

Tokens belong in `@theme` in CSS, not a JS config [I4] — they generate utilities, not just
variables. Use `:root` for variables that must *not* generate utilities.

---

## Also worth knowing

**Biome vs ESLint** [K5][K6] — Biome markets itself as an ESLint+Prettier replacement and does ship
React and a11y rules. But it does **not** carry the React-team-owned Compiler rules [K2], and it is
not type-aware. For a React codebase that is a capability gap, not a preference. Biome for
formatting plus fast baseline linting is fine; it does not replace ESLint here.

**`utils` vs `helpers` vs `lib`** — Comeau [A21] draws a clear line (project-specific vs generic
vs third-party wrapper). Zhao [F5] and Sova [F6] argue **both names are equally meaningless** and
should be abolished for domain names. Wieruch [A20] uses `utils` + `lib` and skips `helpers`
entirely. There is consensus on the failure mode and none on the vocabulary.

**Where auth checks belong in Next.js** — this one is not really contested by the sources, but is
contested by practice. Proxy: optimistic only, never sole defense [C8][C12][C21][C22]. Layout:
explicitly discouraged [C8]. Data layer: recommended [C7]. Action/handler: mandatory regardless
[C9]. **Many auth libraries' quickstarts still lead with middleware-based route protection**,
directly at odds with current first-party guidance. Treat a middleware-only auth setup as a finding.
