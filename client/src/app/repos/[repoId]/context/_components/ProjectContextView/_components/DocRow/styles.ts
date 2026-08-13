/* DocRow — one discovered document in the list column. */
const base = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 6,
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-card)",
  cursor: "pointer",
} as const;

export const s = {
  row: base,
  rowSelected: {
    ...base,
    border: "1px solid var(--accent)",
    background: "var(--accent-bg)",
  } as const,
  path: { fontSize: 12.5, color: "var(--text-primary)", wordBreak: "break-all" } as const,
  meta: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    fontSize: 12,
    color: "var(--text-muted)",
  } as const,
  /* The root is conveyed as text, never by colour alone (AC-53). */
  root: {
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: "0.02em",
    color: "var(--text-secondary)",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 999,
    padding: "1px 8px",
  } as const,
  used: { fontSize: 12 } as const,
};
