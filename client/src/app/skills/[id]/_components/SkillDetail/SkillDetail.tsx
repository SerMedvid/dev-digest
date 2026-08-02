/* SkillDetail — header + the four tabs of one skill. Tab state is owned by the
   route (it lives in ?tab=), so this component only reports changes upward. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { TYPE_COLOR } from "../../../_components/SkillsListView/constants";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function SkillDetail({
  skill,
  tab,
  onTab,
}: {
  skill: Skill;
  tab: string;
  onTab: (t: string) => void;
}) {
  const t = useTranslations("skills");

  return (
    <div style={s.pane}>
      <div style={s.header}>
        <div style={s.iconBox}>
          <Icon.Sparkles size={16} />
        </div>
        <span style={s.name}>{skill.name}</span>
        <span className="mono" style={s.typeChip(TYPE_COLOR[skill.type])}>
          {t(`listItem.type.${skill.type}`)}
        </span>
        <Badge color="var(--text-secondary)">
          {t("preview.version", { version: skill.version })}
        </Badge>
      </div>

      <Tabs
        tabs={TABS.map((x) => ({ key: x.key, label: t(x.labelKey), icon: x.icon }))}
        value={tab}
        onChange={onTab}
      />

      <div style={s.body}>
        {tab === "config" && <ConfigTab skill={skill} />}
        {tab === "preview" && <PreviewTab skill={skill} />}
        {/* stats and versions are wired in Tasks 10–11 */}
      </div>
    </div>
  );
}
