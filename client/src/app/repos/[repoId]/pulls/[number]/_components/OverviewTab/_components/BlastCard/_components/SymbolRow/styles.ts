import type { CSSProperties } from "react";

export const s = {
  block: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingBottom: 12,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  /** A real <button>, restyled flat — the whole header is the hit area. */
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
    fontSize: 13,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  chevron: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  codeIcon: {
    color: "var(--accent)",
    flexShrink: 0,
  } satisfies CSSProperties,
  name: {
    fontWeight: 600,
  } satisfies CSSProperties,
  kind: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /** Caller count sits at the far edge, as the comp draws it. */
  count: {
    marginLeft: "auto",
    fontSize: 11,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingLeft: 22,
  } satisfies CSSProperties,
  declared: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  callerList: {
    margin: 0,
    padding: 0,
    // Preflight strips ul markers and this list wants none — the ↳ glyph is
    // what nests each row under its symbol.
    listStyleType: "none",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  branch: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  callerSymbol: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  } satisfies CSSProperties,
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    borderRadius: 5,
    padding: "2px 8px",
    fontSize: 11,
    color: "var(--info)",
    background: "var(--info-bg)",
  } satisfies CSSProperties,
  cronChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    borderRadius: 5,
    padding: "2px 8px",
    fontSize: 11,
    color: "var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
} as const;
