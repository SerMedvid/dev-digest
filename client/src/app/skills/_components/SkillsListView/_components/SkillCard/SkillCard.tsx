/* SkillCard — one row in the skills library: type + source badges, the enabled
   toggle, and how many agents currently link the rule. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { SkillWithUsage } from "@devdigest/shared";
import { useDeleteSkill } from "../../../../../../lib/hooks/skills";
import { TYPE_COLOR } from "../../constants";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: SkillWithUsage;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const del = useDeleteSkill();
  const color = TYPE_COLOR[skill.type];

  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Sparkles size={15} />
        </div>
        <span style={s.name}>{skill.name}</span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(t("card.deleteConfirm", { name: skill.name }))) del.mutate(skill.id);
          }}
          disabled={del.isPending}
          title={t("card.deleteTitle")}
          aria-label={t("card.deleteTitle")}
          style={s.deleteBtn(del.isPending)}
        >
          <Icon.Trash size={14} style={del.isPending ? s.spinning : undefined} />
        </button>
      </div>
      <div style={s.description}>{skill.description || t("card.noDescription")}</div>
      <div style={s.metaRow}>
        <span className="mono" style={s.typeChip(color)}>
          {t(`listItem.type.${skill.type}`)}
        </span>
        <Badge color="var(--text-secondary)">{t(`listItem.source.${skill.source}`)}</Badge>
        <span style={s.usage}>
          {skill.agent_count > 0
            ? t("card.agentCount", { count: skill.agent_count })
            : t("card.unused")}
        </span>
      </div>
    </div>
  );
}
