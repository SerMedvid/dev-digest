import type { CSSProperties } from "react";

/**
 * Every container down the path-bearing chain carries `minWidth: 0`. A flex or
 * grid item defaults to `min-width: auto`, which refuses to shrink below its
 * content — and a file path is one long token with no break opportunity, since
 * browsers do not break at `/`. Without both the `minWidth: 0` chain and the
 * `overflowWrap` on the leaf, a deep path widens the whole card and spills past
 * its border.
 */
export const s = {
  block: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingBottom: 12,
    borderBottom: "1px solid var(--border)",
    minWidth: 0,
  } satisfies CSSProperties,
  /** A real <button>, restyled flat — the whole header is the hit area. */
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: 0,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    textAlign: "left",
    fontSize: 13,
    color: "var(--text-primary)",
    minWidth: 0,
  } satisfies CSSProperties,
  chevron: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  codeIcon: {
    color: "var(--accent)",
    flexShrink: 0,
  } satisfies CSSProperties,
  name: {
    fontWeight: 600,
    minWidth: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  kind: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /** Caller count sits at the far edge, as the comp draws it. */
  count: {
    marginLeft: "auto",
    fontSize: 11,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingLeft: 22,
    minWidth: 0,
  } satisfies CSSProperties,
  /** The declaration site. No "declared at" label — the return arrow says it,
      as the design draws it — so the row is the icon and the path alone. */
  declared: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "var(--text-muted)",
    minWidth: 0,
  } satisfies CSSProperties,
  /** Muted, like the arrow marking each caller: the declaration row is a
      sibling of those rows, not something that should pull the eye off them. */
  declaredIcon: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  /** The one leaf that actually holds a path. `anywhere` is the last-resort
      break: a path has no natural break opportunity, since browsers do not
      break at `/`. */
  fileRef: {
    minWidth: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  callerList: {
    margin: 0,
    padding: 0,
    // Preflight strips ul markers and this list wants none — the ↳ glyph is
    // what nests each row under its symbol.
    listStyleType: "none",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 0,
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    fontSize: 12,
    color: "var(--text-secondary)",
    minWidth: 0,
  } satisfies CSSProperties,
  branch: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  callerSymbol: {
    color: "var(--text-muted)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
    minWidth: 0,
  } satisfies CSSProperties,
  /** Blue, as the comp draws endpoint chips — `--info` is gray in this design
      system, so the accent pair is what actually matches. */
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    borderRadius: 5,
    padding: "2px 8px",
    fontSize: 11,
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    maxWidth: "100%",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  cronChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    borderRadius: 5,
    padding: "2px 8px",
    fontSize: 11,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    maxWidth: "100%",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
} as const;
