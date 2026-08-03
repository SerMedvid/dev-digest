/* ScanHeader — the scan's provenance line and the Re-scan control. */
export const s = {
  row: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  } as const,
  meta: { fontSize: 13, color: "var(--text-muted)", margin: 0 } as const,
  model: { fontSize: 12, color: "var(--text-muted)" } as const,
  confirm: {
    marginTop: 12,
    padding: 14,
    borderRadius: 10,
    border: "1px solid var(--warn)",
    background: "var(--bg-card)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } as const,
  confirmTitle: { fontSize: 13, fontWeight: 600, margin: 0 } as const,
  confirmBody: { fontSize: 13, color: "var(--text-muted)", margin: 0 } as const,
  confirmActions: { display: "flex", gap: 8 } as const,
};
