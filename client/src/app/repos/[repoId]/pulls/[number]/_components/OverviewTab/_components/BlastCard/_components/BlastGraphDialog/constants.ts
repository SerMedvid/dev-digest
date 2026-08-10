/** Wide enough for the 1120-unit viewBox to render near 1:1. */
export const DIALOG_WIDTH = 1180;

/** The legend's four rows. The colours must stay in step with `nodeDot` in
    `../BlastGraph/styles.ts` — a legend that disagrees with the diagram is
    worse than no legend. */
export const LEGEND = [
  { key: "symbol", color: "var(--accent)" },
  { key: "caller", color: "var(--text-muted)" },
  { key: "endpoint", color: "var(--ok)" },
  { key: "cron", color: "var(--warn)" },
] as const;
