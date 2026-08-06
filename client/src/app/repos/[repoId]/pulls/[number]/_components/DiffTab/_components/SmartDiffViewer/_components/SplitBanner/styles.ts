import type { CSSProperties } from "react";

export const s = {
  banner: {
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    borderRadius: 8,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  title: { fontSize: 13, fontWeight: 700, color: "var(--warn)" } satisfies CSSProperties,
  body: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  list: {
    margin: 0,
    paddingLeft: 18,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
} as const;
