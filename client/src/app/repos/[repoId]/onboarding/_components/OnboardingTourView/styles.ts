/* OnboardingTourView — a reading screen, not a dashboard.

   Two columns under AppShell's 52px bar: a narrow sticky "on this page" rail
   that never scrolls away, and the tour itself in a measured column beside it.
   The tour is prose plus lists, so the body column is capped rather than
   stretched — a 200-character line of explanation is unreadable at 2560px, and
   this screen is read once, carefully, by someone who has never seen the repo. */
export const s = {
  page: {
    display: "flex",
    height: "calc(100vh - 52px)",
    minHeight: 0,
    overflow: "hidden",
  } as const,

  /* ---- left: the table of contents ---- */
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
  tocLabel: {
    fontSize: 11,
    fontWeight: 650,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    margin: "0 0 10px 10px",
  } as const,
  tocItem: (active: boolean) =>
    ({
      display: "block",
      width: "100%",
      textAlign: "left",
      background: "transparent",
      border: "none",
      borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
      padding: "7px 10px",
      fontSize: 13,
      color: active ? "var(--text)" : "var(--text-muted)",
      cursor: "pointer",
      borderRadius: 0,
    }) as const,

  /* ---- right: the tour ---- */
  main: { flex: 1, minWidth: 0, overflowY: "auto" } as const,
  column: { maxWidth: 880, margin: "0 auto", padding: "28px 32px 64px" } as const,

  head: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 6,
  } as const,
  title: { fontSize: 26, fontWeight: 680, margin: 0, letterSpacing: "-0.01em" } as const,
  titleRepo: { fontFamily: "var(--font-mono)", color: "var(--accent)" } as const,
  headActions: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 } as const,
  subtitle: { fontSize: 13, color: "var(--text-muted)", margin: "0 0 4px" } as const,
  staleRow: { margin: "10px 0 0" } as const,

  /* ---- a section card ---- */
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--surface)",
    marginTop: 18,
    overflow: "hidden",
  } as const,
  cardHead: {
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
  cardTitle: { fontSize: 15, fontWeight: 650, margin: 0, flex: 1, textAlign: "left" } as const,
  chevron: (open: boolean) =>
    ({
      color: "var(--text-muted)",
      transform: open ? "rotate(180deg)" : "none",
      transition: "transform 120ms ease",
      display: "inline-flex",
    }) as const,
  cardBody: { padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 8 } as const,
  emptyNote: { fontSize: 13, color: "var(--text-muted)", margin: "4px 0 8px" } as const,

  /* ---- rows ---- */
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    background: "var(--surface-2, rgba(255,255,255,0.02))",
    border: "1px solid var(--border)",
  } as const,
  rowPath: { fontFamily: "var(--font-mono)", fontSize: 13 } as const,
  rowNote: { fontSize: 13, color: "var(--text-muted)", flex: 1, minWidth: 0 } as const,

  /* Commands read as a terminal transcript, so they are monospace on a darker
     ground with the step number in the gutter — the reference design's shape. */
  cmdRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 8,
    background: "var(--bg, rgba(0,0,0,0.25))",
    border: "1px solid var(--border)",
  } as const,
  cmdIndex: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--text-muted)",
    width: 14,
    flexShrink: 0,
  } as const,
  cmdText: { fontFamily: "var(--font-mono)", fontSize: 13, whiteSpace: "pre-wrap" } as const,
  cmdComment: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-muted)" } as const,
  cmdSpacer: { flex: 1 } as const,

  /* Reading path is an ordered walk: the number is the point, so it leads. */
  step: { display: "flex", gap: 12, padding: "10px 2px" } as const,
  stepNum: {
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
  stepBody: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 } as const,

  task: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
  } as const,
  taskTitle: { fontSize: 14, fontWeight: 600, margin: 0 } as const,
  taskBody: { fontSize: 13, color: "var(--text-muted)", margin: 0 } as const,

  diagram: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg, rgba(0,0,0,0.2))",
    overflowX: "auto",
  } as const,

  /* ---- states ---- */
  centred: {
    display: "grid",
    placeItems: "center",
    minHeight: 320,
    padding: 32,
  } as const,
  gate: { maxWidth: 520, textAlign: "center", display: "grid", gap: 12, justifyItems: "center" } as const,
  gateTitle: { fontSize: 18, fontWeight: 650, margin: 0 } as const,
  gateBody: { fontSize: 14, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 } as const,
  errorText: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--danger, #f87171)" } as const,
};
