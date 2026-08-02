import type { CSSProperties } from "react";
import { CARD_WIDTH } from "./constants";
import type { CardPlacement } from "./helpers";

/* Both row texts exist in a static and an interactive variant — a surface may
   wire the jump, the file link, both, or neither. The metrics live here once so
   the two variants are pixel-identical and the row never reflows on wiring. */
const titleText: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-primary)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
};

const locationText: CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};

/** Co-located styles for FindingsBreakdown. */
export const s = {
  root: { display: "inline-block" } satisfies CSSProperties,
  /** Native button so Enter/Space toggle without any key handling of our own. */
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: 0,
    border: "none",
    background: "none",
    cursor: "pointer",
    font: "inherit",
  } satisfies CSSProperties,
  counters: (hovered: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    // Lifts the badges' own colours on hover. `SeverityBadge` is vendored and
    // takes no style prop, so a filter on the cluster is the only way to reach
    // them. Safe here even though `filter` creates a containing block for fixed
    // descendants: the fixed card is a sibling of the trigger, not a child.
    filter: hovered ? "brightness(1.25)" : "none",
    transition: "filter .12s",
  }),
  /** Underline under one badge, in that badge's severity colour. Always present,
   *  transparent when idle, so lighting it up never shifts the layout. */
  badgeWrap: (color: string, hovered: boolean): CSSProperties => ({
    display: "inline-flex",
    // All-longhand: mixing `border` shorthand with a longhand makes React warn
    // when only one of them updates on a rerender.
    borderBottomWidth: 1,
    borderBottomStyle: "dashed",
    borderBottomColor: hovered ? color : "transparent",
    transition: "border-bottom-color .12s",
    cursor: hovered ? "help" : "default",
  }),
  /** Fixed, not absolute: every host surface sets `overflow: hidden` to clip its
   *  rounded corners, which would clip an absolutely-placed card too. See
   *  `cardPlacement`. */
  card: (p: CardPlacement): CSSProperties => ({
    position: "fixed",
    left: p.left,
    ...(p.top !== undefined ? { top: p.top } : { bottom: p.bottom }),
    width: CARD_WIDTH,
    maxHeight: p.maxHeight,
    overflowY: "auto",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 9,
    boxShadow: "var(--shadow-modal)",
    padding: 6,
    zIndex: 40,
    textAlign: "left",
    cursor: "default",
  }),
  cardHeader: {
    padding: "6px 8px 8px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  findingRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "8px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  sevIcon: (color: string): CSSProperties => ({ color, flexShrink: 0, marginTop: 2 }),
  findingMain: {
    minWidth: 0,
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  } satisfies CSSProperties,
  title: titleText,
  /** The title as a jump target, on surfaces that wire one. Dotted underline
   *  rather than solid: it navigates within the app, unlike the file link. */
  titleButton: (hovered: boolean): CSSProperties => ({
    ...titleText,
    display: "block",
    width: "100%",
    textAlign: "left",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    color: hovered ? "var(--accent-text)" : "var(--text-primary)",
    textDecoration: "underline",
    textDecorationStyle: "dotted",
    textUnderlineOffset: 3,
  }),
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  /** file:line as plain mono text, on surfaces that can't build a GitHub URL. */
  location: locationText,
  /** file:line as a link into the PR's diff. Deliberately not the vendored
   *  `MonoLink`: it hardcodes `fontSize: 13` inline, which no wrapper can
   *  override, and 13 next to this card's 12px meta row reads as a different
   *  typeface. Same target semantics — new tab, noopener. */
  locationLink: (hovered: boolean): CSSProperties => ({
    ...locationText,
    cursor: "pointer",
    color: hovered ? "var(--accent-text)" : "var(--text-muted)",
    textDecoration: hovered ? "underline" : "none",
    textUnderlineOffset: 2,
  }),
  snippet: {
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--text-secondary)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
  footer: {
    padding: "8px",
    borderTop: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
