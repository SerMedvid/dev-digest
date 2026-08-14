export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--surface)",
    marginTop: 18,
    overflow: "hidden",
  } as const,
  head: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "14px 16px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "var(--text)",
  } as const,
  glyph: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    borderRadius: 8,
    color: "var(--accent)",
    background: "color-mix(in srgb, var(--accent) 14%, transparent)",
    flexShrink: 0,
  } as const,
  title: { fontSize: 15, fontWeight: 650, margin: 0, flex: 1, textAlign: "left" } as const,
  chevron: (open: boolean) =>
    ({
      display: "inline-flex",
      color: "var(--text-muted)",
      transform: open ? "rotate(180deg)" : "none",
      transition: "transform 120ms ease",
    }) as const,
  body: {
    padding: "0 16px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } as const,
  empty: { fontSize: 13, color: "var(--text-muted)", margin: "2px 0 6px" } as const,
  /* The diagram scrolls sideways rather than shrinking: a squeezed flowchart is
     unreadable, and this column is already capped. */
  diagram: {
    marginTop: 4,
    padding: 12,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg, rgba(0,0,0,0.2))",
    overflowX: "auto",
  } as const,
};
