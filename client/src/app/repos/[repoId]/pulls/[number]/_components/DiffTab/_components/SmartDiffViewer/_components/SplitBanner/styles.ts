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
  /* `listStyleType` is restated because Tailwind's preflight sets
     `list-style: none` on every `ul`/`ol` — without it the proposed splits
     render as bare indented lines that read as one run-on paragraph. */
  list: {
    margin: 0,
    paddingLeft: 18,
    listStyleType: "disc",
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
} as const;
