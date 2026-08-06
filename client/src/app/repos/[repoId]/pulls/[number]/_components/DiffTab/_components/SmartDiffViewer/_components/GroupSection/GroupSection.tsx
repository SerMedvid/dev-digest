/* GroupSection — one role's files (`core` | `wiring` | `boilerplate`):
   heading, description, file/finding counts, then each file as a FileCard
   composed with its marks, badge and summary pill. Design §6.1/§6.2. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { FileCard } from "@/components/diff-viewer";
import type { SmartDiffRole } from "@devdigest/shared";
import { GROUP_LABEL_KEY, GROUP_DESC_KEY, GROUP_DOT_COLOR } from "../../constants";
import {
  findingCountFor,
  firstFindingLine,
  worstSeverityFor,
  type JoinedFile,
  type ScrollTarget,
} from "../../helpers";
import { SummaryPill } from "../SummaryPill";
import { s, findingDotFor } from "./styles";

interface GroupSectionProps {
  role: SmartDiffRole;
  files: JoinedFile[];
  openState: Record<string, boolean>;
  onToggle: (path: string) => void;
  /** A file's finding badge: expand it and scroll to its first marked line
   *  (design §6.3). */
  onBadgeClick: (path: string, line: number) => void;
  /** A line's severity chip: navigate to the finding (design §6.3) — this is
   *  `onOpenFinding`, forwarded straight through by `SmartDiffViewer`. */
  onMarkClick: (findingId: string) => void;
  onSummarize: (path: string) => Promise<unknown>;
  scrollTarget: ScrollTarget | null;
}

export function GroupSection({
  role,
  files,
  openState,
  onToggle,
  onBadgeClick,
  onMarkClick,
  onSummarize,
  scrollTarget,
}: GroupSectionProps) {
  const t = useTranslations("prReview");

  return (
    <section style={s.group}>
      <div style={s.heading}>
        <span style={{ ...s.dot, background: GROUP_DOT_COLOR[role] }} />
        <span style={s.label}>{t(`smartDiff.${GROUP_LABEL_KEY[role]}`)}</span>
        <span style={s.desc}>{t(`smartDiff.${GROUP_DESC_KEY[role]}`)}</span>
        <span style={s.count}>{t("smartDiff.filesCount", { count: files.length })}</span>
      </div>
      <div style={s.list}>
        {files.map(({ smart, file }) => {
          const line = firstFindingLine(smart);
          const isTarget = scrollTarget?.path === file.path;
          return (
            <FileCard
              // Remounts the badge's target file on every click, even a
              // repeat click at the same line — FileCard's own scroll effect
              // latches by value, so an unchanged `scrollToLine` prop would
              // otherwise be silently ignored the second time (design §6.3,
              // client/INSIGHTS.md 2026-08-02).
              key={isTarget ? `${file.path}:${scrollTarget.token}` : file.path}
              file={file}
              open={!!openState[file.path]}
              onToggle={() => onToggle(file.path)}
              marks={smart.finding_marks ?? undefined}
              onMarkClick={onMarkClick}
              scrollToLine={isTarget ? scrollTarget.line : undefined}
              pathAdornment={
                line != null && (
                  // The dot carries no visible count — its accessible name
                  // does, so the click target keeps naming what it opens.
                  <button
                    type="button"
                    title={t("smartDiff.findingsBadge", { count: findingCountFor(smart) })}
                    aria-label={t("smartDiff.findingsBadge", { count: findingCountFor(smart) })}
                    onClick={(e) => {
                      e.stopPropagation();
                      onBadgeClick(file.path, line);
                    }}
                    style={findingDotFor(worstSeverityFor(smart))}
                  />
                )
              }
              headerExtra={
                <span style={s.headerExtra}>
                  <SummaryPill path={file.path} onSummarize={onSummarize} />
                </span>
              }
              preBody={
                smart.pseudocode_summary ? (
                  <div style={s.preBody}>
                    <Icon.Sparkles size={12} style={s.preBodyIcon} />
                    <span>
                      <strong style={s.preBodyLabel}>{t("smartDiff.whatThisDoes")}</strong>{" "}
                      {smart.pseudocode_summary}
                    </span>
                  </div>
                ) : undefined
              }
            />
          );
        })}
      </div>
    </section>
  );
}
