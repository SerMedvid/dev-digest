/* VerdictBanner — ported from findings.jsx.
   request_changes / approve / comment + summary + finding/blocker counts + score. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Button, CircularScore } from "@devdigest/ui";
import type { Verdict, RiskLevel } from "@devdigest/shared";
import { RunCostBadge } from "@/components/run-cost-badge";
import { VERDICT_META, RISK_BADGE } from "./constants";
import { s } from "./styles";

export function VerdictBanner({
  verdict,
  summary,
  score,
  findingsCount,
  blockers,
  agentName,
  costUsd,
  tokensIn,
  tokensOut,
  riskLevel,
  onRegenerate,
  regenerating,
}: {
  verdict: Verdict;
  summary: string | null;
  score: number | null;
  findingsCount: number;
  blockers: number;
  agentName?: string | null;
  /** Spend for the run behind this verdict. Optional — omitted (or null) just
   *  renders "—", so existing call sites stay valid. */
  costUsd?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  /** The brief's risk level (L05). Additive: omitted renders no badge, so the
   *  run-accordion call site is unchanged. */
  riskLevel?: RiskLevel | null;
  /** Regenerate the brief. Omitted renders no control. */
  onRegenerate?: (() => void) | null;
  regenerating?: boolean;
}) {
  const t = useTranslations("prReview");
  const tb = useTranslations("brief");
  const m = VERDICT_META[verdict] ?? VERDICT_META.comment;
  const VIcon = Icon[m.icon];
  return (
    <div style={s.wrap}>
      <div style={s.iconBox(m.bg, m.c)}>
        <VIcon size={22} />
      </div>
      <div style={s.main}>
        <div style={s.titleRow}>
          <span style={s.label(m.c)}>{t(`verdict.${m.labelKey}`)}</span>
          {/* The level is spelled out, never carried by colour alone — the
              design system's rule for severity chips, and the same reason the
              intent card writes its confidence out. */}
          {riskLevel && (
            <Badge color={RISK_BADGE[riskLevel].color} bg={RISK_BADGE[riskLevel].bg}>
              {tb(`risk.${riskLevel}`)}
            </Badge>
          )}
          <Badge color="var(--text-secondary)">
            {t("verdict.findingsCount", { count: findingsCount })}
            {blockers > 0 ? t("verdict.blockers", { count: blockers }) : ""}
          </Badge>
          {agentName && (
            <Badge color="var(--accent-text)" bg="var(--accent-bg)" icon="Cpu">
              {agentName}
            </Badge>
          )}
          <RunCostBadge
            costUsd={costUsd}
            tokensIn={tokensIn}
            tokensOut={tokensOut}
            variant="detailed"
            tokens="flow"
          />
          {onRegenerate && (
            <span style={s.regenerate}>
              <Button
                kind="ghost"
                size="sm"
                icon="RefreshCw"
                onClick={onRegenerate}
                disabled={!!regenerating}
              >
                {regenerating ? tb("regenerating") : tb("regenerate")}
              </Button>
            </span>
          )}
        </div>
        {summary && <p style={s.summary}>{summary}</p>}
      </div>
      {score != null && (
        <div style={s.scoreCol}>
          <CircularScore score={score} size={52} stroke={5} />
          <span style={s.scoreLabel}>{t("verdict.prScore")}</span>
        </div>
      )}
    </div>
  );
}
