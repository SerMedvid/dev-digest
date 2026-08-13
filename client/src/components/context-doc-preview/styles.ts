/* context-doc-preview — the shared read-only document surface. */
export const s = {
  /* Modal gives its body zero padding while padding its own header and footer,
     so every feature has to restate the 24px gutter (client/INSIGHTS.md). */
  modalBody: { padding: 24 } as const,
  body: { fontSize: 13.5, color: "var(--text-secondary)" } as const,
  truncated: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 12px",
    margin: "0 0 12px",
  } as const,
};
