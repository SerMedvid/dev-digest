import type { CSSProperties } from "react";
import { GRAPH_MAX_HEIGHT } from "./constants";

export const s = {
  /** Scrolls rather than shrinking text once the graph outgrows the card. */
  scroller: {
    maxHeight: GRAPH_MAX_HEIGHT,
    overflowY: "auto",
    overflowX: "auto",
  } satisfies CSSProperties,
  edge: {
    fill: "none",
    stroke: "var(--border-strong)",
    strokeWidth: 1,
  } satisfies CSSProperties,
} as const;

/** Node dot, tinted per column so the three layers read apart at a glance. */
export const nodeDot: Record<string, CSSProperties> = {
  symbol: { fill: "var(--text-primary)" },
  caller: { fill: "var(--info)" },
  endpoint: { fill: "var(--ok)" },
  cron: { fill: "var(--warn)" },
};

export const label: CSSProperties = {
  fontSize: 11,
  fill: "var(--text-secondary)",
};

export const labelPrimary: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  fill: "var(--text-primary)",
};

export const sublabel: CSSProperties = {
  fontSize: 9,
  fill: "var(--text-muted)",
};
