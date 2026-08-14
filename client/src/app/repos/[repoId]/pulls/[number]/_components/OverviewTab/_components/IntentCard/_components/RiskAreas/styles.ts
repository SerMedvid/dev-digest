import type { CSSProperties } from "react";
import type { RiskLevel } from "@devdigest/shared";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  heading: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8, margin: 0, padding: 0 } satisfies CSSProperties,
  row: {
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-base)",
    listStyleType: "none",
  } satisfies CSSProperties,
  /** The whole header is the toggle, so the hit target is the row and not a
   *  12px chevron. `text-align: left` because a button centres by default. */
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "8px 10px",
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,
  dot: {
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: 999,
    flexShrink: 0,
    // Inherits the row's severity colour, so the dot needs no per-level variant.
    background: "currentColor",
  } satisfies CSSProperties,
  title: { flex: 1, minWidth: 0, color: "var(--text-primary)" } satisfies CSSProperties,
  body: {
    padding: "0 10px 10px 28px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  explanation: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  refs: { display: "flex", flexWrap: "wrap", gap: 6 } satisfies CSSProperties,
  /** Monospace because every entry is a path or a `METHOD /route`. */
  ref: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 11,
    padding: "1px 6px",
    borderRadius: 4,
    background: "var(--bg-elevated)",
    color: "var(--text-secondary)",
    wordBreak: "break-all",
  } satisfies CSSProperties,
} as const;

/**
 * The severity tint, worn by the row's dot and its title.
 *
 * Colour is never the only carrier: the severity is also announced to assistive
 * technology on the toggle, for the same WCAG reason the intent card spells its
 * confidence out.
 */
export const severityColor: Record<RiskLevel, string> = {
  high: "var(--crit)",
  medium: "var(--warn)",
  low: "var(--info)",
};
