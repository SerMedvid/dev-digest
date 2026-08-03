import type { CSSProperties } from "react";

/** Co-located styles for the skills left column. */
export const s = {
  column: {
    width: 320,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  head: { padding: "16px 16px 12px" } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  } satisfies CSSProperties,
  h1: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  search: { position: "relative", display: "flex", alignItems: "center" } satisfies CSSProperties,
  searchIcon: {
    position: "absolute",
    left: 10,
    color: "var(--text-muted)",
    pointerEvents: "none",
  } satisfies CSSProperties,
  searchInput: {
    width: "100%",
    padding: "8px 10px 8px 30px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text)",
    fontSize: 13,
  } satisfies CSSProperties,
  list: { flex: 1, overflow: "auto", padding: "0 12px 12px" } satisfies CSSProperties,
} as const;
