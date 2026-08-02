# Examples

Concrete shapes for the rules in [`SKILL.md`](SKILL.md). Section numbers match.

---

## §1.1 — Structure by scale

**Medium — the default.** Routes are one axis, domains are another.

```
src/
  app/                          routes only — no domain logic
    (marketing)/page.tsx
    (app)/reviews/[id]/page.tsx
  features/
    reviews/
      api/                      schema + fetcher + hook per endpoint
        get-review.ts
        queries.ts              key factory + queryOptions
      components/
        review-summary/
      model/                    domain logic — no React import
        score.ts
        score.test.ts
      types.ts
      index.ts                  the public API
    repos/
  components/                   shared, domain-free primitives
  lib/                          shared modules, named by domain
    datetime.ts
    currency.ts
  hooks/
```

**Large.** Same invariants, enforced by packages instead of folders — `apps/` for deployables,
`packages/` for everything else, with `exports` subpaths rather than barrels.

---

## §1.2 — Promote on the second consumer

```
1. src/features/reviews/components/score-badge/     only reviews uses it
2. src/components/score-badge/                      repos now uses it too  ← promote here
3. packages/ui/src/components/score-badge/          a second app uses it
```

Do not start at step 2 because step 2 "seems likely".

---

## §1.3 — Enforce the dependency direction

```js
// eslint.config.js
'import/no-restricted-paths': ['error', {
  zones: [
    // app/ is the top layer — features may not reach into it
    { target: './src/features', from: './src/app',
      message: 'features must not import from app — compose at the route level' },

    // the shared tier may not reach upward
    { target: ['./src/components', './src/hooks', './src/lib', './src/types'],
      from: ['./src/features', './src/app'],
      message: 'shared code must not depend on features or app' },

    // no cross-feature imports
    { target: './src/features/reviews', from: './src/features', except: ['./reviews'] },
    { target: './src/features/repos',   from: './src/features', except: ['./repos'] },
  ],
}],
'import/no-cycle': 'error',
```

Generic feature isolation without one zone per feature — dependency-cruiser, using a `$1`
back-reference:

```json
{ "name": "no-cross-feature",
  "severity": "error",
  "from": { "path": "^src/features/([^/]+)/.+" },
  "to":   { "path": "^src/features/([^/]+)/.+", "pathNot": "^src/features/$1/.+" } }
```

---

## §2.1 — Split on a trigger

**Trigger 2 — state that isn't the component's business.**

```tsx
// ✗ the whole list re-renders whenever one row's menu opens
function ReviewList({ reviews }) {
  const [openMenuId, setOpenMenuId] = useState(null)
  return reviews.map((r) => (
    <Row key={r.id} review={r} open={openMenuId === r.id} onToggle={setOpenMenuId} />
  ))
}

// ✓ each row owns the state only it reads
function ReviewList({ reviews }) {
  return reviews.map((r) => <Row key={r.id} review={r} />)
}
function Row({ review }) {
  const [open, setOpen] = useState(false)
  // …
}
```

**Trigger 3 — a prop threaded through a layer that never reads it.**

```tsx
// ✗ Layout doesn't use `reviews`; it only forwards them
<Layout reviews={reviews} />

// ✓ children — Layout no longer knows reviews exist
<Layout>
  <ReviewList reviews={reviews} />
</Layout>
```

**Trigger 1 — two responsibilities.** Don't stop halfway: a component either implements markup
*or* composes other components.

```tsx
// ✗ composes three children and also hand-rolls the toolbar markup
function ReviewPanel({ review }) {
  return (
    <div>
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <button …>Approve</button><button …>Reject</button>
      </div>
      <ReviewSummary review={review} />
      <FindingList findings={review.findings} />
    </div>
  )
}

// ✓
function ReviewPanel({ review }) {
  return (
    <div>
      <ReviewToolbar reviewId={review.id} />
      <ReviewSummary review={review} />
      <FindingList findings={review.findings} />
    </div>
  )
}
```

**Not a trigger.** A 180-line component with one responsibility and mostly JSX is fine.

---

## §2.3 — Composition instead of context

```tsx
// ✗ threading user through Header just to reach Avatar
<Header user={user} />

// ✓ pass the built element — Header never sees `user`
<Header avatar={<Avatar user={user} />} />
```

This is also a re-render optimisation without `memo`: the element is created in the *outer*
component, so a `Header` state change cannot re-create it.

---

## §3.1 — `as const` over `enum`

```ts
// ✗ numeric enum: logStatus(0) type-checks; nominal typing; emits a reverse map
enum ReviewStatus { Pending, Running, Done }

// ✓ plain JS at runtime, exhaustive at compile time
export const REVIEW_STATUS = {
  pending: 'pending',
  running: 'running',
  done: 'done',
} as const

export type ReviewStatus = (typeof REVIEW_STATUS)[keyof typeof REVIEW_STATUS]
```

---

## §3.2 — Name modules for their domain

```
✗ src/utils.ts                 300 lines, 40 unrelated exports
✗ src/helpers/index.ts

✓ src/lib/datetime.ts
✓ src/lib/currency.ts
✓ src/lib/permissions.ts
```

If a `utils/` directory must exist, it is a namespace of domain files (`utils/array.ts`,
`utils/url.ts`) — never one `utils.ts`.

---

## §3.4 — One module reads the environment

```ts
// src/config/env.ts — the ONLY file that touches process.env
import { z } from 'zod'

const schema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
})

// Static property access — required. See the trap below.
export const env = schema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
})
```

