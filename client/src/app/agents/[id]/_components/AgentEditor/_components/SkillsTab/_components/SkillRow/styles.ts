import type { CSSProperties } from "react";

/** Co-located styles for one linkable skill row. */
export const s = {
  row: (linked: boolean, dragging: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    marginBottom: 8,
    borderRadius: 7,
    border: "1px solid " + (linked ? "var(--border-strong)" : "var(--border)"),
    background: linked ? "var(--bg-elevated)" : "var(--bg-surface)",
    opacity: dragging ? 0.6 : 1,
  }),
  handle: (draggable: boolean): CSSProperties => ({
    display: "inline-flex",
    color: "var(--text-muted)",
    cursor: draggable ? "grab" : "default",
    // Unlinked rows have no stored order, so their handle is a placeholder.
    visibility: draggable ? "visible" : "hidden",
    background: "none",
    border: "none",
    padding: 0,
  }),
  spacer: { flex: 1 } satisfies CSSProperties,
  typeChip: (color: string): CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    color,
    background: color + "1a",
    padding: "1px 8px",
    borderRadius: 4,
  }),
  open: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent)",
    textDecoration: "none",
  } satisfies CSSProperties,
} as const;
