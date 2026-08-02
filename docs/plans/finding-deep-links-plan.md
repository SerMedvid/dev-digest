# Plan — Finding deep links from the breakdown card

**Date:** 2026-08-02 · **Status:** ready to implement
**Spec (authoritative for behaviour):**
[`client/specs/finding-deep-links.md`](../../client/specs/finding-deep-links.md)
**Builds on:** [`docs/plans/pr-findings-counters-plan.md`](pr-findings-counters-plan.md)
(commits `9e127b5`, `243ddce`) — this makes that card's rows actionable.

**Scope note:** this folder's README describes it as *cross-package* plans and
this feature is client-only. It lives here anyway: it is the direct successor
of the counters plan and belongs next to it, and there is no per-package plans
folder to move it to.

Decisions already made — do not re-litigate:

- The file link targets the PR's **Files changed** view (`/pull/{n}/files`
  with GitHub's `#diff-<sha256(path)>R<line>` anchor), **not** the blob at head
  SHA that `FindingCard` links to. Chosen deliberately: the point of the jump
  is to land in the review context.
- The run that owns a finding is resolved **client-side** from reviews already
  on the PR detail page. No contract change, no `review_id` on the list
  preview, no server work at all.
- In-page jumps use local state + a nonce; the `?finding=` URL param is for the
  cross-page hop and for sharing. The param is not cleared once consumed.
- `FindingCard`'s own blob link is left alone. The divergence is deliberate and
  is a separate decision to revisit, not scope for this change.

Read before starting: `client/CLAUDE.md` (component-folder convention,
`styles.ts` rule, hooks-only data access), `client/INSIGHTS.md`, and the
`FindingsBreakdown` header comment — its `stopPropagation` and viewport-fixed
placement are load-bearing and easy to break from here. Package manager for
`client/` is **pnpm**.

---

## Phase 1 — the GitHub file link

### 1.1 `client/src/lib/github-urls.ts`

Add alongside the existing `githubPrUrl` / `githubBlobUrl` (both stay):

```ts
export function githubPrFilesUrl(
  repoFullName: string, number: number,
  anchorHash?: string | null, startLine?: number, endLine?: number,
): string
```

No hash → the bare `https://github.com/{full}/pull/{n}/files`. With a hash →
`#diff-{hash}R{start}`, plus `-R{end}` when `end !== start`. Reuse the file's
existing `HOST` const; the path is not encoded into the anchor (the hash is of
the raw path).

```ts
export function diffAnchorHash(file: string): Promise<string | null>
```

`crypto.subtle.digest('SHA-256', TextEncoder)` → lowercase hex. Returns `null`
— never throws — when `crypto.subtle` is missing (non-secure context).
Memoized in a module-level `Map<string, Promise<string | null>>`, so the same
path costs one digest across every row and every card.

### 1.2 `client/src/components/findings-breakdown/hooks/useDiffAnchors.ts` (new)

```ts
useDiffAnchors(files: string[], enabled: boolean): Record<string, string>
```

One hook at card level rather than one per row: resolves each distinct path
once, only while `enabled` (the card is open), and ignores late resolutions
after unmount. Unresolved paths are simply absent from the record, which is
what makes the un-anchored href the natural fallback.

### 1.3 Component wiring

- `FindingsBreakdown` gains `link?: { repoFullName: string; prNumber: number }`.
  Absent → the rows stay plain text, unchanged from today.
- `FindingRow` gains an optional `href` and renders the location through the
  vendored `MonoLink` when set — it already handles `target="_blank"`,
  `rel="noopener noreferrer"` and `stopPropagation`. **Compose it, do not fork
  it**: it hardcodes `fontSize: 13` against the card's 12, so wrap it in a span
  carrying `s.location`'s size and truncation rules.

## Phase 2 — the finding jump

### 2.1 Emitting

