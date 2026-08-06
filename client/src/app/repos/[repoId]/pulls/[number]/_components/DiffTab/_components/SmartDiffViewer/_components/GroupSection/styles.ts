import type { CSSProperties } from "react";
import type { Severity } from "@devdigest/shared";
import { SEVERITY_COLOR } from "@/components/diff-viewer";

export const s = {
  group: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  heading: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  /** The role's colour chip, the one thing distinguishing the three headings
      at a glance once the label is no longer shouted in caps. */
  dot: {
    width: 8,
    height: 8,
    borderRadius: 2,
    flexShrink: 0,
  } satisfies CSSProperties,
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  desc: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  /** Pushed hard right, opposite the label it counts. */
  count: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  headerExtra: { display: "inline-flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  /* The model-written sentence, tinted so it reads as a distinct layer over
     the diff rather than as one more line of it — the same accent the pill
     that produced it wears. */
  preBody: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    padding: "10px 14px",
    fontSize: 12.5,
    color: "var(--text-secondary)",
    background: "var(--accent-bg)",
    borderBottom: "1px solid var(--border)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  /* A flex item, not an inline glyph: Tailwind's preflight makes every `svg`
     `display: block`, so an icon dropped into running text takes a line of its
     own. `marginTop` sits it on the first line's baseline. */
  preBodyIcon: {
    color: "var(--accent-text)",
    flexShrink: 0,
    marginTop: 3,
  } satisfies CSSProperties,
  preBodyLabel: { color: "var(--accent-text)", fontWeight: 600 } satisfies CSSProperties,
} as const;

/**
 * A file's finding marker: a dot beside its path, coloured by the worst
 * severity on it and sharing `SEVERITY_COLOR` with the line chip it scrolls
 * to, so the header and the line can never disagree about how bad the file is.
 */
export function findingDotFor(severity: Severity): CSSProperties {
  return {
    width: 8,
    height: 8,
    padding: 0,
    borderRadius: "50%",
    border: "none",
    background: SEVERITY_COLOR[severity],
    cursor: "pointer",
    flexShrink: 0,
  };
}
