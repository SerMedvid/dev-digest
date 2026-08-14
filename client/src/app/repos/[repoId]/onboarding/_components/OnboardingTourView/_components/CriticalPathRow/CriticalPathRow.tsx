/* CriticalPathRow — one high-rank file with the one-line role the model wrote
   for it. The note may be null: the model is allowed to skip a file, and the
   path is the part that carries value, so the row still renders. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { OnboardingFileEntryValue } from "@devdigest/shared";
import { s } from "./styles";

export function CriticalPathRow({
  file,
  onOpen,
}: {
  file: OnboardingFileEntryValue;
  onOpen?: (path: string) => void;
}) {
  const t = useTranslations("onboarding");

  return (
    <div style={s.row} data-testid="critical-path-row">
      <Icon.File size={14} style={s.icon} />
      <span className="mono" style={s.path}>
        {file.path}
      </span>
      {file.note ? <span style={s.note}>{file.note}</span> : <span style={s.spacer} />}
      {onOpen ? (
        <button type="button" style={s.open} onClick={() => onOpen(file.path)}>
          {t("openFile")}
        </button>
      ) : null}
    </div>
  );
}
