import type { CSSProperties } from "react";

/* Shaped like the `Badge` primitive the agents page uses — tinted fill, no
   outline, 5px radius — rather than an outlined pill of its own. It is a
   button, so it can't literally be a `Badge`, but it must not read as a
   different species of chip. Accent-tinted because the action it offers is the
   one model call on this tab; a neutral grey read as decoration. */
export const s = {
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.4,
    letterSpacing: "0.01em",
    padding: "2px 10px",
    borderRadius: 5,
    border: "none",
    background: "var(--accent-bg)",
    color: "var(--accent-text)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;
