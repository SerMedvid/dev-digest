import type { CSSProperties } from "react";

/* Only what the skill adapter itself draws. The row's own chrome lives with the
   shared `AttachmentRow`; this styles the `notes` slot this editor passes in —
   the caption naming the repository a cross-repository row belongs to. */
export const s = {
  note: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
