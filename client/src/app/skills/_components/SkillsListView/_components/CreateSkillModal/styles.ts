import type { CSSProperties } from "react";

/** Co-located styles for CreateSkillModal. */
export const s = {
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  } satisfies CSSProperties,
  fileInput: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  counter: (over: boolean): CSSProperties => ({
    fontSize: 12,
    color: over ? "var(--crit)" : "var(--text-muted)",
  }),
  error: {
    fontSize: 13,
    color: "var(--crit)",
    marginTop: 10,
  } satisfies CSSProperties,
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
  } satisfies CSSProperties,
} as const;
