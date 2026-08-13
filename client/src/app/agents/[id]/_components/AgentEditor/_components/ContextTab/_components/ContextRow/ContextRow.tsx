/* ContextRow — presentational. One project-context document as the agent sees
   it: attached directly, inherited from a linked skill, attached for another
   repository, or merely discovered.

   Three details are requirements rather than taste:

   - The checkbox is a real `<input type="checkbox">` wrapped in a `<label>` whose
     only text is the document's path, so its accessible name *is* the document
     (AC-53). The vendored `Checkbox` is a `<button role="checkbox">` with a free
     `label` node, which cannot promise that.
   - The root segment rides in a chip whose text carries it; the tint is
     decoration (AC-53).
   - An inherited row has no detach control and links to its skill instead
     (AC-63), and a row belonging to another repository is inert and named with
     that repository (AC-50). Both are checkboxes all the same — disabled, so the
     row still reads as attached without offering an action it cannot perform. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
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
  // Only a directly attached row can be detached from this editor, and only a
  // document that is actually in this clone can be previewed.
  const locked = row.kind === "inherited" || inactive;
  const previewable = !row.missing && !inactive;

  return (
    <div style={s.row(attached, inactive, !!dragging)}>
      {handleProps ? (
        <button
          type="button"
          aria-label={t("contextTab.row.dragHandle", { path: row.path })}
          style={s.handle}
          {...handleProps}
        >
          <Icon.Menu size={14} />
        </button>
      ) : (
        <span style={s.handleGap} />
      )}

      <label style={s.label}>
        <input
          type="checkbox"
          checked={attached}
          disabled={locked}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="mono" style={s.path}>
          {row.path}
        </span>
      </label>

      <span style={s.spacer} />

      {row.missing && <span style={s.missing}>{t("contextTab.row.missing")}</span>}

      {/* Attached, ordered past the per-run cap, and therefore inert: the run
          names it unread and the footer does not bill it. Without this the row
          is indistinguishable from one that is injected on every review. */}
      {row.beyondReadCap && <span style={s.beyondCap}>{t("contextTab.row.beyondCap")}</span>}

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

      <span style={s.rootChip}>{row.root}</span>

      {previewable && (
        <button
          type="button"
          aria-label={t("contextTab.row.preview", { path: row.path })}
          style={s.preview}
          onClick={onPreview}
        >
          <Icon.Eye size={14} />
        </button>
      )}
    </div>
  );
}
