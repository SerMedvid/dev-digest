/* SmartDiffViewer — the Files changed tab's default rendering (design §6.1):
   the PR's files grouped by role (`core` → `wiring` → `boilerplate`), marked
   with findings, collapsed per §6.2, with a split suggestion when the PR is
   too big. `?order=original` falls back to the flat DiffViewer instead of
   this component — see DiffTab. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { useSmartDiff, useFileSummary } from "@/lib/hooks/smart-diff";
import { ApiError } from "@/lib/api";
import type { PrFile } from "@/lib/types";
import { joinFilesWithGroups, initialOpenState, type ScrollTarget } from "./helpers";
import { GroupSection } from "./_components/GroupSection";
import { SplitBanner } from "./_components/SplitBanner";
import { s } from "./styles";

interface SmartDiffViewerProps {
  prId: string | null;
  /** Patches — `SmartDiff` carries none; joined by path in `helpers.ts`. */
  files: PrFile[];
  /** A line's severity chip: the page owns navigation (`?tab=findings&finding=`). */
  onOpenFinding: (findingId: string) => void;
}

export function SmartDiffViewer({ prId, files, onOpenFinding }: SmartDiffViewerProps) {
  const t = useTranslations("prReview");
  const tShell = useTranslations("shell");
  const { data, isLoading, isError, error, refetch } = useSmartDiff(prId);
  const summarize = useFileSummary(prId);

  const [openState, setOpenState] = React.useState<Record<string, boolean> | null>(null);
  const [scrollTarget, setScrollTarget] = React.useState<ScrollTarget | null>(null);
  const clickToken = React.useRef(0);
  const seededFor = React.useRef<string | null | undefined>(undefined);

  // §6.2's precedence is only ever the *starting* state — a resummarize
  // patches `data` in place (see useFileSummary) and gives it a new object
  // identity on every success, so re-seeding on every `data` change would
  // silently discard any toggle the user already made. Seed once per PR.
  React.useEffect(() => {
    if (data && seededFor.current !== prId) {
      setOpenState(initialOpenState(data.groups));
      setScrollTarget(null);
      seededFor.current = prId;
    }
  }, [data, prId]);

  // Falls back to a freshly-computed seed for the one render between data
  // arriving and the effect above persisting it, so there's no flash of an
  // all-closed (or all-open) list before the real precedence applies.
  const seeded = React.useMemo(() => (data ? initialOpenState(data.groups) : {}), [data]);
  const effectiveOpenState = openState ?? seeded;

  const toggle = React.useCallback(
    (path: string) => {
      setOpenState((prev) => {
        const base = prev ?? seeded;
        return { ...base, [path]: !base[path] };
      });
    },
    [seeded],
  );

  const handleBadgeClick = React.useCallback(
    (path: string, line: number) => {
      setOpenState((prev) => {
        const base = prev ?? seeded;
        return { ...base, [path]: true };
      });
      clickToken.current += 1;
      setScrollTarget({ path, line, token: clickToken.current });
    },
    [seeded],
  );

  const handleSummarize = React.useCallback((path: string) => summarize.mutateAsync(path), [summarize]);

  if (isLoading) {
    return (
      <div style={s.loading}>
        <Skeleton height={90} />
        <Skeleton height={90} />
        <Skeleton height={60} />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="Couldn't load Smart Diff"
        body={error instanceof ApiError ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  if (!data || data.groups.length === 0) {
    return <div style={s.empty}>{tShell("diffViewer.noChangedFiles")}</div>;
  }

  const joined = joinFilesWithGroups(data.groups, files);

  return (
    <div style={s.wrap}>
      <div style={s.caption}>{t("smartDiff.groupedByRole")}</div>
      {data.split_suggestion.too_big && (
        <SplitBanner
          totalLines={data.split_suggestion.total_lines}
          proposedSplits={data.split_suggestion.proposed_splits}
        />
      )}
      {joined.map((group) => (
        <GroupSection
          key={group.role}
          role={group.role}
          files={group.files}
          openState={effectiveOpenState}
          onToggle={toggle}
          onBadgeClick={handleBadgeClick}
          onMarkClick={onOpenFinding}
          onSummarize={handleSummarize}
          scrollTarget={scrollTarget}
        />
      ))}
    </div>
  );
}
