import type { CSSProperties } from "react";

/** Co-located styles for the agent editor's Context tab. */
export const s = {
  pane: { padding: 24, maxWidth: 820 } satisfies CSSProperties,
  headRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  heading: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  badge: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    background: "var(--bg-inset, rgba(127,127,127,0.12))",
    padding: "1px 8px",
    borderRadius: 4,
  } satisfies CSSProperties,
  direct: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  hint: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: "6px 0 16px",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  filter: { marginBottom: 14 } satisfies CSSProperties,
  notice: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginBottom: 12,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  footer: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 14,
    lineHeight: 1.6,
  } satisfies CSSProperties,
  footerNote: { color: "var(--text-secondary)" } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)", marginTop: 12 } satisfies CSSProperties,
} as const;
