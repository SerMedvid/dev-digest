/* ProjectContextView — the screen. Same 24/32 gutter and centred column as the
   conventions screen next door; AppFrame's <main> supplies no padding. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1100, margin: "0 auto" } as const,
  header: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 } as const,
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  } as const,
  title: { fontSize: 24, fontWeight: 650, margin: 0 } as const,
  subtitle: { fontSize: 13.5, color: "var(--text-muted)", margin: 0 } as const,
  omitted: { fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 10px" } as const,
  split: { display: "grid", gridTemplateColumns: "minmax(280px, 380px) 1fr", gap: 16 } as const,
  list: { display: "flex", flexDirection: "column", gap: 8 } as const,
  detail: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-card)",
    padding: 18,
    minHeight: 220,
  } as const,
  detailPath: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    margin: "0 0 12px",
    wordBreak: "break-all",
  } as const,
  detailPlaceholder: { fontSize: 13, color: "var(--text-muted)", margin: 0 } as const,
  /* Preflight strips the marker off a <ul>, so the roots list is a flex column
     of plain spans rather than a bare list (client/INSIGHTS.md, 2026-08-06). */
  roots: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginTop: 10,
    alignItems: "center",
  } as const,
  root: { fontSize: 12.5, color: "var(--text-muted)" } as const,
  footer: {
    marginTop: 18,
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
    fontSize: 12.5,
    color: "var(--text-muted)",
  } as const,
};
