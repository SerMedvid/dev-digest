import type { CSSProperties } from "react";

/** Co-located styles for RunCostBadge. */
export const s = {
  /** Plain (unboxed) text used on dense rows like the run timeline. */
  plain: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  /** Separator between the token segment and the cost. */
  sep: { opacity: 0.5 } satisfies CSSProperties,
  /** Cost sits slightly brighter than its token prefix — it's the headline. */
  cost: { color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
