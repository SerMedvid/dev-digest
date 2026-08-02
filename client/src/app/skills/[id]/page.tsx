/* Route: /skills/:id — the detail pane. The list beside it comes from the
   layout, so this renders only the right-hand column. Tab state in ?tab=. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { useSkill } from "../../../lib/hooks/skills";
import { ApiError } from "../../../lib/api";
import { SkillDetail, VALID_TABS } from "./_components/SkillDetail";

export default function SkillDetailPage() {
  const t = useTranslations("skills");
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);

  const tab = VALID_TABS.includes(search.get("tab") ?? "") ? search.get("tab")! : "config";
  const setTab = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  if (isLoading) return <Skeleton height={320} />;

  // A skill from another workspace is a 404, not a 403 — same empty state.
  if (error instanceof ApiError && error.status === 404) {
    return <EmptyState icon="Sparkles" title={t("detail.notFound.title")} body={t("detail.notFound.body")} />;
  }
  if (isError || !skill) {
    return <ErrorState body={t("detail.loadError")} onRetry={() => refetch()} />;
  }

  return <SkillDetail skill={skill} tab={tab} onTab={setTab} />;
}
