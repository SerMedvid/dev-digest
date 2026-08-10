import type { CSSProperties } from "react";

export const s = {
  /** The vendored Modal pads its header but gives the body ZERO padding, so the
      gutter has to come from here (INSIGHTS 2026-08-03). */
  body: {
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  legend: {
    display: "flex",
    flexWrap: "wrap",
    gap: 18,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 7,
  } satisfies CSSProperties,
  swatch: (color: string): CSSProperties => ({
    width: 9,
    height: 9,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  }),
} as const;
