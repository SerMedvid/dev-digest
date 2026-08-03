/* ConventionsView — the screen. */
export const s = {
  /* AppFrame's <main> has no padding — every screen supplies its own gutter.
     Same 24/32 rhythm and centred column as the agents and pulls lists. */
  page: { padding: "24px 32px 44px", maxWidth: 1100, margin: "0 auto" } as const,
  header: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 } as const,
  title: { fontSize: 24, fontWeight: 650, margin: 0 } as const,
  titleRepo: { color: "var(--accent)" } as const,
  subtitle: { fontSize: 13.5, color: "var(--text-muted)", margin: 0 } as const,
  list: { display: "flex", flexDirection: "column", gap: 14 } as const,
  failed: {
    padding: 14,
    borderRadius: 10,
    border: "1px solid var(--danger)",
    background: "var(--bg-card)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 16,
  } as const,
  failedTitle: { fontSize: 13, fontWeight: 600, margin: 0 } as const,
  failedBody: { fontSize: 12.5, color: "var(--text-muted)", margin: 0 } as const,
  reasons: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginTop: 10,
    alignItems: "center",
  } as const,
  reason: { fontSize: 12.5, color: "var(--text-muted)" } as const,
};
