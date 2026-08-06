"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "./_components/SmartDiffViewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";
import { s } from "./styles";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** `?order=` from the URL, owned by `page.tsx` like `?tab=`. `"original"`
   *  renders today's flat DiffViewer; anything else (including `null`)
   *  renders SmartDiffViewer, the new default (design §6.1). */
  order: string | null;
  onSetOrder: (order: string | null) => void;
  /** A line's severity chip (Smart Diff) navigates to the finding — the page
   *  owns navigation (design §6.3). */
  onOpenFinding: (findingId: string) => void;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  order,
  onSetOrder,
  onOpenFinding,
}: DiffTabProps) {
  const t = useTranslations("prReview");
  const isOriginal = order === "original";
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);

  const commentCount = comments?.length ?? 0;

  // The PR-level +/− total, summed from the same rows the viewer renders, so
  // the stat line can never claim lines no file below it accounts for.
  const totals = React.useMemo(
    () =>
      files.reduce(
        (acc, f) => ({
          add: acc.add + (f.additions ?? 0),
          del: acc.del + (f.deletions ?? 0),
        }),
        { add: 0, del: 0 },
      ),
    [files],
  );

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          commentCount > 0 && (
            <Button
              kind="ghost"
              size="sm"
              icon={showComments ? "EyeOff" : "Eye"}
              onClick={() => setShowComments((v) => !v)}
            >
              {showComments ? "Hide comments" : "Show comments"} ({commentCount})
            </Button>
          )
        }
      >
        {isOriginal ? t("smartDiff.filesChanged") : t("smartDiff.caption")}
      </SectionLabel>
      <div style={s.subheader}>
        <span className="tnum" style={s.stats}>
          {t("smartDiff.filesCount", { count: filesCount })} ·{" "}
          <span style={s.add}>+{totals.add}</span> <span style={s.del}>−{totals.del}</span>
        </span>
        <div style={s.orderToggle}>
          <Button kind="tertiary" size="sm" active={!isOriginal} onClick={() => onSetOrder(null)}>
            {t("smartDiff.orderSmart")}
          </Button>
          <Button kind="tertiary" size="sm" active={isOriginal} onClick={() => onSetOrder("original")}>
            {t("smartDiff.orderOriginal")}
          </Button>
        </div>
      </div>
      {isOriginal ? (
        <DiffViewer files={files} commenting={commenting} />
      ) : (
        <SmartDiffViewer prId={prId} files={files} onOpenFinding={onOpenFinding} />
      )}
    </section>
  );
}
