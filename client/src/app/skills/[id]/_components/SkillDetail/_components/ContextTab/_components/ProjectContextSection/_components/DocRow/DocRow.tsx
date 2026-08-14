/* DocRow — the skill editor's adapter onto the shared `AttachmentRow`.

   The chrome (handle, checkbox, chip, badges, preview) is shared with the agent
   editor; what lives here is the skill's own part: its flatter row model and the
   `skills` message namespace.

   A row belonging to another repository is inert and named with that repository
   (AC-50). It stays a checkbox — disabled, so the row still reads as attached
   without offering an action it cannot perform — and has nothing to preview,
   since the document is in a clone this editor is not looking at. A row
   attached but missing from the clone keeps its checkbox so it can still be
   removed (AC-51), losing only the preview. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AttachmentRow } from "@/components/context-attachments";
import type { SkillContextRow } from "../../helpers";
import { s } from "./styles";

export function DocRow({
  row,
  repoLabel,
  dragging,
  onToggle,
  onPreview,
  handleProps,
}: {
  row: SkillContextRow;
  /** Name of the owning repository — cross-repository rows only. */
  repoLabel?: string;
  dragging?: boolean;
  onToggle: (attached: boolean) => void;
  onPreview: () => void;
  /** Listeners/attributes from @dnd-kit; absent unless the row is draggable. */
  handleProps?: React.HTMLAttributes<HTMLButtonElement>;
}) {
  const t = useTranslations("skills");
  const inactive = row.repoId !== null;

  return (
    <AttachmentRow
      path={row.path}
      root={row.root}
      attached={row.attached}
      inactive={inactive}
      missing={row.missing}
      beyondReadCap={row.beyondReadCap}
      dragging={dragging}
      handleProps={handleProps}
      onToggle={onToggle}
      onPreview={onPreview}
      labels={{
        dragHandle: t("projectContext.row.dragHandle", { path: row.path }),
        preview: t("projectContext.row.preview", { path: row.path }),
        missing: t("projectContext.row.missing"),
        beyondCap: t("projectContext.row.beyondCap"),
      }}
      notes={
        inactive ? (
          <>
            <span style={s.note}>{t("projectContext.row.otherRepo")}</span>
            <span style={s.note}>{repoLabel}</span>
          </>
        ) : null
      }
    />
  );
}
