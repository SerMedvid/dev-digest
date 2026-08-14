import type { CSSProperties } from "react";
import type { IconName } from "@devdigest/ui";
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
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: 0,
    padding: 0,
  } satisfies CSSProperties,
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
    alignItems: "flex-start",
    gap: 8,
    width: "100%",
    padding: "8px 10px",
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
  } satisfies CSSProperties,
  /** Title and refs stack; the icon and chevron flank them. */
  rowMain: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  title: { fontSize: 13, color: "var(--text-primary)" } satisfies CSSProperties,
  /** Refs are visible while collapsed — they are the row's evidence, and a
   *  risk whose references are hidden is a claim the reader cannot check. */
  refs: { display: "flex", flexWrap: "wrap", gap: 8 } satisfies CSSProperties,
  /** Monospace because every entry is a path or a `METHOD /route`. */
  ref: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 11,
    color: "var(--accent-text, var(--text-secondary))",
    wordBreak: "break-all",
  } satisfies CSSProperties,
  body: {
    padding: "0 10px 10px 32px",
  } satisfies CSSProperties,
  explanation: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  chevron: { flexShrink: 0, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
} as const;

/**
 * Severity is carried by icon **shape** as well as colour, so it is never
 * colour alone — the design system's WCAG rule. The level is also on the
 * toggle's `aria-label`, which is what a screen reader announces; the mockup
 * has no visible severity text and this keeps it accessible without adding one.
 */
export const severityIcon: Record<RiskLevel, { icon: IconName; color: string }> = {
  high: { icon: "AlertOctagon", color: "var(--crit)" },
  medium: { icon: "AlertTriangle", color: "var(--warn)" },
  low: { icon: "Info", color: "var(--info)" },
};
