/* Route: /skills with nothing selected. The list lives in the layout; this is
   only the right-hand prompt. */
"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";

export default function SkillsPage() {
  const t = useTranslations("skills");
  return (
    <EmptyState
      icon="Sparkles"
      title={t("page.selectPrompt.title")}
      body={t("page.selectPrompt.body")}
    />
  );
}
