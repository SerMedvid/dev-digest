/* ProjectContextView — the Project Context screen: what discovery found in the
   clone, and the selected document rendered read-only beside it.

   Read-only is a decision, not an omission (AC-37). The comp this screen comes
   from draws a `Preview | Edit` toggle, a chunk count and a coverage gauge:
   there is no write path to the clone (a `sync` fast-forward would destroy a
   local edit), `code_chunks` has no producer anywhere in the repository, and
   the coverage figure is defined nowhere. So the footer states the document
   count and the scan time, and nothing else (AC-38).

   Attaching happens in the agent and skill editors; this screen only
   discovers. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { ContextDocBody } from "@/components/context-doc-preview";
import { useContextDocs } from "@/lib/hooks/project-context";
import { DocRow } from "./_components/DocRow";
import { scanTime } from "./helpers";
import { s } from "./styles";

export function ProjectContextView({ repoId, repoName }: { repoId: string; repoName: string }) {
  const t = useTranslations("context");
  const qc = useQueryClient();
  const docs = useContextDocs(repoId);
  const [selected, setSelected] = React.useState<string | null>(null);

  const data = docs.data;
  const rows = React.useMemo(() => data?.docs ?? [], [data]);
  // Derived, not stored: a rescan can drop the document that was open, and a
  // stale selection would ask the API for a path discovery no longer lists.
  const openPath = selected && rows.some((d) => d.path === selected) ? selected : null;

  /** AC-39 — re-run discovery. Invalidating the key refetches the active query,
      so the list and the footer's stamp both come from the new scan. */
  function rescan() {
    void qc.invalidateQueries({ queryKey: ["context-docs", repoId] });
  }

  const header = (
    <div style={s.header}>
      <div style={s.headerRow}>
        <h1 style={s.title}>{t("title")}</h1>
        <Button
          kind="ghost"
          size="sm"
          icon="RefreshCw"
          onClick={rescan}
          disabled={docs.isFetching}
        >
          {t("rescan")}
        </Button>
      </div>
      <p style={s.subtitle}>{t("subtitle", { repo: repoName })}</p>
    </div>
  );

  if (docs.isLoading) {
    return (
      <div style={s.page}>
        {header}
        <Skeleton height={120} />
      </div>
    );
  }

  if (docs.isError || !data) {
    return (
      <div style={s.page}>
        {header}
        <ErrorState title={t("loadError")} onRetry={() => docs.refetch()} />
      </div>
    );
  }

  return (
    <div style={s.page}>
      {header}

      {/* A repository with no clone on disk is a 200 with `no_clone`, so it is
          an explanation, never an error state (AC-40). */}
      {data.status === "no_clone" ? (
        <EmptyState
          icon="GitBranch"
          title={t("noClone.title", { repo: repoName })}
          body={t("noClone.body")}
        />
      ) : rows.length === 0 ? (
        // EmptyState takes no children — the roots that were searched ride in
        // `body`, which is a ReactNode (client/INSIGHTS.md, 2026-08-03). Naming
        // them is the requirement (AC-41): they are configurable, so a fixed
        // sentence would eventually describe somewhere else.
        <EmptyState
          icon="FileText"
          title={t("empty.title")}
          body={
            <>
              {t("empty.body")}
              <span style={s.roots}>
                {data.roots.map((root) => (
                  <span key={root} className="mono" style={s.root}>
                    {root}
                  </span>
                ))}
              </span>
            </>
          }
        />
      ) : (
        <>
          {data.omitted > 0 && <p style={s.omitted}>{t("omitted", { count: data.omitted })}</p>}
          <div style={s.split}>
            <div style={s.list}>
              {rows.map((doc) => (
                <DocRow
                  key={doc.path}
                  doc={doc}
                  selected={doc.path === openPath}
                  onSelect={setSelected}
                />
              ))}
            </div>
            <div style={s.detail}>
              {openPath ? (
                <>
                  <p className="mono" style={s.detailPath}>
                    {openPath}
                  </p>
                  <ContextDocBody repoId={repoId} path={openPath} />
                </>
              ) : (
                <p style={s.detailPlaceholder}>{t("detail.placeholder")}</p>
              )}
            </div>
          </div>
        </>
      )}

      <p style={s.footer}>
        {t("footer", { count: rows.length, time: scanTime(data.scanned_at) })}
      </p>
    </div>
  );
}
