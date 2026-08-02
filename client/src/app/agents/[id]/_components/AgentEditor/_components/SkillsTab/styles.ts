import type { CSSProperties } from "react";

/** Co-located styles for the agent editor's Skills tab. */
export const s = {
  pane: { padding: 24, maxWidth: 780 } satisfies CSSProperties,
  headRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  heading: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  counter: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  hint: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: "6px 0 16px",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  filter: { marginBottom: 14 } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)", marginTop: 12 } satisfies CSSProperties,
} as const;
