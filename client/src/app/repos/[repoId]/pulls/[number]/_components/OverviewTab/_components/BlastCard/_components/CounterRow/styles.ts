import type { CSSProperties } from "react";

export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 18,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  /** Flex, not inline text: preflight sets `display: block` on every svg, so an
      icon dropped in as an inline sibling takes a line to itself. */
  counter: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  icon: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  value: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--text-primary)",
    marginRight: 6,
  } satisfies CSSProperties,
  /** Pushes the button to the row's far edge, as the comp draws it. */
  spacer: {
    marginLeft: "auto",
  } satisfies CSSProperties,
} as const;
