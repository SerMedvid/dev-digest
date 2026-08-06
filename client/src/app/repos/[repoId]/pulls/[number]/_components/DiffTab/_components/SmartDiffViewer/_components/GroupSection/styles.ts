import type { CSSProperties } from "react";

export const s = {
  group: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  heading: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  label: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  desc: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  meta: {
    display: "flex",
    gap: 10,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  headerExtra: { display: "inline-flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 7px",
    borderRadius: 999,
    border: "1px solid var(--warn)",
    color: "var(--warn)",
    background: "var(--warn-bg)",
    cursor: "pointer",
    flexShrink: 0,
  } satisfies CSSProperties,
  preBody: {
    padding: "10px 14px",
    fontSize: 12.5,
    color: "var(--text-secondary)",
    borderBottom: "1px solid var(--border)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
} as const;
