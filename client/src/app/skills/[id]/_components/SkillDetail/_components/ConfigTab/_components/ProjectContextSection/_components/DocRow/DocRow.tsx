/* DocRow — presentational. One project-context document as the skill sees it:
   attached to this skill for the active repository, attached against another
   repository, or merely discovered.

   Four details are requirements rather than taste:

   - The checkbox is a real `<input type="checkbox">` wrapped in a `<label>` whose
     only text is the document's path, so its accessible name *is* the document
     (AC-42, AC-53). The vendored `Checkbox` is a `<button role="checkbox">` with
     a free `label` node, which cannot promise that.
   - The root segment rides in a chip whose text carries it; the tint is
     decoration (AC-53).
   - A row attached but missing from the clone keeps its checkbox, so it can
     still be removed (AC-51). It loses only the preview control — there is
     nothing on disk to preview.
   - A row belonging to another repository is inert and named with that
     repository (AC-50). Its checkbox is disabled rather than absent, so the row
     still reads as attached without offering an action it cannot perform, and it
     has nothing to preview: the document is in a clone this editor is not
     looking at. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { SkillContextRow } from "../../helpers";
import { s } from "./styles";

export function DocRow({
  row,
  repoLabel,
  onToggle,
  onPreview,
}: {
  row: SkillContextRow;
  /** Name of the owning repository — cross-repository rows only. */
  repoLabel?: string;
  onToggle: (attached: boolean) => void;
  onPreview: () => void;
}) {
  const t = useTranslations("skills");
  const inactive = row.repoId !== null;

  return (
    <div style={s.row(row.attached, inactive)}>
      <label style={s.label}>
        <input
          type="checkbox"
          checked={row.attached}
          disabled={inactive}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="mono" style={s.path}>
          {row.path}
        </span>
      </label>

      <span style={s.spacer} />

      {row.missing && <span style={s.missing}>{t("projectContext.row.missing")}</span>}

      {/* Attached, ordered past the per-run cap, and therefore inert: the run
          names it unread and no footer bills it. Without this the row is
          indistinguishable from one that is injected on every review. */}
      {row.beyondReadCap && <span style={s.beyondCap}>{t("projectContext.row.beyondCap")}</span>}

      {inactive && (
        <>
          <span style={s.note}>{t("projectContext.row.otherRepo")}</span>
          <span style={s.note}>{repoLabel}</span>
        </>
      )}

      <span style={s.rootChip}>{row.root}</span>

      {!row.missing && !inactive && (
        <button
          type="button"
          aria-label={t("projectContext.row.preview", { path: row.path })}
          style={s.preview}
          onClick={onPreview}
        >
          <Icon.Eye size={14} />
        </button>
      )}
    </div>
  );
}
