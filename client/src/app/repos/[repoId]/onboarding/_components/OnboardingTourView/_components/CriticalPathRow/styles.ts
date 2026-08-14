export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--surface-2, rgba(255,255,255,0.02))",
  } as const,
  icon: { color: "var(--text-muted)", flexShrink: 0 } as const,
  path: { fontSize: 13, flexShrink: 0 } as const,
  /* The note is the flexible half: a long role description truncates before the
     path does, because the path is what the reader will go and open. */
  note: {
    fontSize: 13,
    color: "var(--text-muted)",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } as const,
  spacer: { flex: 1 } as const,
  open: {
    flexShrink: 0,
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text)",
    cursor: "pointer",
  } as const,
};
