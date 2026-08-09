import type { CSSProperties } from "react";

/**
 * Inline `CSSProperties`, matching every neighbour under
 * `pulls/[number]/_components/` (INSIGHTS 2026-08-06) rather than the
 * Tailwind-in-`styles.ts` rule `CLAUDE.md` states — a Tailwind card here would
 * read as foreign next to `IntentCard`.
 */
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "18px 20px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 18,
  } satisfies CSSProperties,
  /** Header counters: symbols / callers / endpoints / crons. */
  counters: {
    display: "flex",
    flexWrap: "wrap",
    gap: 18,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  counterValue: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--text-primary)",
    marginRight: 6,
  } satisfies CSSProperties,
  tree: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
  symbolBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  symbolHeader: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 8,
    fontSize: 13,
  } satisfies CSSProperties,
  symbolName: {
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  symbolKind: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  callerList: {
    margin: 0,
    // Preflight strips `ul` markers and this list wants none — the indent is
    // what nests it under its symbol (INSIGHTS 2026-08-06).
    padding: "0 0 0 14px",
    listStyleType: "none",
    borderLeft: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 8,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  callerSymbol: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
    paddingLeft: 14,
  } satisfies CSSProperties,
  chip: {
    borderRadius: 5,
    padding: "2px 8px",
    fontSize: 11,
    color: "var(--info)",
    background: "var(--info-bg)",
  } satisfies CSSProperties,
  cronChip: {
    borderRadius: 5,
    padding: "2px 8px",
    fontSize: 11,
    color: "var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  warning: {
    margin: 0,
    fontSize: 12,
    color: "var(--warn)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  /** The degraded block — an explanation, never an empty tree. */
  degraded: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  degradedTitle: {
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  degradedBody: {
    margin: 0,
    fontSize: 12,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
  } satisfies CSSProperties,
  emptyNote: {
    margin: 0,
    fontSize: 13,
    fontStyle: "italic",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  summaryTitle: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  summary: {
    margin: 0,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
  /** Tree | Graph toggle (Task 10 renders the graph behind it). */
  viewToggle: {
    display: "flex",
    gap: 4,
  } satisfies CSSProperties,
} as const;

/** The toggle's two buttons, pressed and not. */
export const toggleButton = (pressed: boolean): CSSProperties => ({
  borderRadius: 5,
  border: "1px solid var(--border)",
  padding: "2px 10px",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  cursor: "pointer",
  color: pressed ? "var(--text-primary)" : "var(--text-muted)",
  background: pressed ? "var(--bg-subtle)" : "transparent",
});
