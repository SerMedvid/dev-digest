import type { CSSProperties } from "react";

/**
 * Co-located styles for CreateSkillModal.
 *
 * The vendored `Modal` pads its own header and footer with `24px` horizontally
 * and gives the body none, so every gutter here is that same 24 — the tab row
 * included, which is why `tabsPad` overrides the `Tabs` default of `0 28px`.
 */
export const s = {
  body: { padding: 24 } satisfies CSSProperties,
  tabsPad: "0 24px",
  dropzone: (state: { hasFile: boolean; over: boolean; focused: boolean }): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "16px 16px",
    borderRadius: 8,
    border: `1px dashed var(${state.over || state.hasFile ? "--accent" : "--border-strong"})`,
    background: "var(--bg-elevated)",
    color: "var(--text-secondary)",
    fontSize: 13,
    cursor: "pointer",
    outline: state.focused ? "2px solid var(--accent)" : "none",
    outlineOffset: 2,
  }),
  dropzoneText: { flex: 1 } satisfies CSSProperties,
  dropzoneFileName: { color: "var(--text-primary)", fontWeight: 600 } satisfies CSSProperties,
  dropzoneAction: { color: "var(--accent)", fontWeight: 600 } satisfies CSSProperties,
  /** Visually hidden but still focusable, so the label stays a real control. */
  hiddenFileInput: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: "none",
  } satisfies CSSProperties,
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
