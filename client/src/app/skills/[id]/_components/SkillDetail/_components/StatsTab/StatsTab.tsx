/* StatsTab — who uses this skill, and nothing else. Pull frequency, accept rate
   and findings-by-category would need per-skill attribution on findings, which
   does not exist; a plausible-looking fake number is worse than an absent one. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { useSkillStats } from "../../../../../../../lib/hooks/skills";
import { s } from "./styles";

export function StatsTab({ skillId }: { skillId: string }) {
  const t = useTranslations("skills");
  const { data: stats, isLoading, isError, refetch } = useSkillStats(skillId);

  if (isLoading) return <Skeleton height={200} />;
  if (isError || !stats) {
    return <ErrorState body={t("stats.loadError")} onRetry={() => refetch()} />;
  }

  return (
    <div style={s.pane}>
      <Card style={s.tile}>
        <div style={s.tileLabel}>{t("stats.usedBy")}</div>
        <div style={s.tileValue}>
          {stats.agent_count}
          <span style={s.tileUnit}>{t("stats.agentsUnit")}</span>
        </div>
      </Card>

      <h2 style={s.heading}>{t("stats.agentsHeading")}</h2>
      {stats.agents.length === 0 ? (
        <EmptyState icon="Cpu" title={t("stats.empty")} body={t("stats.emptyHint")} />
      ) : (
        <Card>
          {stats.agents.map((a) => (
            <div key={a.id} style={s.agentRow}>
              <Link href={`/agents/${a.id}`} style={s.agentLink}>
                {a.name}
              </Link>
              {!a.enabled && <Badge color="var(--text-muted)">{t("stats.disabled")}</Badge>}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
