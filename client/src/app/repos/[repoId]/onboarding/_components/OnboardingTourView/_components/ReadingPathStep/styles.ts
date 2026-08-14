export const s = {
  step: { display: "flex", gap: 12, padding: "10px 2px" } as const,
  /* The number leads because the order IS the content here. */
  num: {
    width: 24,
    height: 24,
    flexShrink: 0,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    fontSize: 12,
    fontWeight: 650,
    color: "var(--accent)",
    background: "color-mix(in srgb, var(--accent) 16%, transparent)",
  } as const,
  body: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 } as const,
  path: { fontSize: 13 } as const,
  note: { fontSize: 13, color: "var(--text-muted)" } as const,
};
