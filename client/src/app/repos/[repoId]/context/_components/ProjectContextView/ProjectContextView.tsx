/* ProjectContextView — the Project Context screen: a file column listing what
   discovery found in the clone, and the selected document rendered read-only
   beside it.

   Read-only is a decision, not an omission (AC-37). The comp this screen comes
   from draws a `Preview | Edit` toggle, a chunk count and a coverage gauge:
   there is no write path to the clone (a `sync` fast-forward would destroy a
   local edit), `code_chunks` has no producer anywhere in the repository, and
   the coverage figure is defined nowhere. Rendering them disabled would be
   three controls that never become enabled, so the screen leaves them out and
   the file column's footer states the document count and the scan time (AC-38).

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
  const openDoc = openPath === null ? null : rows.find((d) => d.path === openPath);

  /** AC-39 — re-run discovery. Invalidating the key refetches the active query,
      so the list and the footer's stamp both come from the new scan. */
  function rescan() {
    void qc.invalidateQueries({ queryKey: ["context-docs", repoId] });
  }

  /* The file column's head is the screen's title: the reading pane's head
     belongs to whichever document is open. */
  const sideHead = (
    <div style={s.sideHead}>
      <p style={s.eyebrow}>{t("title")}</p>
      <div style={s.roots}>
        {(data?.roots ?? []).map((root) => (
          <span key={root} className="mono" style={s.root}>
            {root}/
          </span>
        ))}
      </div>
    </div>
  );

  if (docs.isLoading) {
    return (
      <div style={s.page}>
        <div style={s.side}>
          {sideHead}
          <div style={s.list}>
            <Skeleton height={120} />
          </div>
        </div>
        <div style={s.main} />
      </div>
    );
  }

  if (docs.isError || !data) {
    return (
      <div style={s.page}>
        <div style={s.side}>{sideHead}</div>
        <div style={s.main}>
          <div style={s.bodyCentred}>
            <ErrorState title={t("loadError")} onRetry={() => docs.refetch()} />
          </div>
        </div>
      </div>
    );
  }

  /* A repository with no clone on disk is a 200 with `no_clone`, so it is an
     explanation, never an error state (AC-40). Same for a clone that holds no
     documents, which names the roots it searched (AC-41) — they are
     configurable, so a fixed sentence would eventually describe somewhere else. */
  const explanation =
    data.status === "no_clone" ? (
      <EmptyState
        icon="GitBranch"
        title={t("noClone.title", { repo: repoName })}
        body={t("noClone.body")}
      />
    ) : rows.length === 0 ? (
      <EmptyState
        icon="FileText"
        title={t("empty.title")}
        body={
          <>
            {t("empty.body")}
            <span style={s.emptyRoots}>
              {data.roots.map((root) => (
                <span key={root} className="mono" style={s.emptyRoot}>
                  {root}
                </span>
              ))}
            </span>
          </>
        }
      />
    ) : null;

  return (
    <div style={s.page}>
      <div style={s.side}>
        {sideHead}
        <div style={s.toolbar}>
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

        <div style={s.list}>
          {data.omitted > 0 && <p style={s.omitted}>{t("omitted", { count: data.omitted })}</p>}
          {rows.map((doc) => (
            <DocRow
              key={doc.path}
              doc={doc}
              selected={doc.path === openPath}
              onSelect={setSelected}
            />
          ))}
        </div>

        <p style={s.sideFoot}>
          {t("footer", { count: rows.length, time: scanTime(data.scanned_at) })}
        </p>
      </div>

      <div style={s.main}>
        {openPath !== null && (
          <div style={s.mainHead}>
            <p className="mono" style={s.mainPath}>
              {openPath}
            </p>
            {openDoc && (
              <span style={s.usedBy}>
                {t("row.usedBy", { count: openDoc.used_by_agents })}
              </span>
            )}
          </div>
        )}
        {openPath !== null ? (
          <div style={s.body}>
            <ContextDocBody repoId={repoId} path={openPath} />
          </div>
        ) : (
          <div style={s.bodyCentred}>
            {explanation ?? <p style={s.placeholder}>{t("detail.placeholder")}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
