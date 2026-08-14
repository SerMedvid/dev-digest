/* The rail is fixed-width and scrolls on its own: the tour beside it is long,
   and a table of contents that scrolls away with the body is decoration. */
export const s = {
  toc: {
    width: 240,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "22px 16px",
    borderRight: "1px solid var(--border)",
    overflowY: "auto",
  } as const,
  label: {
    fontSize: 11,
    fontWeight: 650,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    margin: "0 0 10px 10px",
  } as const,
  item: (active: boolean) =>
    ({
      display: "block",
      width: "100%",
      textAlign: "left",
      background: "transparent",
      border: "none",
      borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
      padding: "7px 10px",
      fontSize: 13,
      lineHeight: 1.4,
      color: active ? "var(--text)" : "var(--text-muted)",
      cursor: "pointer",
      borderRadius: 0,
    }) as const,
};
