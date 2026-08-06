# Spec — Smart Diff display: the Files changed tab, grouped by role

**Status:** DONE (2026-08-06)
**Owner:** client · **Producer:** server ([`server/specs/smart-diff.md`](../../server/specs/smart-diff.md))
**Design:** [`docs/superpowers/specs/2026-08-06-smart-diff-design.md`](../../docs/superpowers/specs/2026-08-06-smart-diff-design.md) §6
**Plan:** [`docs/superpowers/plans/2026-08-06-smart-diff.md`](../../docs/superpowers/plans/2026-08-06-smart-diff.md)
**Related:** [`finding-deep-links.md`](finding-deep-links.md) (a line's severity
chip reuses this deep-link machinery)

`SmartDiffViewer` is now the default rendering of the PR detail page's Files
changed tab: a PR's changed files grouped into **Core**, **Wiring** and
**Boilerplate**, ordered so the substance of the change comes first, marked
inline with any findings already on the PR, with mechanical files collapsed by
default and an optional split suggestion when the PR is large. `?order=original`
still falls back to today's flat, ungrouped viewer.

## 1. The journey

Entry point: `/repos/:repoId/pulls/:number` → Files changed tab (the default
render is `SmartDiffViewer`; the tab itself is unchanged —
[`DiffTab.tsx:92-96`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/DiffTab.tsx)).
The tab's own header is two rows: a section label reading **Reviewer-ordered
diff** in smart order and **Files changed** under `?order=original`, then a
subheader carrying the PR-level stat line (`{n} files · +A −D`, summed from the
rows the viewer renders) on the left and the **Smart order** / **Original
order** toggle hard right
([`DiffTab.tsx`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/DiffTab.tsx)).
The toggle is reflected in `?order=` on the URL, so the choice is shareable and
survives a reload, exactly like the page's existing `?tab=`/`?trace=` params
([`page.tsx:66-68`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/page.tsx)).
`SmartDiffViewer` renders no caption of its own — the section label is the
single caption for the tab.

Within `SmartDiffViewer` (smart order, the default): one section per present
group, in fixed `Core logic → Wiring → Boilerplate` order. A group's heading is
one row — a role-coloured bullet, the label, its one-line description, and the
file count pushed to the right edge — followed by one `FileCard` per file, the
same diff renderer the flat viewer uses, extended with optional props rather
than forked
([`GroupSection.tsx`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/_components/GroupSection/GroupSection.tsx)).
A file carrying findings shows a dot beside its path, coloured by the worst
severity on it and **named** `{n} findings` for assistive tech rather than
showing the count; every file offers a **summary** pill, badged with the design
system's lucide `Sparkles` icon rather than an emoji.

Two click targets, deliberately different (design §6.3):

- **A file's finding dot** expands that file and scrolls to its lowest
  marked line
  ([`GroupSection.tsx:82-91`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/_components/GroupSection/GroupSection.tsx),
  [`SmartDiffViewer.tsx:66-76`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/SmartDiffViewer.tsx)).
- **A line's severity chip** navigates to `?tab=findings&finding=<id>`
  ([`page.tsx:191`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/page.tsx)),
  reusing [`finding-deep-links.md`](finding-deep-links.md)'s machinery — it
  never touches collapse or scroll state. The chip is a labelled badge — icon
  plus word, tinted fill and no outline, shaped like the `Badge` primitive the
  rest of the app uses, with the icon carrying the severity for anyone who
  can't use the colour
  (`blocker` / `warning` / `suggestion` — the reviewer-facing wording for
  `CRITICAL` / `WARNING` / `SUGGESTION`, mapped in
  [`CodeLine/constants.ts`](../src/components/diff-viewer/CodeLine/constants.ts))
  sitting at the end of its row, with the row carrying a matching coloured left
  rule; the border is always laid out and merely transparent when unmarked, so
  a mark never shifts code text sideways.

The summary pill is the one deliberate exception to "viewing this tab calls no
model": clicking it is an **explicit** action
([`SummaryPill.tsx`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/_components/SummaryPill/SummaryPill.tsx)),
never triggered on render, on scroll, or on group expand.

## 2. States

