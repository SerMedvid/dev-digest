import type { CSSProperties } from "react";

/** Co-located styles for the skill Config tab. */
export const s = {
  pane: { padding: 28, maxWidth: 820 } satisfies CSSProperties,
  headRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  } satisfies CSSProperties,
  heading: { fontSize: 15, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  unsaved: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    padding: "2px 8px",
    borderRadius: 4,
  } satisfies CSSProperties,
  enabledRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  } satisfies CSSProperties,
  enabledLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  counter: (over: boolean): CSSProperties => ({
    fontSize: 12,
    color: over ? "var(--crit)" : "var(--text-muted)",
  }),
  error: { fontSize: 13, color: "var(--crit)", marginTop: 12 } satisfies CSSProperties,
  actions: { display: "flex", justifyContent: "flex-end", marginTop: 8 } satisfies CSSProperties,
} as const;
