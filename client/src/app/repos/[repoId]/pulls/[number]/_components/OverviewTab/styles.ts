import type { CSSProperties } from "react";

export const s = {
  /** Intent | Blast side by side, as the comp draws them. `auto-fit` +
      `minmax` collapses to one column on a narrow viewport without a media
      query — which inline CSSProperties cannot express. */
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
    gap: 24,
    alignItems: "start",
  } satisfies CSSProperties,
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
