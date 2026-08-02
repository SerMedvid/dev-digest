# Spec — Finding deep links (breakdown card → GitHub file, breakdown card → the finding)

**Status:** DRAFT (2026-08-02)
**Owner:** client · **Producer:** none — no server change, no new endpoint
**Plan:** [`docs/plans/finding-deep-links-plan.md`](../../docs/plans/finding-deep-links-plan.md)
**Supersedes part of:** [`findings-counters-display.md`](findings-counters-display.md) §4,
which specified the card's `file:line` as plain text with "no navigation target"

The breakdown card that opens from the per-severity counters is read-only: a
reader who spots a finding there has no way out of it. Two of its row elements
become links:

1. **`file:line` →** that file inside the pull request's *Files changed* view on
   GitHub, in a new tab.
2. **Finding title →** that exact finding on the PR detail page, with its review
   run expanded and the finding scrolled to.

Both apply on all three surfaces the card renders on (PR list column, run
timeline, review-run accordion header), because the card is one component.

## 1. The journey

### File path → GitHub

Clicking `server/src/modules/webhooks/replay.ts:42-50` opens a new tab at
`https://github.com/{owner}/{repo}/pull/{number}/files#diff-{sha256(path)}R{start}[-R{end}]`
— GitHub's *Files changed* view, scrolled to that file and line on the new
side of the diff. The finding is read in its review context (the diff, existing
comments), which is where the reader can act on it.

The anchor is GitHub's own scheme: the sha256 hex of the repo-relative file
path. It is computed in the browser, so it resolves a moment after the card
paints; until then the same link points at the un-anchored
`/pull/{number}/files`. The link is never absent and never dead.

### Title → the finding

Clicking a finding's title lands on
`/repos/:repoId/pulls/:number?tab=findings&finding={findingId}` — the **Agent
runs** tab — with:

- the review-run accordion that produced the finding expanded (not necessarily
  the newest run, which is the one open by default);
- that finding's card expanded, focused, and scrolled into view.

From the PR list this is a route navigation. From the two PR-detail surfaces
the page is already correct, so it is an in-page scroll; the URL is not
rewritten there, matching how the timeline's existing "go to review" behaves.

The `?finding=` parameter exists for the cross-page hop and for sharing a link;
it is not cleared after it is consumed.

## 2. States

| State | Behaviour |
|---|---|
| Diff anchor not yet computed | link is the bare `/pull/{n}/files` URL; it upgrades in place once the hash resolves |
| `crypto.subtle` unavailable (page served over plain http on a non-localhost host) | link stays the bare `/pull/{n}/files` URL permanently — no error, no missing link |
| File is not part of the PR diff, or GitHub has not expanded it (large / collapsed diffs load lazily) | the tab opens on *Files changed*, the browser simply does not scroll. Accepted: the URL is still correct |
| Repo `full_name` not loaded yet | `file:line` renders as plain text, exactly as before this feature. No placeholder link |
| `?finding=` names a finding that no surviving review contains (deleted run, dismissed-and-purged, stale link) | ignored silently — the page renders normally on the Agent runs tab |
| `?finding=` arrives before `usePrReviews` resolves | held; the jump fires when the reviews land |
| Target finding is hidden by the panel's "hide low confidence" toggle | the toggle is turned off so the finding can be shown — the jump must never silently do nothing |
| Card row on a surface that wires neither target | title is plain text and `file:line` is plain text; the component degrades, it is shared across routes |

## 3. Data

- **No new hook, no new endpoint, no contract change.** The finding id already
  travels in `PrFindingPreview` (list) and `FindingRecord` (detail) — see
  `contracts/platform.ts` and `contracts/review-api.ts`.
- The **run that owns a finding is resolved client-side** on the PR detail page
  by scanning the reviews already fetched by `usePrReviews`; each
  `ReviewRecord` carries its own `findings`. The list's capped 6-row preview is
  sufficient because only the id crosses the page boundary.
- The GitHub URL is built from `Repo.full_name` (via the active-repo context)
  and the PR number — both already on the page on every surface.
- No failure mode of its own: nothing is fetched. A failed pulls or reviews
  fetch behaves exactly as it does today.

## 4. Interaction

- The title is a real button and `file:line` a real anchor — both are in the
  tab order inside the card, both activate with Enter/Space (anchor: Enter),
  and both carry an accessible name distinct from their visible text where the
  visible text alone is ambiguous.
- File links open in a new tab with `rel="noopener noreferrer"`; middle-click
  and "copy link address" work, because it is an anchor and not a
  `window.open` handler.
- The guarantees from [`findings-counters-display.md`](findings-counters-display.md)
  §4 still hold in full: activating anything inside the card never navigates
  the PR row underneath and never toggles the accordion header underneath.
- Either click closes the card, so it is not left hanging over the destination.
- Clicking the **same** title twice re-runs the scroll. The jump is
  edge-triggered on a counter, not on the id, so a repeat click is not a no-op.
- The scrolled-to finding also receives the panel's keyboard focus index, so
  `j`/`k` continue from it rather than from the top of the list.
- Nothing here is optimistic and nothing mutates.

## 5. Acceptance

- [ ] Card row's `file:line` renders as an anchor when the repo full name is
      known, and as plain text when it is not.
- [ ] That anchor's href is `…/pull/{n}/files` on first paint and
      `…/pull/{n}/files#diff-{hash}R{start}` once the hash resolves; a
      multi-line finding appends `-R{end}`.
- [ ] The same file appearing in several rows is hashed once.
- [ ] With `crypto.subtle` unavailable, the href stays the bare `/files` URL
      and nothing throws.
- [ ] Card row's title is a button when a surface wires the jump, plain text
      otherwise; clicking it closes the card.
- [ ] From the PR list, clicking a title navigates to
      `?tab=findings&finding={id}`.
- [ ] On the PR detail page, `?finding={id}` for a finding in the *second*
      review expands that review's accordion — not the default-open newest one
      — and expands + scrolls to that finding's card.
- [ ] A `?finding=` id present before the reviews have loaded still lands once
      they do.
- [ ] An unknown `?finding=` id changes nothing and throws nothing.
- [ ] With "hide low confidence" on, jumping to a low-confidence finding turns
      the toggle off and shows it.
- [ ] Clicking the same title twice on an in-page surface scrolls both times.
- [ ] Regression: clicking the counters, a title, or a file path on a PR list
      row does not navigate the row; Escape still closes the card and returns
      focus to the trigger.

e2e: no new flow. `04-pr-findings.flow.json` may need a touch-up only if it
pins the breakdown card's row contents.
