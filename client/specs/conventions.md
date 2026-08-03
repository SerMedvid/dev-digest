# Spec — Conventions (`/repos/:repoId/conventions`)

**Status:** DRAFT (2026-08-03)
**Owner:** client · **Producer:** server ([`server/specs/conventions.md`](../../server/specs/conventions.md))
**Design:** [`docs/superpowers/specs/2026-08-03-conventions-extractor-design.md`](../../docs/superpowers/specs/2026-08-03-conventions-extractor-design.md)
**Plan:** [`docs/superpowers/plans/2026-08-03-conventions-extractor-client.md`](../../docs/superpowers/plans/2026-08-03-conventions-extractor-client.md)

One repo-scoped screen that turns a codebase into reviewable house rules. It
runs a scan, shows every surviving candidate beside the line of code that
evidences it, lets a human accept, reject or correct each one, and merges the
accepted set into a single Skill that can be linked to an agent on the spot.

The screen's organising idea is that **nothing is asserted without evidence**.
Every candidate carries a `file:line` and the quoted snippet, and the server has
already checked that the snippet is really there. A candidate the user cannot
verify at a glance is a candidate that should not have reached them.

## 1. The journey

**Scan → review → accept or correct → create Skill → optionally link an agent.**

The user opens Conventions for a repo and presses *Run extraction*. The scan is
server-side and asynchronous, so the screen reports progress and refreshes
itself until it settles. Each candidate arrives as a card: the rule in the
team's own terms, the file and line it was seen on, the snippet, and how
confident the model was.

The user accepts the ones that are genuinely house rules, rejects the rest, and
edits any that are nearly right — the wording, the cited file, or the line.
*Create skill* opens a modal prefilled with the merged body the server
assembled; the user reads it, edits it if they like, optionally picks an agent
to link, and saves. The skill lands in the Skills library at v1, and the linked
agent carries it on its next review.

*Re-scan* throws all of that away, so it asks first — and says exactly how many
decisions it would discard.

## 2. States

One query drives the screen. Six states, and the empty ones are distinguished
deliberately: "found nothing" and "found twenty and discarded them all" are
different facts about the repo, and only one of them means "try again".

| State | Behaviour |
|---|---|
| Loading | a skeleton under the header |
| Cannot load | `ErrorState` with a retry that refetches |
| Never scanned | empty state explaining what a scan does; the header's *Run extraction* starts it |
| Not indexed | empty state saying only config files can be read, and to re-sync for a full scan |
| Scanning | the header reports how many files are being read; the scan control is disabled |
| Scan failed | a banner naming the failure, carrying the server's own error text |
| Nothing survived | empty state listing each drop reason and its count — the difference between "found nothing" and "discarded everything" |
| Candidates | the selection bar plus one card per candidate |

The header carries the **only** scan trigger. The empty states describe what a
scan does but hold no button of their own: two controls reading *Run extraction*
on one screen look like two different actions.

## 3. Data sources

Component → hook in [`src/lib/hooks/conventions.ts`](../src/lib/hooks/conventions.ts)
→ `api`. No component calls `fetch`.

| Hook | Endpoint |
|---|---|
| `useConventions(repoId)` | `GET /repos/:id/conventions` |
| `useExtractConventions()` | `POST /repos/:id/conventions/extract` |
| `usePatchConvention()` | `PATCH /conventions/:id` |
| `useConventionSkillDraft(repoId, enabled)` | `GET /repos/:id/conventions/skill-draft` |
| `useCreateConventionSkill()` | `POST /repos/:id/conventions/skill` |

**Polling is conditional on the data itself.** `useConventions`' `refetchInterval`
is a function of `scan.status`: 2.5 s while `queued` or `running`, and `false`
otherwise. A settled scan never changes on its own, so polling one forever is
pure noise. Starting a scan invalidates the query immediately, so the `queued`
status — and the poll it starts — lands without waiting out an interval.

`useConventionSkillDraft` is enabled only while the modal is open: it 409s until
something is accepted, and a query that fails by design should not run by
default.

## 4. Behaviour worth pinning

- **A card owns its own mutation.** Accept, reject and edit all go through the
  card's own `usePatchConvention`, so the list stays a plain map over candidates
  and needs no callbacks threaded through it.
- **An edit sends only what changed.** Retyping a field to its existing value is
  not an edit, and an empty rule is never sent — the server would 422 it.
- **A failed save keeps the user's text.** The error appears beside the fields,
  which stay populated and editable.
- **Re-scan names what it destroys.** The confirmation says "discards 2 accepted
  and 5 rejected conventions", and it only appears when there is something to
  lose — confirming a no-op is noise that teaches users to click through.
- **Create is disabled at zero accepted**, because the endpoint 409s. A button
  that always fails is worse than one that says it cannot run.
- **The draft is adopted once.** A refetch must never overwrite what the user
  typed into the modal.
- **The body is always visible and always editable before saving.** That review
  step is the entire trust boundary for `source: 'extracted'` — see
  [`server/specs/skills.md`](../../server/specs/skills.md) §3.4.

## 5. Acceptance

1. A never-scanned repo shows the empty state, and the header starts a scan — `ConventionsView.test.tsx`
2. A running scan reports progress and blocks a second one — `ConventionsView.test.tsx`, `ScanHeader.test.tsx`
3. A zero-candidate scan lists its drop reasons — `ConventionsView.test.tsx`
4. A failed scan surfaces the server's error text — `ConventionsView.test.tsx`
5. A load failure offers a retry — `ConventionsView.test.tsx`
6. An unindexed repo says only configs can be read — `ConventionsView.test.tsx`
7. A card shows the rule, `file:line`, the snippet, the category and the confidence — `ConventionCard.test.tsx`
8. Accept and reject each round-trip as a `status` patch — `ConventionCard.test.tsx`
9. An edit sends only changed fields; an empty rule sends nothing; cancel discards — `ConventionCard.test.tsx`
10. A failed save shows the error and keeps the text — `ConventionCard.test.tsx`
11. Re-scan confirms only when there are decisions, and names their counts — `ScanHeader.test.tsx`
12. The selection bar counts accepted and disables create at zero — `SelectionBar.test.tsx`
13. The modal prefills from the draft and reports what it merged and its size — `CreateConventionSkillModal.test.tsx`
14. Creating sends the edited body, and the chosen agent only when one is picked — `CreateConventionSkillModal.test.tsx`
15. A failed draft and a failed create are each explained in place — `CreateConventionSkillModal.test.tsx`

Covered by 30 hermetic cases across
[`ConventionsView.test.tsx`](../src/app/repos/[repoId]/conventions/_components/ConventionsView/ConventionsView.test.tsx),
`ConventionCard`, `ScanHeader` (component + `relativeTime`), `SelectionBar`,
`CreateConventionSkillModal`, and
[`hooks/conventions.test.ts`](../src/lib/hooks/conventions.test.ts).
