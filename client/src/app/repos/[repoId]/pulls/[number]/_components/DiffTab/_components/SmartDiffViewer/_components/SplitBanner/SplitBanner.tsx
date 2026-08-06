/* SplitBanner — shown only when the PR crosses `too_big` (design §2.3). The
   caller decides that; this component only renders what it's given. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { ProposedSplit } from "@devdigest/shared";
import { s } from "./styles";

interface SplitBannerProps {
  totalLines: number;
  proposedSplits: ProposedSplit[];
}

/**
 * An empty `proposedSplits` (the server's "fewer than two groupable splits"
 * rule) still renders the title and body, just no list — a large-but-single
 * -area PR is represented honestly rather than with a one-item list
 * pretending to be a plan (design §2.3).
 */
export function SplitBanner({ totalLines, proposedSplits }: SplitBannerProps) {
  const t = useTranslations("prReview");
  return (
    <div style={s.banner} role="status">
      <div style={s.title}>{t("smartDiff.largeTitle", { lines: totalLines })}</div>
      <div style={s.body}>{t("smartDiff.largeBody")}</div>
      {proposedSplits.length > 0 && (
        <ul style={s.list}>
          {proposedSplits.map((sp) => (
            <li key={sp.name}>{t("smartDiff.splitFiles", { name: sp.name, count: sp.files.length })}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
