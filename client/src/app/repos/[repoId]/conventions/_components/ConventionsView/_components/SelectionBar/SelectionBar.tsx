/* SelectionBar — how many candidates are accepted, and the one action that
   turns them into a skill. Disabled at zero: the endpoint 409s, and a button
   that always fails is worse than one that says it cannot run. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { s } from "./styles";

export function SelectionBar({
  accepted,
  total,
  busy,
  onDeselectAll,
  onCreateSkill,
}: {
  accepted: number;
  total: number;
  busy: boolean;
  onDeselectAll: () => void;
  onCreateSkill: () => void;
}) {
  const t = useTranslations("conventions");
  return (
    <div style={s.row}>
      <div style={s.left}>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          onClick={onDeselectAll}
          disabled={accepted === 0 || busy}
        >
          {t("selection.deselectAll")}
        </Button>
        <span style={s.count}>{t("selection.count", { accepted, total })}</span>
      </div>
      <Button
        kind="primary"
        size="sm"
        icon="Sparkles"
        onClick={onCreateSkill}
        disabled={accepted === 0 || busy}
      >
        {t("selection.createSkill")}
      </Button>
    </div>
  );
}
