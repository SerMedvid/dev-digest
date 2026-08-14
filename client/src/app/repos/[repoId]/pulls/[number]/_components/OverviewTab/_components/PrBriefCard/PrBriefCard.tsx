"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Skeleton } from "@devdigest/ui";
import type { PrBriefRecord, ReviewRecord, RunSummary } from "@devdigest/shared";
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
  /**
   * The run behind that review, for the spend badge. Cost lives on the run and
   * not on `ReviewRecord`, so it is resolved by `run_id` in `OverviewTab` —
   * exactly as `ReviewRunAccordion` does it. Absent just renders "—".
   */
  run?: RunSummary | undefined;
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
export function PrBriefCard({ prId, brief, loading, review, run }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const generate = useGenerateBrief(prId);

  // A failed generation has to say so. The button re-enables the moment the
  // mutation settles, so without this a 500 looks exactly like a click that did
  // nothing — and the user clicks again.
  //
  // A 409 is deliberately NOT in this bucket. It means a generation is already
  // in flight, which is a state, not a failure: rendering it in the error style
  // put a red "you can't" next to the stale marker's "you should", with nothing
  // on screen that resolved the contradiction.
  const conflict =
    generate.isError && generate.error instanceof ApiError && generate.error.status === 409;
  const error =
    generate.isError && !conflict
      ? generate.error instanceof ApiError
        ? generate.error.message
        : t("error")
      : null;

  // Clear a settled mutation once a newer brief lands, so neither message can
  // outlive the condition it describes — the 409's in-flight generation
  // finishing IS the resolution, and `useGenerateBrief` refetches to get it.
  const generatedAt = brief?.created_at;
  const reset = generate.reset;
  React.useEffect(() => {
    if (generatedAt) reset();
  }, [generatedAt, reset]);

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
          {conflict && (
            <p style={s.warning} role="status">
              {t("conflict")}
            </p>
          )}
          {error && (
            <p style={s.error} role="alert">
              {error}
            </p>
          )}
          <Button onClick={() => generate.mutate()} disabled={generate.isPending || conflict}>
            {generate.isPending || conflict ? t("generating") : t("generate")}
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
      {/* A status, not an alert: the generation the user asked for is happening,
          just not on this click. It clears as soon as that one lands. */}
      {conflict && (
        <p style={s.warning} role="status">
          {t("conflict")}
        </p>
      )}
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
        costUsd={run?.cost_usd}
        tokensIn={run?.tokens_in}
        tokensOut={run?.tokens_out}
        // Under the score, as the mockup draws it — not inline among the badges.
        spendPlacement="score"
        riskLevel={brief.risk_level}
        onRegenerate={() => generate.mutate()}
        regenerating={generate.isPending || conflict}
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
