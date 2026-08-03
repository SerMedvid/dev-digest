/* SelectionBar — the accepted count and the path to a skill. */
export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 0",
  } as const,
  left: { display: "flex", alignItems: "center", gap: 12 } as const,
  count: { fontSize: 13, color: "var(--text-muted)" } as const,
};
