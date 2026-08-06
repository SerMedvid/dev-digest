import type { CSSProperties } from "react";
import type { IntentConfidence } from "@devdigest/shared";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "18px 20px 20px",
    display: "flex",
    flexDirection: "column",
    // The one control for every section boundary — statement, columns, the
    // missing-context list, the meta row. The card stacks a lot of dense,
    // wrapping prose, and at 14 the blocks read as one continuous run.
    // `SectionLabel` adds its own 14px below the heading, so the title keeps
    // more air than the body sections do, which is what you want of a heading.
    gap: 22,
  } satisfies CSSProperties,
  statement: {
    margin: 0,
    fontSize: 14,
    fontStyle: "italic",
    color: "var(--text-primary)",
    lineHeight: 1.55,
  } satisfies CSSProperties,
  columns: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    // Row gap first: below ~460px the two scope lists stop being side-by-side
    // and become stacked sections, where 18px read as one list of mixed items.
    gap: "22px 20px",
  } satisfies CSSProperties,
  /** Both column headings: icon + uppercase label on one line. The colour is
   *  the variant below, so the two headings stay identical in everything else. */
  listHeading: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 8,
  } satisfies CSSProperties,
  inScopeHeading: { color: "var(--ok)" } satisfies CSSProperties,
  outOfScopeHeading: { color: "var(--text-muted)" } satisfies CSSProperties,
  list: {
    margin: 0,
    paddingLeft: 16,
    listStyleType: "disc",
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
  emptyNote: {
    margin: 0,
    fontSize: 13,
    fontStyle: "italic",
    color: "var(--text-muted)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
  badge: {
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  } satisfies CSSProperties,
  badgeDot: {
    display: "inline-block",
    width: 6,
    height: 6,
    borderRadius: 999,
    marginRight: 6,
    // Inherits the pill's own colour, so the dot needs no per-level variant.
    background: "currentColor",
    verticalAlign: "middle",
  } satisfies CSSProperties,
  warning: {
    margin: 0,
    paddingLeft: 16,
    fontSize: 12,
    color: "var(--warn)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  meta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;

/**
 * The confidence pill, tinted per level. Spread over `s.badge`, same as the
 * two column headings above — the base owns the shape, the variant owns only
 * the colour.
 *
 * `low` is grey, deliberately, and not red: low confidence means the evidence
 * was thin (title and hunk headers only), which is a normal outcome for a PR
 * with no description — not a failure, and not something to alarm the user
 * about. `--crit` is reserved for things that actually went wrong.
 *
 * Tinted fill and no outline, matching the `Badge` primitive the agents page
 * uses — the tint alone carries the level. (The variants used to restate a
 * full `border` shorthand each, to keep a shorthand and its longhand from
 * swapping places across a re-derive; with no border on either the base or the
 * variants, there is nothing left to collide.)
 */
export const badgeConfidence: Record<IntentConfidence, CSSProperties> = {
  high: { color: "var(--ok)", background: "var(--ok-bg)" },
  medium: { color: "var(--warn)", background: "var(--warn-bg)" },
  low: { color: "var(--info)", background: "var(--info-bg)" },
};
