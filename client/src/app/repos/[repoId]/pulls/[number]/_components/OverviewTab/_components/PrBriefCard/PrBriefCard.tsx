"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Skeleton } from "@devdigest/ui";
import type { PrBriefRecord, ReviewRecord } from "@devdigest/shared";
import { useGenerateBrief } from "@/lib/hooks/brief";
import { ApiError } from "@/lib/api";
import { VerdictBanner } from "../../../VerdictBanner";
import { BLOCKER_SEVERITIES, FALLBACK_VERDICT } from "./constants";
import { s } from "./styles";

interface PrBriefCardProps {
  prId: string | null;
  /** The brief, `null` when none has been generated, `undefined` while loading. */
  brief: PrBriefRecord | null | undefined;
  loading: boolean;
  /** The PR's newest review, for the verdict, score and counters. */
  review: ReviewRecord | undefined;
}

/**
 * The top of the PR overview: what the change is for and how much care it
 * needs, above everything else on the page.
 *
 * It wraps the existing `VerdictBanner` rather than growing a second banner —
 * the verdict and the risk level answer the same question at different
 * resolutions, and two boxes saying it would read as a disagreement. The
 * paragraph is the brief's `why` when one exists and the review's own summary
 * otherwise, so the banner is never blank.
 *
 * The query lives in `OverviewTab`: the risk list renders inside `IntentCard`
 * and the focus list below the grid, and three components each calling
 * `usePrBrief` would be three renders of one answer.
 */
export function PrBriefCard({ prId, brief, loading, review }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const generate = useGenerateBrief(prId);

  // A failed generation has to say so. The button re-enables the moment the
  // mutation settles, so without this a 409 or a 500 looks exactly like a click
  // that did nothing — and the user clicks again. 409 gets its own string
  // because "already running" is not a failure the user should retry.
  const error = generate.isError
    ? generate.error instanceof ApiError && generate.error.status === 409
      ? t("conflict")
      : generate.error instanceof ApiError
        ? generate.error.message
        : t("error")
    : null;

  if (loading) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Sparkles">{t("title")}</SectionLabel>
        <Skeleton height={96} />
      </section>
    );
  }

  if (!brief) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Sparkles">{t("title")}</SectionLabel>
        <div style={s.empty}>
          <p style={s.emptyText}>{t("unavailable")}</p>
          <p style={s.emptyHint}>{t("unavailableHint")}</p>
          {error && (
            <p style={s.error} role="alert">
              {error}
            </p>
          )}
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? t("generating") : t("generate")}
          </Button>
        </div>
      </section>
    );
  }

  const findings = review?.findings ?? [];
  const blockers = findings.filter((f) =>
    (BLOCKER_SEVERITIES as readonly string[]).includes(f.severity),
  ).length;

  return (
    <section style={s.section}>
      <SectionLabel icon="Sparkles">{t("title")}</SectionLabel>
      {error && (
        <p style={s.error} role="alert">
          {error}
        </p>
      )}
      <VerdictBanner
        verdict={review?.verdict ?? FALLBACK_VERDICT}
        summary={brief.why}
        score={review?.score ?? null}
        findingsCount={findings.length}
        blockers={blockers}
        riskLevel={brief.risk_level}
        onRegenerate={() => generate.mutate()}
        regenerating={generate.isPending}
      />
      <p style={s.what}>{brief.what}</p>
      {/* Deliberately below the banner and not inside it: the brief is still
          served when it is stale, and burying the reason inside the summary
          paragraph would make an out-of-date brief indistinguishable from a
          current one. */}
      {brief.stale && (
        <p style={s.warning} role="status">
          {t("stale")}
        </p>
      )}
    </section>
  );
}
