/* TourToc — the "on this page" rail. Entries come from the sections the server
   sent, in that order: the tour's section order is a server decision and the
   rail must not imply a different one. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { OnboardingSectionValue } from "@devdigest/shared";
import { anchorFor } from "../../helpers";
import { s } from "./styles";

export function TourToc({
  sections,
  activeId,
  onSelect,
}: {
  sections: OnboardingSectionValue[];
  activeId: string | null;
  onSelect: (sectionId: string) => void;
}) {
  const t = useTranslations("onboarding");

  return (
    <nav style={s.toc} data-testid="tour-toc" aria-label={t("toc")}>
      <p style={s.label}>{t("toc")}</p>
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          style={s.item(section.id === activeId)}
          onClick={() => onSelect(section.id)}
          aria-current={section.id === activeId ? "true" : undefined}
          data-anchor={anchorFor(section.id)}
        >
          {section.title}
        </button>
      ))}
    </nav>
  );
}
