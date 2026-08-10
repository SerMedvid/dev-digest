import type { CSSProperties } from "react";

export const s = {
  block: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0,
  } satisfies CSSProperties,
  /** A real <button>, restyled flat — the whole header is the hit area, as
      `SymbolRow`'s is. */
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: 0,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    textAlign: "left",
    minWidth: 0,
  } satisfies CSSProperties,
  chevron: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  title: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /** Sits at the far edge, so the collapsed header still carries the signal
      rather than being an opaque label. */
  count: {
    marginLeft: "auto",
    fontSize: 11,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0,
  } satisfies CSSProperties,
  list: {
    margin: 0,
    padding: 0,
    // Preflight strips ul markers and this list wants none.
    listStyleType: "none",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 8,
    fontSize: 12,
    minWidth: 0,
  } satisfies CSSProperties,
  number: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  /** A PR title is free text and can be long — it must wrap, not widen. */
  title2: {
    color: "var(--text-primary)",
    minWidth: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  meta: {
    marginLeft: "auto",
    fontSize: 11,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  note: {
    margin: 0,
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
} as const;
