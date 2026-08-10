import type { CSSProperties } from "react";

export const s = {
  /** Rendered at its own scale rather than shrunk to fit: the canvas grows with
      the map, and the modal body is what scrolls. Tailwind 4's preflight already
      sets `display: block` on every svg (INSIGHTS 2026-08-06); restated here so
      the rule does not depend on it. */
  svg: {
    display: "block",
    maxWidth: "100%",
    /** Lets the canvas scale down proportionally on a narrow viewport rather
        than being squashed by `maxWidth` against a fixed height attribute. */
    height: "auto",
  } satisfies CSSProperties,
  edge: {
    stroke: "var(--border-strong)",
    strokeWidth: 1,
    fill: "none",
  } satisfies CSSProperties,
  header: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fill: "var(--text-muted)",
  } satisfies CSSProperties,
  headerRule: {
    stroke: "var(--border)",
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
