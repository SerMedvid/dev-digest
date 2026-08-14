"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import type { PrFile } from "@devdigest/shared";
import { usePrBrief } from "@/lib/hooks/brief";
import { usePrReviews } from "@/lib/hooks/reviews";
import { IntentCard } from "./_components/IntentCard";
import { BlastCard } from "./_components/BlastCard";
import { PrBriefCard } from "./_components/PrBriefCard";
import { ReviewFocus } from "./_components/ReviewFocus";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  headSha: string;
  /** `null` when the repo isn't resolved; blast rows then render unlinked. */
  repoFullName: string | null;
  /** The PR's changed files — `ReviewFocus` only links what the diff renders. */
  files: PrFile[];
  /** Switches `?tab=`; the page owns navigation. */
  onSetTab: (tab: string) => void;
}

export function OverviewTab({
  prBody,
  prId,
  headSha,
  repoFullName,
  files,
  onSetTab,
}: OverviewTabProps) {
  // ONE query for the whole overview. The brief appears in three places — the
  // card above the grid, the risk list inside IntentCard, the focus list below
  // — and a hook call in each would be three renders of one answer.
  const { data: brief, isLoading } = usePrBrief(prId);
  const { data: reviews } = usePrReviews(prId);
  // Reviews come newest-first from the API; the banner describes the current
  // verdict, which is the newest review's.
  const latestReview = reviews?.[0];

  return (
    <>
      <PrBriefCard prId={prId} brief={brief} loading={isLoading} review={latestReview} />
      <div style={s.grid}>
        <IntentCard prId={prId} headSha={headSha} risks={brief?.risks} />
        <BlastCard prId={prId} headSha={headSha} repoFullName={repoFullName} />
      </div>
      <ReviewFocus
        items={brief?.review_focus}
        diffPaths={files.map((f) => f.path)}
        onSetTab={onSetTab}
      />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
