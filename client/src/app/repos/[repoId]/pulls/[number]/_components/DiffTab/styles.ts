import type { CSSProperties } from "react";

export const s = {
  /** The PR-level stat line and the order toggle share one row, under the
   *  section label — the stats read left, the toggle sits hard right. */
  subheader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  } satisfies CSSProperties,
  stats: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  add: { color: "var(--code-add-text)" } satisfies CSSProperties,
  del: { color: "var(--code-del-text)" } satisfies CSSProperties,
  orderToggle: { display: "flex", gap: 6, marginLeft: "auto" } satisfies CSSProperties,
} as const;
