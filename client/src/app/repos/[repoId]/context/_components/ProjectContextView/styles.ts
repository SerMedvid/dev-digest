/* ProjectContextView — a two-pane file browser, not a page of cards.

   The screen fills the viewport under AppShell's 52px bar, the way the agent
   and skill editors do: a fixed-width file column that scrolls on its own, and
   a reading pane beside it that scrolls on its own. A centred column of wide
   cards made a 60-character path the widest thing on screen and pushed the
   document being read below the fold. */
export const s = {
  page: { display: "flex", height: "calc(100vh - 52px)", minHeight: 0 } as const,

  /* ---- left: the file column ---- */
  side: {
    width: 300,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderRight: "1px solid var(--border)",
  } as const,
  sideHead: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "14px 16px 12px",
  } as const,
  eyebrow: {
    fontSize: 11,
    fontWeight: 650,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    margin: 0,
  } as const,
  /* The configured roots, in the comp's position — it prints one folder there
     because its mock has one. Ours are configurable and there are usually
     several, so they are joined rather than assumed singular. */
  roots: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    fontSize: 12,
    color: "var(--text-secondary)",
  } as const,
  root: { fontSize: 12 } as const,
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "0 10px 10px",
  } as const,
  list: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: "6px 8px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 1,
  } as const,
  sideFoot: {
    padding: "10px 16px",
    borderTop: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
  } as const,
  omitted: { fontSize: 12, color: "var(--text-muted)", margin: "0 0 6px", padding: "0 8px" } as const,

  /* ---- right: the reading pane ---- */
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 } as const,
  mainHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "13px 24px",
    borderBottom: "1px solid var(--border)",
    minHeight: 48,
  } as const,
  mainPath: { fontSize: 14, fontWeight: 600, margin: 0, wordBreak: "break-all" } as const,
  usedBy: { fontSize: 12.5, color: "var(--text-muted)", whiteSpace: "nowrap" } as const,
  body: { flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px 48px" } as const,
  /* Centres the placeholder and the two explanation states in the reading pane,
     which is otherwise top-aligned. */
  bodyCentred: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: "20px 24px 48px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } as const,
  placeholder: { fontSize: 13, color: "var(--text-muted)", margin: 0 } as const,

  /* Preflight strips the marker off a <ul>, so the roots list in the empty
     state is a flex column of plain spans (client/INSIGHTS.md, 2026-08-06). */
  emptyRoots: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginTop: 10,
    alignItems: "center",
  } as const,
  emptyRoot: { fontSize: 12.5, color: "var(--text-muted)" } as const,
};
