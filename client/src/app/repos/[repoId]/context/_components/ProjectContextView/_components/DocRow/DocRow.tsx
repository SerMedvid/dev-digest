/* DocRow — one discovered document in the file column. Selecting it opens the
   document in the reading pane beside the list.

   The usage count is server-computed (distinct agents, direct or through an
   enabled linked skill) — the row displays it, it never derives it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { ContextDoc } from "@devdigest/shared";
import { splitPath } from "../../helpers";
import { s } from "./styles";

export function DocRow({
  doc,
  selected,
  onSelect,
}: {
  doc: ContextDoc;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const t = useTranslations("context");
  const { dir, name } = splitPath(doc.path);
  return (
    <button
      type="button"
      aria-label={t("row.open", { path: doc.path })}
      aria-pressed={selected}
      onClick={() => onSelect(doc.path)}
      style={selected ? s.rowSelected : s.row}
    >
      <span style={s.icon}>
        <Icon.FileText size={13} />
      </span>
      {/* The full path stays in `title` and in the aria-label: two documents
          can share a file name across roots, and the row truncates. */}
      <span style={s.label} title={doc.path}>
        <span className="mono" style={s.name}>
          {name}
        </span>
        {dir !== "" && (
          <span className="mono" style={s.dir}>
            {dir}
          </span>
        )}
      </span>
      <span style={s.used}>{t("row.usedByShort", { count: doc.used_by_agents })}</span>
    </button>
  );
}
