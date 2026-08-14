/* A terminal transcript, not a form: monospace on a darker ground with the step
   number in the gutter, the way the reference design draws it. */
export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg, rgba(0,0,0,0.25))",
  } as const,
  index: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--text-muted)",
    width: 14,
    flexShrink: 0,
  } as const,
  text: {
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    whiteSpace: "pre-wrap",
    flexShrink: 0,
  } as const,
  hash: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-muted)" } as const,
  comment: {
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    color: "var(--text-muted)",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } as const,
  spacer: { flex: 1 } as const,
  copy: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    padding: 6,
    borderRadius: 6,
    border: "none",
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
  } as const,
};
