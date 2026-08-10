"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Skeleton } from "@devdigest/ui";
import { useBlastRadius, useBlastSummary } from "@/lib/hooks/blast";
import { ApiError } from "@/lib/api";
import { CounterRow } from "./_components/CounterRow";
import { SymbolRow } from "./_components/SymbolRow";
import { BlastGraphDialog } from "./_components/BlastGraphDialog";
import { PriorPrs } from "./_components/PriorPrs";
import { s } from "./styles";

interface BlastCardProps {
  prId: string | null;
  /** The PR's current head — every link is pinned to it, so lines stay right. */
  headSha: string;
  /** `null` when the repo is unknown; rows then render as plain text. */
  repoFullName: string | null;
}

/**
 * What this PR's changes reach: the symbols it touched, who calls them, and the
 * endpoints and jobs downstream — all read from the index, so the card renders
 * without a model call.
 *
 * The states that matter are the ones that distinguish "nothing is there" from
 * "we cannot see": `degraded` renders an explanation and NO tree and NO
 * counters, because an empty tree beside a "0 callers" counter reads as an
 * all-clear.
 */
export function BlastCard({ prId, headSha, repoFullName }: BlastCardProps) {
  const t = useTranslations("blast");
  const { data, isLoading, isError, error, refetch, isFetching } = useBlastRadius(prId);
  const explain = useBlastSummary(prId);
  // Plain local state, no URL param: whether the graph is open is presentation,
  // not a shareable location.
  const [graphOpen, setGraphOpen] = React.useState(false);

  const explainError = explain.isError
    ? explain.error instanceof ApiError
      ? explain.error.message
      : t("explainError")
    : null;

  if (isLoading) {
    // Keeps the card's footprint so the page doesn't shift once data lands.
    return (
      <section style={s.card}>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        <Skeleton height={14} width="45%" />
        <Skeleton height={72} />
      </section>
    );
  }

  if (isError) {
    return (
      <section style={s.card}>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        <div style={s.warning}>
          {error instanceof ApiError ? error.message : t("loadError")}
        </div>
        {/* The GET failed — retry the GET. Explaining here would answer a failed
            read with a paid model call the user never asked for. */}
        <Button onClick={() => void refetch()} disabled={isFetching}>
          {t("retry")}
        </Button>
      </section>
    );
  }

  if (!data) return null;

  if (data.status === "degraded") {
    return (
      <section style={s.card}>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        <div style={s.degraded}>
          <p style={s.degradedTitle}>{t("degradedTitle")}</p>
          <p style={s.degradedBody}>{t("degradedBody", { reason: data.reason ?? "" })}</p>
        </div>
        {/* Reads `pr_files`, never the index — so it answers here too. */}
        <PriorPrs prId={prId} repoFullName={repoFullName} />
      </section>
    );
  }

  const callerCount = data.changed_symbols.reduce((n, sym) => n + sym.callers.length, 0);
  const hasMap = data.changed_symbols.length > 0;

  return (
    <section style={s.card}>
      {/* Explain rides in the heading's `right` slot rather than the card's
          foot. It is the card's one action, and it disappears the moment a
          summary exists at this head — a re-run would be a paid call producing
          the answer already on screen. */}
      <SectionLabel
        icon="Workflow"
        right={
          data.summary ? undefined : (
            <Button
              size="sm"
              kind="tertiary"
              icon="Sparkles"
              onClick={() => explain.mutate()}
              disabled={explain.isPending}
            >
              {explain.isPending ? t("explaining") : t("explain")}
            </Button>
          )
        }
      >
        {t("title")}
      </SectionLabel>

      {data.status === "partial" && (
        <p style={s.warning}>{t("partialWarning", { reason: data.reason ?? "" })}</p>
      )}

      <CounterRow
        symbols={data.changed_symbols.length}
        callers={callerCount}
        endpoints={data.endpoints.length}
        crons={data.crons.length}
        onOpenGraph={hasMap ? () => setGraphOpen(true) : null}
      />

      {!hasMap ? (
        <p style={s.emptyNote}>{t("empty")}</p>
      ) : (
        <div style={s.tree}>
          {data.changed_symbols.map((sym, i) => (
            <SymbolRow
              key={`${sym.file}:${sym.name}`}
              sym={sym}
              headSha={headSha}
              repoFullName={repoFullName}
              defaultOpen={i === 0}
            />
          ))}
        </div>
      )}

      {explainError && (
        <div style={s.warning} role="alert">
          {explainError}
        </div>
      )}

      {data.summary && (
        <div>
          <div style={s.summaryTitle}>{t("summaryTitle")}</div>
          <p style={s.summary}>{data.summary}</p>
        </div>
      )}

      <PriorPrs prId={prId} repoFullName={repoFullName} />

      {graphOpen && (
        // Mounted only while open — the same `data` object the tree just
        // rendered, so opening costs no request.
        <BlastGraphDialog
          data={data}
          headSha={headSha}
          repoFullName={repoFullName}
          onClose={() => setGraphOpen(false)}
        />
      )}
    </section>
  );
}
