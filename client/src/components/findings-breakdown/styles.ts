import type { CSSProperties } from "react";
import { CARD_MAX_HEIGHT, CARD_WIDTH } from "./constants";

/** Co-located styles for FindingsBreakdown. */
export const s = {
  /** Positioning context for the absolutely-placed card. */
  root: { position: "relative", display: "inline-block" } satisfies CSSProperties,
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
  counters: { display: "inline-flex", alignItems: "center", gap: 5 } satisfies CSSProperties,
  card: (align: "left" | "right"): CSSProperties => ({
    position: "absolute",
    top: "calc(100% + 6px)",
    [align]: 0,
    width: CARD_WIDTH,
    maxHeight: CARD_MAX_HEIGHT,
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
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0,
  } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  /** file:line as plain mono text — there's no navigation target on the list. */
  location: {
    fontSize: 12,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  } satisfies CSSProperties,
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
