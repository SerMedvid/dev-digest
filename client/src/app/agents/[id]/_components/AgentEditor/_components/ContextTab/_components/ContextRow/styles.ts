import type { CSSProperties } from "react";

/** Co-located styles for one project-context document row. */
export const s = {
  row: (attached: boolean, inactive: boolean, dragging: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    marginBottom: 8,
    borderRadius: 7,
    border: "1px solid " + (attached ? "var(--border-strong)" : "var(--border)"),
    background: attached ? "var(--bg-elevated)" : "var(--bg-surface)",
    opacity: dragging ? 0.6 : inactive ? 0.6 : 1,
  }),
  handle: {
    display: "inline-flex",
    color: "var(--text-muted)",
    cursor: "grab",
    background: "none",
    border: "none",
    padding: 0,
  } satisfies CSSProperties,
  // Unattached rows have no stored order, so their handle column is a spacer
  // that keeps every path on the same left edge.
  handleGap: { display: "inline-block", width: 14 } satisfies CSSProperties,
  label: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
    cursor: "pointer",
    minWidth: 0,
  } satisfies CSSProperties,
  path: { color: "var(--text-primary)", fontSize: 13 } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  // The root segment is carried by this chip's *text*; the tint is decoration
  // only (AC-53).
  rootChip: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    background: "var(--bg-inset, rgba(127,127,127,0.12))",
    padding: "1px 8px",
    borderRadius: 4,
  } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  missing: { fontSize: 12, fontWeight: 600, color: "var(--warn, var(--crit))" } satisfies CSSProperties,
  // Stored and effective, but past the per-run cap: nothing is wrong with the
  // document, it is simply not injected. The text beside it carries that; this
  // is only emphasis (AC-53).
  beyondCap: { fontSize: 12, fontWeight: 600, color: "var(--warn, var(--text-muted))" } satisfies CSSProperties,
  link: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent)",
    textDecoration: "none",
  } satisfies CSSProperties,
  preview: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent)",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
  } satisfies CSSProperties,
} as const;
