export const s = {
  task: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 12,
    borderRadius: 8,
    border: "1px solid var(--border)",
  } as const,
  title: { fontSize: 14, fontWeight: 600, margin: 0 } as const,
  body: { fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.55 } as const,
  /* The cited path is the grounding: a task that names no real file was dropped
     server-side, so every card here can show one. */
  path: { fontSize: 12, color: "var(--text-muted)", alignSelf: "flex-start" } as const,
};
