/* GroupSection — one role's files (`core` | `wiring` | `boilerplate`):
   heading, description, file/finding counts, then each file as a FileCard
   composed with its marks, badge and summary pill. Design §6.1/§6.2. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FileCard } from "@/components/diff-viewer";
import type { SmartDiffRole } from "@devdigest/shared";
import { GROUP_LABEL_KEY, GROUP_DESC_KEY } from "../../constants";
import {
  findingCountFor,
  firstFindingLine,
  groupFindingLineCount,
  type JoinedFile,
  type ScrollTarget,
} from "../../helpers";
import { SummaryPill } from "../SummaryPill";
import { s } from "./styles";

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
  const findingLineCount = groupFindingLineCount(files.map((f) => f.smart));

  return (
    <section style={s.group}>
      <div style={s.heading}>
        <span style={s.label}>{t(`smartDiff.${GROUP_LABEL_KEY[role]}`)}</span>
        <span style={s.desc}>{t(`smartDiff.${GROUP_DESC_KEY[role]}`)}</span>
      </div>
      <div style={s.meta}>
        <span>{t("smartDiff.filesCount", { count: files.length })}</span>
        {findingLineCount > 0 && (
          <span>{t("smartDiff.findingLines", { count: findingLineCount })}</span>
        )}
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
              headerExtra={
                <span style={s.headerExtra}>
                  {line != null && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onBadgeClick(file.path, line);
                      }}
                      style={s.badge}
                    >
                      {t("smartDiff.findingsBadge", { count: findingCountFor(smart) })}
                    </button>
                  )}
                  <SummaryPill path={file.path} onSummarize={onSummarize} />
                </span>
              }
              preBody={
                smart.pseudocode_summary ? (
                  <div style={s.preBody}>
                    <strong>{t("smartDiff.whatThisDoes")}</strong> {smart.pseudocode_summary}
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
