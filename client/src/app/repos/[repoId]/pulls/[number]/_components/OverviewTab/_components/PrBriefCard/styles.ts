import type { CSSProperties } from "react";

export const s = {
  section: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  /** The empty state, sized like the banner it replaces so the page does not
   *  shift once a brief lands. */
  empty: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 10,
  } satisfies CSSProperties,
  emptyText: { fontSize: 14, color: "var(--text-secondary)", margin: 0 } satisfies CSSProperties,
  emptyHint: { fontSize: 13, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  /** Sits directly under the control that produced it — at the foot of the
   *  card it would be a screen away from the click. */
  warning: {
    margin: 0,
    fontSize: 12,
    color: "var(--warn)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  error: {
    margin: 0,
    fontSize: 12,
    color: "var(--crit)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  what: {
    margin: 0,
    fontSize: 13,
    color: "var(--text-muted)",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
