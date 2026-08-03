import type { CSSProperties } from "react";

/** Co-located styles for the skill Versions tab. */
export const s = {
  pane: { padding: 28, maxWidth: 820 } satisfies CSSProperties,
  headRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  heading: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: "4px 0 18px",
  } satisfies CSSProperties,
  row: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 14,
    marginBottom: 10,
  } satisfies CSSProperties,
  rowHead: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  versionChip: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent)",
    background: "var(--accent-bg)",
    padding: "1px 8px",
    borderRadius: 4,
  } satisfies CSSProperties,
  summary: {
    fontSize: 13,
    flex: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  noSummary: { fontSize: 13, flex: 1, color: "var(--text-muted)" } satisfies CSSProperties,
  date: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)", marginTop: 12 } satisfies CSSProperties,
} as const;
