/* CreateConventionSkillModal. The vendored Modal gives its body ZERO padding —
   the 24px gutter has to come from here (see client/INSIGHTS.md). */
export const s = {
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 16 } as const,
  banner: {
    display: "flex",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-hover)",
    fontSize: 13,
  } as const,
  twoUp: { display: "flex", gap: 16, alignItems: "flex-start" } as const,
  toggleWrap: { display: "flex", flexDirection: "column", gap: 6 } as const,
  toggleHint: { fontSize: 12, color: "var(--text-muted)" } as const,
  bodyHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    fontSize: 12,
    color: "var(--text-muted)",
  } as const,
  unsaved: {
    fontSize: 11,
    padding: "1px 6px",
    borderRadius: 4,
    background: "var(--bg-hover)",
    color: "var(--text-muted)",
  } as const,
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  } as const,
  footerNote: { fontSize: 12, color: "var(--text-muted)" } as const,
  footerActions: { display: "flex", gap: 8 } as const,
  error: { fontSize: 12, color: "var(--danger)" } as const,
};
