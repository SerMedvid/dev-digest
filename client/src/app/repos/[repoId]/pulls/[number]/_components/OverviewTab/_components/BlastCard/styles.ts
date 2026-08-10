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
  tree: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
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
} as const;
