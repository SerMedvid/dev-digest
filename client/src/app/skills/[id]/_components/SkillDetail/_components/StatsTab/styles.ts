import type { CSSProperties } from "react";

/** Co-located styles for the skill Stats tab. */
export const s = {
  pane: { padding: 28, maxWidth: 820 } satisfies CSSProperties,
  tile: { padding: 18, marginBottom: 18 } satisfies CSSProperties,
  tileLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  } satisfies CSSProperties,
  tileValue: { fontSize: 30, fontWeight: 700, marginTop: 6 } satisfies CSSProperties,
  tileUnit: {
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-muted)",
    marginLeft: 8,
  } satisfies CSSProperties,
  heading: { fontSize: 15, fontWeight: 700, marginBottom: 12 } satisfies CSSProperties,
  agentRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 0",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  agentLink: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--accent)",
    textDecoration: "none",
  } satisfies CSSProperties,
} as const;
