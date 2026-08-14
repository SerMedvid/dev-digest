import type { CSSProperties } from "react";

export const s = {
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: 0,
    padding: 0,
    listStyleType: "none",
  } satisfies CSSProperties,
  row: {
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  /** The whole row is the target, so the hit area is the row and not the path. */
  button: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    width: "100%",
    padding: "10px 12px",
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
  } satisfies CSSProperties,
  /** A file the current diff does not render is not clickable — see the
   *  component. Same padding, so the list does not visibly jump. */
  staticRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    width: "100%",
    padding: "10px 12px",
  } satisfies CSSProperties,
  ordinal: {
    fontSize: 12,
    color: "var(--text-muted)",
    minWidth: 16,
    flexShrink: 0,
  } satisfies CSSProperties,
  path: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 13,
    color: "var(--accent-text, var(--text-primary))",
    wordBreak: "break-all",
    flexShrink: 0,
  } satisfies CSSProperties,
  pathPlain: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 13,
    color: "var(--text-secondary)",
    wordBreak: "break-all",
    flexShrink: 0,
  } satisfies CSSProperties,
  reason: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
} as const;
