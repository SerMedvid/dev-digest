/* ConventionCard — one candidate and its evidence. */
import type React from "react";

export const s = {
  card: (status: string): React.CSSProperties => ({
    display: "flex",
    gap: 16,
    padding: 16,
    borderRadius: 10,
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${
      status === "accepted" ? "var(--ok)" : status === "rejected" ? "var(--border)" : "var(--warn)"
    }`,
    background: "var(--bg-card)",
    opacity: status === "rejected" ? 0.55 : 1,
  }),
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 } as const,
  ruleRow: { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" } as const,
  rule: { fontSize: 14, fontWeight: 600, fontStyle: "italic", margin: 0 } as const,
  category: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "var(--text-muted)",
  } as const,
  evidence: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    overflow: "hidden",
  } as const,
  evidenceHead: {
    display: "flex",
    justifyContent: "space-between",
    padding: "6px 10px",
    fontSize: 12,
    color: "var(--text-muted)",
    background: "var(--bg-hover)",
  } as const,
  snippet: {
    margin: 0,
    padding: "10px 12px",
    fontSize: 12.5,
    overflowX: "auto",
    whiteSpace: "pre",
  } as const,
  confidenceRow: { display: "flex", alignItems: "center", gap: 10 } as const,
  confidenceLabel: { fontSize: 12, color: "var(--text-muted)" } as const,
  confidenceBar: { width: 140 } as const,
  actions: { display: "flex", flexDirection: "column", gap: 8, width: 150 } as const,
  editFields: { display: "flex", flexDirection: "column", gap: 10 } as const,
  editRow: { display: "flex", gap: 10 } as const,
  error: { fontSize: 12, color: "var(--danger)" } as const,
};