| State | Behaviour |
|---|---|
| Loading | three skeleton bars, no placeholder text ([`SmartDiffViewer.tsx:81-87`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/SmartDiffViewer.tsx)) |
| Error | `ErrorState` with a hardcoded title (`"Couldn't load Smart Diff"` — matches `page.tsx`'s own un-translated `ErrorState` precedent) and the server's `ApiError.message` as the body when available, with a `Retry` wired to `refetch()` ([`SmartDiffViewer.tsx:90-97`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/SmartDiffViewer.tsx)) |
| Empty (`groups: []` — PR never imported) | the same `"No changed files."` copy the flat `DiffViewer` already shows, reused via `shell.diffViewer.noChangedFiles`, not a new key ([`SmartDiffViewer.tsx:100-102`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/SmartDiffViewer.tsx)) |
| Pre-review (no finding on any file yet) | not a distinct branch — grouping, ordering and collapse all render exactly as with findings present, just with no badge; this is the default path every fixture without `finding_marks` already exercises |
| PR too big (`split_suggestion.too_big`) | `SplitBanner` renders above the groups, titled with `total_lines`, one list item per proposed split — or no list at all when the server returned `proposed_splits: []`, rendered as an honest "no plan" rather than a fabricated one-item list ([`SplitBanner.tsx`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/_components/SplitBanner/SplitBanner.tsx)) — **absent** on the seeded PR (`too_big: false`) |
| `?order=original` | `DiffTab` renders the flat `DiffViewer` instead of `SmartDiffViewer` and its section label falls back to `Files changed`; every other behaviour on the page (comments, tab, trace drawer) is unaffected ([`DiffTab.tsx`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/DiffTab.tsx)) |
| Summary pill: idle / pending / success / failure | **summary** → **Summarizing…** (own local pending state, not the shared mutation's `isPending`, so one file's request in flight doesn't flash every other file's pill — see `SummaryPill.tsx`'s own note) → on success the sentence renders under **What this does:** ([`GroupSection.tsx:96-102`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/_components/GroupSection/GroupSection.tsx)); on failure a toast and the pill returns to idle, nothing rendered |

## 3. Data

- `useSmartDiff(prId)` — `["pr-smart-diff", prId]` →
  `GET /pulls/:id/smart-diff`
  ([`lib/hooks/smart-diff.ts:10-16`](../src/lib/hooks/smart-diff.ts)).
- `useFileSummary(prId)` — a mutation posting `{ path }` to
  `POST /pulls/:id/smart-diff/summary`, whose `onSuccess` patches the returned
  sentence into the cached `SmartDiff` via `setQueryData` rather than
  invalidating — a full refetch would re-run grouping/marks for every file to
  pick up one string
  ([`lib/hooks/smart-diff.ts:21-45`](../src/lib/hooks/smart-diff.ts)).
- `SmartDiff` carries no patch text; `helpers.ts#joinFilesWithGroups` joins the
  server's grouped files with the PR's own `PrFile[]` (already on the page) by
  path — a path present in a group but missing from `files` still renders
  (header, stats, badge) via a patch-less stand-in, rather than silently
  vanishing
  ([`helpers.ts:37-51`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/helpers.ts)).
- Group and file order is **trusted from the server**, never re-derived
  client-side — the server module already guarantees a fixed, total order
  (server spec §3.2); re-sorting here could silently diverge from its
  tie-break rules.
- No `fetch` in a component. Failures arrive as `ApiError`, branching into the
  toast (summary) or inline `ErrorState` (initial load) taxonomy.

## 4. Interaction

- **Collapse precedence** (design §6.2), evaluated in this order and seeded
  once per PR
  ([`helpers.ts:64-78`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/helpers.ts)):
  1. `boilerplate` starts collapsed, unconditionally — even carrying a
     finding. Its badge still shows and remains clickable.
  2. Otherwise a file with at least one finding starts expanded.
  3. Otherwise the existing `AUTO_EXPAND_MAX_LINES` (200-line) auto-expand
     threshold applies, unchanged from the flat viewer.
- A user's manual toggle persists across a summarize success — the seed effect
  that applies the precedence above runs only once per `prId`, not on every
  `data` change, so patching in a new `pseudocode_summary` (which gives `data`
  a new object identity) cannot silently discard a toggle already made
  ([`SmartDiffViewer.tsx:42-54`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/SmartDiffViewer.tsx)).
- A badge click always re-scrolls to its file's first marked line, even on a
  **repeat** click of the same badge — the target `FileCard` is remounted
  (`key={ path:token }`, `token` incrementing on every click) specifically to
  defeat `FileCard`'s own scroll-latch, which otherwise ignores an unchanged
  `scrollToLine` prop
  ([`GroupSection.tsx:66-78`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/_components/GroupSection/GroupSection.tsx)).
- Clicking a file's header (open/close) and clicking its badge or pill are
  independent — badge/pill clicks call `stopPropagation` so they never also
  toggle the card
  ([`GroupSection.tsx:84-86`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/_components/GroupSection/GroupSection.tsx),
  [`SummaryPill.tsx:29-30`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/_components/SummaryPill/SummaryPill.tsx)).
- Nothing about viewing the tab is optimistic. The only mutation
  (`useFileSummary`) waits for the server; there is no local echo of a summary
  before the response lands.
- **Every new `FileCard`/`CodeLine` prop this feature adds defaults to today's
  behaviour**, so `?order=original` renders byte-identical to the pre-feature
  flat viewer — no new prop is ever implicitly on.

## 5. Acceptance

| # | Item | Covered by |
|---|---|---|
| 1 | Three groups render in fixed order (Core, Wiring, Boilerplate), each with its label and file count | [`SmartDiffViewer.test.tsx:153-171`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/SmartDiffViewer.test.tsx) |
| 2 | A finding-bearing core file starts expanded (§6.2 rule 2) | `SmartDiffViewer.test.tsx:172-178` |
| 3 | A finding-bearing boilerplate (lock) file starts collapsed anyway, its dot still shown and still named `{n} findings` (§6.2 rule 1 wins over rule 2) | `SmartDiffViewer.test.tsx` ("keeps a finding-bearing boilerplate file collapsed") |
| 4 | Clicking a finding dot expands its file and scrolls to the first marked line | `SmartDiffViewer.test.tsx` ("expands the boilerplate file and scrolls…") |
| 5 | Clicking a line's severity chip navigates to the finding (`?tab=findings&finding=`) | `SmartDiffViewer.test.tsx:204-214` |
| 6 | The summary pill: posts `{ path }`, shows a pending label, then renders the sentence on success | `SmartDiffViewer.test.tsx:215-241` |
| 7 | The summary pill: toasts the error and returns to idle on failure, persisting nothing | `SmartDiffViewer.test.tsx:242-255` |
| 7a | The summary pill: a "no stored patch" 404 surfaces the client's own honest `smartDiff.noStoredDiff` message, not the raw server text | `SmartDiffViewer.test.tsx:257-277` |
| 8 | `?order=original` renders the flat `DiffViewer`, with `SmartDiffViewer`'s own caption absent | `SmartDiffViewer.test.tsx:280-` ("DiffTab order toggle") |
| 9 | Group labels render as written (`Core logic`/`Wiring`/`Boilerplate`) — a locator note, not new behaviour. They were CSS-uppercased until the reference-alignment pass removed `textTransform`, so any locator matching `CORE` is stale | [`GroupSection/styles.ts`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/_components/GroupSection/styles.ts) |
| 11 | The line chip reads `blocker`/`warning`/`suggestion` and is a sibling of the code text, not nested inside it | [`FileCard.test.tsx`](../src/components/diff-viewer/FileCard/FileCard.test.tsx) ("anchors a mark to the matching new-side line") |
| 12 | `pathAdornment` sits with the path, `headerExtra` precedes the +/− stat | `FileCard.test.tsx` ("puts pathAdornment beside the path…") |
| 10 | The seeded PR renders all three groups, `package-lock.json` present but collapsed, and clicking it genuinely expands it (a click-caused state change, not a load-time fact) — a real browser, no model key | [`e2e/specs/09-pr-smart-diff.flow.json`](../../e2e/specs/09-pr-smart-diff.flow.json) — written, and every selector individually proven against static fixtures (both a correct and a deliberately-broken behaviour state) mirroring the real DOM shape, but the flow has **not** been observed passing end to end in this environment (a pre-existing, out-of-scope Windows bug in `e2e/run.ts` plus a session-local Docker outage — full account in `.superpowers/sdd/2026-08-06-smart-diff/task-9-report.md` and the final fix report). This row no longer claims e2e coverage of the finding-badge click specifically (acceptance item 4 above) — neither seeded boilerplate file carries a finding, so a badge click cannot be exercised against a currently-collapsed file without changing the seed; that interaction stays covered by `SmartDiffViewer.test.tsx` alone. Treat this row as **not yet verified** |

## 6. Known gaps

- ~~**`CodeLine`'s severity-mark chip nests a `<button>` inside a `<span>`.**~~
  **Closed** by the reference-alignment pass: moving the chip to the end of the
  row made it a sibling of
  [`CodeLine.tsx`](../src/components/diff-viewer/CodeLine/CodeLine.tsx)'s text
  span rather than a child of it, so a screen reader no longer announces the
  chip's name interleaved with the code text. Covered by acceptance row 11.
- `AUTO_EXPAND_MAX_LINES` is duplicated locally
  ([`constants.ts`](../src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/DiffTab/_components/SmartDiffViewer/constants.ts))
  rather than imported from `components/diff-viewer/constants.ts`, which does
  not export it from its barrel. See
  [`server/specs/smart-diff.md`](../../server/specs/smart-diff.md) §7 for the
  full note — recorded there since it is a cross-cutting risk, not purely a
  display concern.
- `SummaryPill`'s generic-error toast (`"Couldn't summarize this file."`, the
  fallback for any failure other than the specific "no stored patch" 404,
  which now has its own `smartDiff.noStoredDiff` catalogue entry) and
  `SmartDiffViewer`'s `ErrorState` title (`"Couldn't load Smart Diff"`) remain
  hardcoded strings rather than `smartDiff.*` message-catalogue entries — both
  mirror an existing hardcoded precedent already on this same page. See
  `server/specs/smart-diff.md` §7.
- The **finding dot's accessible name** (`{n} findings`) and the group's
  **`{n} files`** count have no singular form — one finding still reads
  `"1 findings"`, matching this catalogue's existing `filesCount` convention
  rather than introducing pluralisation this feature would be the first to
  need. The dot shows no visible count at all, so only assistive tech reads it.
- The group heading no longer carries a **finding-line count** for the whole
  group. It was dropped rather than restyled when the heading became a single
  row: the per-file dots already say which files carry findings, and the
  reference design has no equivalent element.
