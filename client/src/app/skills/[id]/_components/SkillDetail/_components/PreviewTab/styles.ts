import type { CSSProperties } from "react";

/** Co-located styles for the skill Preview tab. */
export const s = {
  pane: { padding: 28, maxWidth: 820 } satisfies CSSProperties,
  heading: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: "4px 0 18px",
  } satisfies CSSProperties,
  surface: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 20,
    fontSize: 13,
  } satisfies CSSProperties,
} as const;
