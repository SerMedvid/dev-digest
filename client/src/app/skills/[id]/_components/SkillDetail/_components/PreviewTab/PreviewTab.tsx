/* PreviewTab — the body as Markdown, framed as what the reviewing agent gets.
   Uses the vendored Markdown primitive; do not add a second renderer. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown, EmptyState } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");

  return (
    <div style={s.pane}>
      <h2 style={s.heading}>{t("previewTab.heading")}</h2>
      <p style={s.subtitle}>{t("previewTab.subtitle")}</p>
      {skill.body.trim() ? (
        <div style={s.surface}>
          <Markdown>{skill.body}</Markdown>
        </div>
      ) : (
        <EmptyState icon="FileText" title={t("previewTab.empty")} />
      )}
    </div>
  );
}
