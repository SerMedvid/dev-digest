/* SkillRow — presentational. One workspace skill, checked when this agent links
   it. Only linked rows are draggable, because only they have a stored order. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Checkbox, Icon } from "@devdigest/ui";
import type { SkillWithUsage } from "@devdigest/shared";
import { TYPE_COLOR } from "../../../../../../../../skills/_components/SkillsListView/constants";
import { s } from "./styles";

export function SkillRow({
  skill,
  linked,
  dragging,
  onToggle,
  handleProps,
}: {
  skill: SkillWithUsage;
  linked: boolean;
  dragging?: boolean;
  onToggle: (linked: boolean) => void;
  /** Listeners/attributes from @dnd-kit; absent for unlinked rows. */
  handleProps?: React.HTMLAttributes<HTMLButtonElement>;
}) {
  const t = useTranslations("agents");
  const ts = useTranslations("skills");

  return (
    <div style={s.row(linked, !!dragging)}>
      <button
        type="button"
        aria-label={t("skillsTab.dragHandle")}
        style={s.handle(linked)}
        {...handleProps}
      >
        <Icon.Menu size={14} />
      </button>
      <Checkbox checked={linked} onChange={onToggle} label={skill.name} />
      <span style={s.spacer} />
      <span className="mono" style={s.typeChip(TYPE_COLOR[skill.type])}>
        {ts(`listItem.type.${skill.type}`)}
      </span>
      <Link href={`/skills/${skill.id}`} style={s.open}>
        {t("skillsTab.open")}
      </Link>
    </div>
  );
}
