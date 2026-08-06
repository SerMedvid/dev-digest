import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 14,
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
    gap: 18,
  } satisfies CSSProperties,
  listHeading: {
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "var(--text-secondary)",
    marginBottom: 6,
  } satisfies CSSProperties,
  list: {
    margin: 0,
    paddingLeft: 16,
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
    border: "1px solid var(--border)",
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
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