`FindingsBreakdown` gains `onOpenFinding?: (findingId: string) => void`;
`FindingRow` renders the title as a `<button>` when it is set and a plain
`<span>` otherwise. The handler closes the card before invoking the callback.

Wire per surface:

- `pulls/page.tsx` → pass `repoFullName` (it already calls `useActiveRepo`) to
  `PRRow`; `PRRow` pushes
  `/repos/{repoId}/pulls/{number}?tab=findings&finding={id}` and passes `link`.
- `RunHistory` → new `onGoToFinding` prop next to the existing `onGoToReview`.
- `ReviewRunAccordion` header → the same callback, threaded from `FindingsTab`.

### 2.2 Consuming

- `pulls/[number]/page.tsx` — read `search.get("finding")` beside the existing
  `tab` / `trace` reads; pass it and `prNumber={pr.number}` to `FindingsTab`.
- `FindingsTab` — own `{ id, n }` target state, mirroring the existing
  `handleGoToReview`. Seed it from the param in an effect keyed on the param
  **and on `runs`**, because the param usually arrives before the reviews do.
  Resolve the owning review by scanning `runs`; an unresolvable id is ignored.
  In-page clicks bump the nonce without touching the URL.
- `ReviewRunAccordion` — extend the existing target effect: when its own
  findings contain the target, `setOpen(true)` and forward the id down. It must
  **not** scroll itself — two `scrollIntoView` calls fight, and the finding card
  is the more precise target.
- `FindingsPanel` — clear `hideLow` when it would filter the target out;
  set `focusIdx` to the target's index.
- `FindingCard` — add `id={`finding-${f.id}`}` next to the existing
  `data-finding-id` (keep both), `scrollMarginTop` on the card style, and on
  target: expand + `scrollIntoView({ block: "center" })`, re-fired by the nonce.

Mount ordering resolves itself: the accordion body only mounts once `open`
flips, so the card's effect runs on the following render.

### 2.3 i18n

New strings in the existing `findings.*` block of
`client/messages/en/prReview.json`. No literals in JSX.

## Phase 3 — tests & wrap-up

- Extend `FindingsBreakdown.test.tsx` (title button + file anchor + href
  upgrade + degradation), and keep its existing `stopPropagation` assertions
  green — they are the regression guard for the row underneath.
- New tests for `useDiffAnchors` (caching, no `crypto.subtle`), `FindingsTab`
  (param targets the *second* review's accordion, not the default-open first),
  `FindingsPanel` (`hideLow` cleared for a filtered-out target).
- `cd client && pnpm typecheck && pnpm test`.
- Manual pass against the spec's Acceptance list.
- Update `client/specs/README.md`'s index, add the Related/superseded line to
  `findings-counters-display.md`, and index this plan in `docs/plans/README.md`.
- Conventional commit on a branch off `main`, e.g.
  `feat(reviews): deep-link findings from the breakdown card`.

## Risks / edge cases

| Risk | Handling |
|---|---|
| GitHub lazy-loads / collapses large diffs, so the anchor may not scroll | Accepted. The URL is correct and the tab still lands on Files changed; documented in the spec's States table |
| GitHub changes its anchor scheme (it was md5 before sha256) | Isolated in one helper with one test; the fallback is an un-anchored but still valid link |
| `crypto.subtle` absent over plain http | `diffAnchorHash` returns `null`, href stays un-anchored. Never throws |
| Finding on a file the PR doesn't touch | Lands on Files changed with no scroll. Not worth suppressing the link for |
| `?finding=` for a deleted run or purged finding | Resolves to nothing, ignored silently |
| Target filtered out by `hideLow` | Panel clears the toggle — otherwise the jump silently does nothing, the worst outcome |
| Competing scroll between accordion and finding card | Only the card scrolls; the accordion just opens |
| Breaking the card's `stopPropagation` while adding interactive children | Existing tests assert the row underneath does not navigate; do not weaken them |
| `FindingCard` (blob link) and the card row (PR-files link) now disagree | Deliberate, recorded above; revisit separately |
