import type { CSSProperties } from "react";

/** The two path variants differ only in colour; the layout lives in `pathBase`. */
export const pathColor = {
  linked: "var(--accent-text, var(--text-primary))",
  plain: "var(--text-secondary)",
} as const;

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
  /**
   * Paths in this repo are long enough to starve the reason beside them —
   * `_components/OverviewTab/_components/ReviewFocus/ReviewFocus.tsx` is a real
   * entry. `flexShrink: 0` let the path claim whatever width it wanted and
   * pushed the reason into a three-line ragged column, so the path is capped
   * and wraps instead.
   *
   * `break-all` rather than `break-word`: a path is one unbroken token to the
   * line breaker, so word-level breaking has nothing to work with and the cap
   * would just overflow.
   */
  pathBase: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 13,
    // Grow not at all, shrink freely, and never past the cap — which is a
    // percentage so the split holds at any container width.
    flex: "0 1 auto",
    maxWidth: "48%",
    minWidth: 0,
    wordBreak: "break-all",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  reason: {
    // Takes the remainder, and `minWidth: 0` is what lets it actually shrink
    // inside a flex row rather than being floored at its longest word.
    flex: "1 1 0",
    minWidth: 0,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
} as const;
