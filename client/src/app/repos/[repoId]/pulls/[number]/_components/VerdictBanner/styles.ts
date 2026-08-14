import type { CSSProperties } from "react";

/** Co-located styles for VerdictBanner (extracted from inline styles). */
export const s = {
  wrap: {
    display: "flex",
    gap: 18,
    alignItems: "flex-start",
    padding: 18,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  iconBox: (bg: string, color: string): CSSProperties => ({
    width: 40,
    height: 40,
    borderRadius: 9,
    display: "grid",
    placeItems: "center",
    background: bg,
    color,
    flexShrink: 0,
  }),
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  label: (color: string): CSSProperties => ({ fontSize: 18, fontWeight: 700, color }),
  summary: {
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
    marginTop: 8,
  } satisfies CSSProperties,
  scoreCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
    // The spend badge can sit under the label (`spendPlacement="score"`), and
    // its detailed form is wider than the 52px dial — without this the column
    // wraps the token flow onto its own line and the dial goes off-centre.
    minWidth: 52,
  } satisfies CSSProperties,
  scoreLabel: {
    fontSize: 12,
    color: "var(--text-muted)",
    letterSpacing: "0.04em",
  } satisfies CSSProperties,
} as const;
