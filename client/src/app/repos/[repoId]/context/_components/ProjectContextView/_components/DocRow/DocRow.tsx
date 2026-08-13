/* DocRow — one discovered document. Selecting it opens the document in the
   detail panel beside the list; there is deliberately nothing else on the row.
   The usage count is server-computed (distinct agents, direct or through an
   enabled linked skill) — the row displays it, it never derives it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { ContextDoc } from "@devdigest/shared";
import { kbSize } from "../../helpers";
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
  return (
    <button
      type="button"
      aria-label={t("row.open", { path: doc.path })}
      aria-pressed={selected}
      onClick={() => onSelect(doc.path)}
      style={selected ? s.rowSelected : s.row}
    >
      <span className="mono" style={s.path}>
        {doc.path}
      </span>
      <span style={s.meta}>
        <span style={s.root}>{doc.root}</span>
        <span>{t("kb", { kb: kbSize(doc.size_bytes) })}</span>
        <span style={s.used}>{t("row.usedBy", { count: doc.used_by_agents })}</span>
      </span>
    </button>
  );
}
