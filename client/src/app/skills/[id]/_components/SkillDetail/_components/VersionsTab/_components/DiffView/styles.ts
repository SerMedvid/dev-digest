import type { CSSProperties } from "react";

/** Co-located styles for the unified diff. */
export const s = {
  // Scrolls on its own rather than widening the detail pane.
  frame: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    background: "var(--bg-surface)",
    overflowX: "auto",
    padding: "8px 0",
    marginTop: 10,
  } satisfies CSSProperties,
  row: (kind: "add" | "del" | "ctx"): CSSProperties => ({
    display: "block",
    whiteSpace: "pre",
    fontSize: 12,
    lineHeight: 1.6,
    padding: "0 12px",
    color:
      kind === "add" ? "var(--ok)" : kind === "del" ? "var(--crit)" : "var(--text-muted)",
    background:
      kind === "add" ? "var(--ok-bg)" : kind === "del" ? "var(--crit-bg)" : "transparent",
  }),
} as const;
