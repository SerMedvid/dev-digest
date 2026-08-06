import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 22 } satisfies CSSProperties,
  loading: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  empty: {
    padding: "24px",
    fontSize: 14,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,
} as const;
