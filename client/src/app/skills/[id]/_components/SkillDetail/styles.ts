import type { CSSProperties } from "react";

/** Co-located styles for the skill detail pane header. */
export const s = {
  pane: { display: "flex", flexDirection: "column", height: "100%" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "18px 28px 14px",
  } satisfies CSSProperties,
  iconBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  name: { fontSize: 17, fontWeight: 700 } satisfies CSSProperties,
  typeChip: (color: string): CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    color,
    background: color + "1a",
    padding: "1px 8px",
    borderRadius: 4,
  }),
  body: { flex: 1, overflow: "auto" } satisfies CSSProperties,
} as const;