```ts
// ✗ both silently yield undefined in the browser bundle — values are inlined
//   at build time by static text replacement, so dynamic access finds nothing
const url = process.env[key]
const all = process.env; const url2 = all.NEXT_PUBLIC_API_URL
```

Lock it down:

```js
'no-restricted-properties': ['error', {
  object: 'process', property: 'env',
  message: 'Import from @/config/env instead — dynamic env access is not inlined.',
}],
// …then allow it back for src/config/env.ts with a later flat-config object
```

---

## §4.1 — The placement ladder

```ts
// 1. pure module — features/reviews/model/score.ts
export function weightedScore(findings: Finding[]): number { … }
```

```ts
// ✗ a "hook" that calls no hooks — can't be called conditionally, harder to test
export function useWeightedScore(findings: Finding[]) {
  return weightedScore(findings)
}
```

```tsx
// ✗ logic only testable through renderHook
function useReviewTotals(review) {
  const [totals, setTotals] = useState(null)
  useEffect(() => { setTotals(computeTotals(review)) }, [review])
  return totals
}

// ✓ pure function + derive during render
const totals = computeTotals(review)
```

---

## §4.2 — State placement decision

```tsx
// server-owned → query
const { data: review } = useQuery(reviewQueries.detail(id))

// shareable / survives refresh → URL
const [filters, setFilters] = useSearchParams()

// being edited → form library
const form = useForm({ resolver: zodResolver(reviewSchema) })

// client-only, ephemeral → local state
const [isMenuOpen, setMenuOpen] = useState(false)
```

```tsx
// ✗ copying server state into local state opts out of every background update
const { data } = useQuery(reviewQueries.detail(id))
const [review, setReview] = useState(data)
```

---

## §4.3 — Query key factory, colocated

```ts
// features/reviews/api/queries.ts
const keys = {
  all: ['reviews'] as const,
  lists: () => [...keys.all, 'list'] as const,
  list: (filters: Filters) => [...keys.lists(), filters] as const,
  detail: (id: string) => [...keys.all, 'detail', id] as const,
}

export const reviewQueries = {
  list: (filters: Filters) =>
    queryOptions({ queryKey: keys.list(filters), queryFn: () => api.listReviews(filters) }),
  detail: (id: string) =>
    queryOptions({ queryKey: keys.detail(id), queryFn: () => api.getReview(id) }),
}
```

`keys` stays module-private; only `reviewQueries` is exported. Keys run generic → specific so
`invalidateQueries({ queryKey: keys.all })` sweeps everything.

---

## §5.3 — Cross the client boundary with children

```tsx
// ✗ importing pulls ReviewBody and its whole dependency tree into the client bundle
'use client'
import { ReviewBody } from './review-body'
export function Collapsible() {
  const [open, setOpen] = useState(false)
  return <div>{open && <ReviewBody />}</div>
}
```

```tsx
// ✓ server component as children — never enters the client module graph
// app/reviews/[id]/page.tsx  (server)
<Collapsible>
  <ReviewBody id={id} />
</Collapsible>

// collapsible.tsx  (client leaf)
'use client'
export function Collapsible({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return <div>{open && children}</div>
}
```

Providers, same principle:

```tsx
// ✗ 'use client' on the root layout makes the entire app a client bundle
// ✓ a client provider wrapping {children}, rendered from a server layout
export default function RootLayout({ children }) {
  return <html><body><ThemeProvider>{children}</ThemeProvider></body></html>
}
```

---

## §5.5 — A Server Action that is actually safe

```ts
// ✗ trusts the shape, not the ownership
'use server'
export async function updateReview(review: Review) {
  await db.review.update({ where: { id: review.id }, data: review })
}
```

```ts
// ✓ ID + the change; everything else re-read from a trusted source
'use server'
import 'server-only'
import { getCurrentUser } from '@/server/dal'

const schema = z.object({ id: z.string().uuid(), status: z.enum(['approved', 'rejected']) })

export async function updateReviewStatus(input: unknown) {
  const user = await getCurrentUser()            // 1. authenticate
  if (!user) return { error: 'unauthorized' }

  const parsed = schema.safeParse(input)          // 2. validate
  if (!parsed.success) return { error: 'invalid' }

  const review = await dal.getReviewForUser(parsed.data.id, user.id)
  if (!review) return { error: 'not_found' }      // 3. authorize THIS resource

  await dal.setReviewStatus(review.id, parsed.data.status)
  return { success: true }                        // 4. constrain the return
}
```

A well-formed `Review` object can still name a row the caller doesn't own — schema validation
checks shape, not ownership. And a page-level auth check does **not** protect an action defined
on that page.

---

## §5.4 — DTOs, not rows

```tsx
// ✗ the whole row crosses to the client — including fields nobody renders
<ReviewCard review={await db.review.findUnique({ where: { id } })} />

// ✓ shape it at the data layer
<ReviewCard review={await dal.getReviewCardDTO(id)} />
```

A broad prop type (`review: Review`) is a review flag: it encourages passing everything downward.

---

## §8 — DevDigest component folder

The repo's shape, for reference:

```
ReviewSummary/
  ReviewSummary.tsx
  ReviewSummary.test.tsx
  constants.ts
  helpers.ts
  styles.ts            Tailwind class strings as named consts
  index.ts
  _components/         children used only here
```

`_components/` graduates to `src/components/` on the second consumer — the §1.2 rule with local
naming.
