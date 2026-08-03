/* SkillsListView — the left column of /skills. Stays mounted while a skill is
   open, which is why it lives in the layout rather than the page. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import { useSkills, useUpdateSkill } from "../../../../lib/hooks/skills";
import { SkillCard } from "./_components/SkillCard";
import { CreateSkillModal, type CreateSkillTab } from "./_components/CreateSkillModal";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsListView({ activeId }: { activeId?: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const search = useSearchParams();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  // null = closed; otherwise the tab the chosen entry point should open on.
  const [creating, setCreating] = React.useState<CreateSkillTab | null>(null);
  const [query, setQuery] = React.useState("");

  const list = filterSkills(skills ?? [], query);
  // Keep whichever tab the user was on when they switch skills.
  const tab = search.get("tab") ?? "config";

  return (
    <div style={s.column}>
      {creating && (
        <CreateSkillModal
          open
          initialTab={creating}
          onClose={() => setCreating(null)}
          onCreated={(id) => {
            setCreating(null);
            router.push(`/skills/${id}?tab=config`);
          }}
        />
      )}
      <div style={s.head}>
        <div style={s.titleRow}>
          <h1 style={s.h1}>{t("page.heading")}</h1>
          <Dropdown
            width={210}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              { label: t("page.menu.manual"), icon: "Edit", onClick: () => setCreating("create") },
              { label: t("page.menu.fromFile"), icon: "FileText", onClick: () => setCreating("file") },
            ]}
          />
        </div>
        <div style={s.search}>
          <Icon.Search size={13} style={s.searchIcon} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("page.searchPlaceholder")}
            aria-label={t("page.searchPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>

      <div style={s.list}>
        {isLoading && (
          <>
            <Skeleton height={110} />
            <Skeleton height={110} />
            <Skeleton height={110} />
          </>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => setCreating("file")}
          />
        )}
        {list.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            active={skill.id === activeId}
            onClick={() => router.push(`/skills/${skill.id}?tab=${tab}`)}
            onToggle={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
          />
        ))}
      </div>
    </div>
  );
}
