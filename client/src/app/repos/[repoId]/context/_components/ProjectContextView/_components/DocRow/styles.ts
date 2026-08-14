/* DocRow — one line in the file column. Deliberately compact: this is a file
   list, so a row is one line high and the reading pane gets the space. */
const base = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  textAlign: "left",
  padding: "5px 8px",
  borderRadius: 6,
  border: "1px solid transparent",
  background: "transparent",
  cursor: "pointer",
} as const;

export const s = {
  row: base,
  rowSelected: {
    ...base,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } as const,
  icon: { flexShrink: 0, color: "var(--text-muted)", display: "flex" } as const,
  /* The name and its folder share one ellipsis budget: the name is what the
     user reads, so the folder gives up its space first. */
  label: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    overflow: "hidden",
  } as const,
  name: {
    fontSize: 12.5,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flexShrink: 0,
    maxWidth: "100%",
  } as const,
  dir: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0,
  } as const,
  /* Stays on the row rather than moving to the reading pane's header: watching
     this number go 0 → 1 → 2 while attaching in another tab is the point. */
  used: { fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", flexShrink: 0 } as const,
};
