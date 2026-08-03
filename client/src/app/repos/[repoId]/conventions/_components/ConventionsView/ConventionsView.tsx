/* ConventionsView — the Conventions screen. Six states, one query: never
   scanned, scanning, done-with-nothing, done-with-candidates, failed, and
   "cannot load". The scan is server-side and asynchronous, so the query polls
   itself while it is in flight (see hooks/conventions.ts). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import {
  isScanInFlight,
  useConventions,
  useExtractConventions,
  usePatchConvention,
} from "@/lib/hooks/conventions";
import { ConventionCard } from "./_components/ConventionCard";
import { CreateConventionSkillModal } from "./_components/CreateConventionSkillModal";
import { ScanHeader } from "./_components/ScanHeader";
import { SelectionBar } from "./_components/SelectionBar";
import { dropEntries, tally } from "./helpers";
import { s } from "./styles";

export function ConventionsView({
  repoId,
  repoName,
  indexed,
}: {
  repoId: string;
  repoName: string;
  indexed: boolean;
}) {
  const t = useTranslations("conventions");
  const view = useConventions(repoId);
  const extract = useExtractConventions();
  const patch = usePatchConvention();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [deselectFailed, setDeselectFailed] = React.useState(false);

  const scan = view.data?.scan ?? null;
  const candidates = React.useMemo(() => view.data?.candidates ?? [], [view.data]);
  const counts = tally(candidates);
  const busy = extract.isPending || isScanInFlight(scan);

  function startScan() {
    extract.mutate(repoId);
  }

  /**
   * Reject every accepted candidate — "deselect all" in the mockup.
   *
   * `mutateAsync` + `allSettled` rather than a loop of `mutate`: these all share
   * one mutation instance, and re-calling `mutate` re-points its observer, so
   * `isError` tracks only the last call and every superseded call's `onError`
   * is dropped (see client/INSIGHTS.md). A partial failure would otherwise be
   * invisible — some rows rejected, some not, and nothing said so.
   */
  async function deselectAll() {
    setDeselectFailed(false);
    const results = await Promise.allSettled(
      candidates
        .filter((x) => x.status === "accepted")
        .map((c) => patch.mutateAsync({ repoId, id: c.id, patch: { status: "rejected" } })),
    );
    if (results.some((r) => r.status === "rejected")) setDeselectFailed(true);
  }

  const header = (
    <div style={s.header}>
      <h1 style={s.title}>
        {t("page.headingPrefix")}
        <span className="mono" style={s.titleRepo}>
          {repoName}
        </span>
      </h1>
      {/* The header owns the only scan trigger. The empty states below describe
          what a scan does but carry no button of their own — two controls
          labelled "Run extraction" on one screen read as two different actions. */}
      <ScanHeader
        scan={scan}
        accepted={counts.accepted}
        rejected={counts.rejected}
        busy={busy}
        onRescan={startScan}
      />
    </div>
  );

  if (view.isLoading) {
    return (
      <div style={s.page}>
        {header}
        <Skeleton height={120} />
      </div>
    );
  }

  if (view.isError) {
    return (
      <div style={s.page}>
        {header}
        <ErrorState title={t("page.loadError")} onRetry={() => view.refetch()} />
      </div>
    );
  }

  return (
    <div style={s.page}>
      {header}

      {scan?.status === "failed" && (
        <div style={s.failed}>
          <p style={s.failedTitle}>{t("page.extractionFailed")}</p>
          <p style={s.failedBody}>{scan.error}</p>
        </div>
      )}

      {candidates.length === 0 ? (
        scan && scan.status === "done" ? (
          // EmptyState takes no children — the drop-reason list rides in `body`,
          // which is a ReactNode.
          <EmptyState
            icon="AlertTriangle"
            title={t("page.noneSurvived.title")}
            body={
              <>
                {t("page.noneSurvived.body")}
                <span style={s.reasons}>
                  {dropEntries(scan.dropped).map(([reason, count]) => (
                    <span key={reason} style={s.reason}>
                      {count} × {t(`scan.dropReason.${reason}`)}
                    </span>
                  ))}
                </span>
              </>
            }
          />
        ) : indexed ? (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
          />
        ) : (
          <EmptyState
            icon="AlertTriangle"
            title={t("page.notIndexed.title")}
            body={t("page.notIndexed.body")}
          />
        )
      ) : (
        <>
          <SelectionBar
            accepted={counts.accepted}
            total={counts.total}
            busy={busy}
            onDeselectAll={deselectAll}
            onCreateSkill={() => setModalOpen(true)}
          />
          {deselectFailed && <div style={s.error}>{t("selection.deselectFailed")}</div>}
          <div style={s.list}>
            {candidates.map((c) => (
              <ConventionCard key={c.id} repoId={repoId} candidate={c} />
            ))}
          </div>
        </>
      )}

      {modalOpen && (
        <CreateConventionSkillModal
          repoId={repoId}
          repoName={repoName}
          acceptedCount={counts.accepted}
          onClose={() => setModalOpen(false)}
          onCreated={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
