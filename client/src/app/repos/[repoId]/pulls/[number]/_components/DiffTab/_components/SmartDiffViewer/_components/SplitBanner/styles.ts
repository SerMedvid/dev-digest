import type { CSSProperties } from "react";

export const s = {
  banner: {
    // Tinted fill, no outline — the house badge/callout language (see the
    // agents page): the colour carries the severity, the border added nothing
    // but weight.
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
