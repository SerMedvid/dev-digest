/* Route group /skills — the list is a layout, not a page, so it stays mounted
   (and keeps its scroll and search box) while a skill is open beside it. */
"use client";

import React from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "../../components/app-shell";
import { SkillsListView } from "./_components/SkillsListView";

export default function SkillsLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("skills");
  // The child segment IS the skill id (`/skills/[id]`); null on `/skills`.
  const activeId = useSelectedLayoutSegment() ?? undefined;

  return (
    <AppShell
      crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills"), href: "/skills" }]}
    >
      <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>
        <SkillsListView activeId={activeId} />
        <div style={{ flex: 1, overflow: "auto" }}>{children}</div>
      </div>
    </AppShell>
  );
}
