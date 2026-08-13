import type { CSSProperties } from "react";

/* Co-located styles for one project-context row in the skill editor.

   These values are *matched* to the agent editor's `ContextRow`
   (`app/agents/[id]/.../ContextTab/_components/ContextRow/styles.ts`), not
   forked from it: the same object rendered in two editors should not look like
   two objects. They are duplicated rather than imported because a cross-route
   import into another route's `_components/` is the one thing the folder
   convention rules out. If a third consumer appears, promote a shared row to
   `src/components/` instead of adding a third copy. */
export const s = {
  row: (attached: boolean, inactive: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    marginBottom: 8,
    borderRadius: 7,
    border: "1px solid " + (attached ? "var(--border-strong)" : "var(--border)"),
    background: attached ? "var(--bg-elevated)" : "var(--bg-surface)",
    // A row owned by another repository is dimmed as well as disabled — the
    // dimming is the decoration, the label beside it carries the meaning.
    opacity: inactive ? 0.6 : 1,
  }),
  label: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
    cursor: "pointer",
    minWidth: 0,
  } satisfies CSSProperties,
  path: { color: "var(--text-primary)", fontSize: 13 } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  // The root segment is carried by this chip's *text*; the tint is decoration
  // only (AC-53).
  rootChip: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    background: "var(--bg-inset, rgba(127,127,127,0.12))",
    padding: "1px 8px",
    borderRadius: 4,
  } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  missing: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--warn, var(--crit))",
  } satisfies CSSProperties,
  // Stored and attached, but past the per-run cap: nothing is wrong with the
  // document, it is simply not injected. The text beside it carries that; this
  // is only emphasis (AC-53).
  beyondCap: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--warn, var(--text-muted))",
  } satisfies CSSProperties,
  preview: {
    display: "inline-flex",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent)",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
  } satisfies CSSProperties,
} as const;
