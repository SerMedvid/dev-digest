import type { CSSProperties } from "react";

/* The tab body. `SkillDetail`'s own body is `{ flex: 1, overflow: "auto" }` and
   supplies no padding — every tab pads itself, and `ConfigTab` uses
   `{ padding: 28, maxWidth: 820 }`.

   This matters because the section inside used to live *within* ConfigTab and
   inherited both. Promoted to a tab of its own it inherited neither, so the
   rows ran edge to edge across the full window width with no gutter. */
export const s = {
  pane: { padding: 28, maxWidth: 820 } satisfies CSSProperties,
} as const;
