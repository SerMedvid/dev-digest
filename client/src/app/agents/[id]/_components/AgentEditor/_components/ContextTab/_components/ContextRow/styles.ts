import type { CSSProperties } from "react";

/* Only what the agent adapter itself draws. The row's own chrome lives with the
   shared `AttachmentRow`; these two style the `notes` slot this editor passes
   in — the "inherited from" caption and the link to the skill carrying it. */
export const s = {
  note: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  link: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent)",
    textDecoration: "none",
  } satisfies CSSProperties,
} as const;
