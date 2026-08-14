/* ContextRow — the agent editor's adapter onto the shared `AttachmentRow`.

   The chrome (handle, checkbox, chip, badges, preview) is shared with the skill
   editor; what lives here is the part that is genuinely the agent's: the row
   `kind` union, and the `agents` message namespace.

   An inherited row has no detach control and links to its skill instead
   (AC-63), and a row belonging to another repository is inert and named with
   that repository (AC-50). Both stay checkboxes — disabled, so the row still
   reads as attached without offering an action it cannot perform. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AttachmentRow } from "@/components/context-attachments";
import type { ContextRowModel } from "../../helpers";
import { s } from "./styles";

export function ContextRow({
  row,
  repoLabel,
  dragging,
  onToggle,
  onPreview,
  handleProps,
}: {
  row: ContextRowModel;
  /** Name of the owning repository — `elsewhere` rows only. */
  repoLabel?: string;
  dragging?: boolean;
  onToggle: (attached: boolean) => void;
  onPreview: () => void;
  /** Listeners/attributes from @dnd-kit; absent unless the row is draggable. */
  handleProps?: React.HTMLAttributes<HTMLButtonElement>;
}) {
  const t = useTranslations("agents");
  const attached = row.kind !== "unattached";
  const inactive = row.kind === "elsewhere";
  // Only a directly attached row can be detached from this editor.
  const locked = row.kind === "inherited";

  return (
    <AttachmentRow
      path={row.path}
      root={row.root}
      attached={attached}
      locked={locked}
      inactive={inactive}
      missing={row.missing}
      beyondReadCap={row.beyondReadCap}
      dragging={dragging}
      handleProps={handleProps}
      onToggle={onToggle}
      onPreview={onPreview}
      labels={{
        dragHandle: t("contextTab.row.dragHandle", { path: row.path }),
        preview: t("contextTab.row.preview", { path: row.path }),
        missing: t("contextTab.row.missing"),
        beyondCap: t("contextTab.row.beyondCap"),
      }}
      notes={
        <>
          {row.kind === "inherited" && (
            <>
              <span style={s.note}>{t("contextTab.row.inherited")}</span>
              <Link href={`/skills/${row.skillId}`} style={s.link}>
                {row.skillName}
              </Link>
            </>
          )}
          {inactive && (
            <>
              <span style={s.note}>{t("contextTab.row.otherRepo")}</span>
              <span style={s.note}>{repoLabel}</span>
            </>
          )}
        </>
      }
    />
  );
}
