import type { CSSProperties } from "react";

export const s = {
  /** The svg scales to the dialog's width; the viewBox fixes the coordinates. */
  svg: {
    width: "100%",
    height: "auto",
    display: "block",
  } satisfies CSSProperties,
  edge: {
    stroke: "var(--border-strong)",
    strokeWidth: 1,
  } satisfies CSSProperties,
} as const;

/** Node dot, tinted per kind so the layers read apart at a glance. The legend
    in the dialog names exactly these four colours. */
export const nodeDot: Record<string, CSSProperties> = {
  symbol: { fill: "var(--accent)" },
  caller: { fill: "var(--text-muted)" },
  endpoint: { fill: "var(--ok)" },
  cron: { fill: "var(--warn)" },
};

export const label: CSSProperties = {
  fontSize: 11,
  fill: "var(--text-secondary)",
};

export const labelPrimary: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  fill: "var(--text-primary)",
};

export const sublabel: CSSProperties = {
  fontSize: 9,
  fill: "var(--text-muted)",
};
