/* VersionsTab — the append-only history of a skill body. Restore does not
   rewind: it appends a new version carrying the old text, which is why the
   confirm says so. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import {
  useSkillVersions,
  useRestoreSkillVersion,
} from "../../../../../../../lib/hooks/skills";
import { ApiError } from "../../../../../../../lib/api";
import { DiffView } from "./_components/DiffView";
import { s } from "./styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [openDiff, setOpenDiff] = React.useState<number | null>(null);

  if (isLoading) return <Skeleton height={240} />;
  if (isError || !versions) {
    return <ErrorState body={t("versions.loadError")} onRetry={() => refetch()} />;
  }

  return (
    <div style={s.pane}>
      <div style={s.headRow}>
        <h2 style={s.heading}>{t("versions.heading")}</h2>
        <Badge color="var(--text-secondary)">
          {t("versions.count", { count: versions.length })}
        </Badge>
      </div>
      <p style={s.subtitle}>{t("versions.subtitle")}</p>

      {versions.map((v, i) => {
        const isCurrent = i === 0;
        const diffOpen = openDiff === v.version;
        return (
          <div key={v.version} style={s.row}>
            <div style={s.rowHead}>
              <span className="mono" style={s.versionChip}>
                v{v.version}
              </span>
              <span style={v.summary ? s.summary : s.noSummary}>
                {v.summary || t("versions.noSummary")}
              </span>
              <span style={s.date}>{new Date(v.created_at).toLocaleDateString()}</span>
              {isCurrent ? (
                <Badge color="var(--ok)">{t("versions.current")}</Badge>
              ) : (
                <>
                  <Button
                    kind="ghost"
                    size="sm"
                    onClick={() => setOpenDiff(diffOpen ? null : v.version)}
                  >
                    {diffOpen ? t("versions.hideDiff") : t("versions.diff")}
                  </Button>
                  <Button
                    kind="ghost"
                    size="sm"
                    disabled={restore.isPending}
                    onClick={() => {
                      if (window.confirm(t("versions.restoreConfirm", { version: v.version })))
                        restore.mutate({ id: skill.id, version: v.version });
                    }}
                  >
                    {restore.isPending ? t("versions.restoring") : t("versions.restore")}
                  </Button>
                </>
              )}
            </div>
            {diffOpen && <DiffView from={v.body} to={skill.body} />}
          </div>
        );
      })}

      {restore.isError && (
        <div style={s.error}>
          {t("versions.restoreFailed")}
          {restore.error instanceof ApiError ? ` — ${restore.error.message}` : ""}
        </div>
      )}
    </div>
  );
}
