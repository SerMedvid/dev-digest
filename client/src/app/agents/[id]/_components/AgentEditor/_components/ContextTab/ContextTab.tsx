/* ContextTab — which project-context documents this agent reads on a review run.
   No Save button: every toggle and every reorder posts the complete ordered path
   list immediately (AC-43), reverting to the pre-toggle list if the post fails
   (AC-44).

   Ordering model (the same deliberate deviation from the comp that `SkillsTab`
   documents, AC-45): attached rows sit at the top in their stored order and are
   the only draggable ones; everything discovered below them, by root segment then
   path. Only rows attached *directly* carry a handle — an inherited row's place
   is owned by the skill that carries it, and the replace body contains direct
   paths only, so a handle there would be a control with nothing to post.

   The badge, the direct count and the token footer are read off
   `ContextAttachmentsView` as the server computed them, over the same deduped set
   the run injects (AC-64…AC-67). Re-deriving them from the rows would move the
   N+1 that the view exists to prevent into the client, and would let the figure
   on screen drift from the figure that gets billed. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EmptyState, ErrorState, Skeleton, TextInput } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ContextDocPreview } from "@/components/context-doc-preview";
import { ApiError } from "@/lib/api";
import { useRepos } from "@/lib/hooks/core";
import { useAgentContext, useContextDocs, useSetContextAttachments } from "@/lib/hooks/project-context";
import { useActiveRepo } from "@/lib/repo-context";
import { ContextRow } from "./_components/ContextRow";
import { directPathsOf, moveAttached, orderRows, type ContextRowModel } from "./helpers";
import { s } from "./styles";

/** A directly attached row, wrapped so @dnd-kit can drag it by its handle. */
function SortableContextRow({
  row,
  onToggle,
  onPreview,
}: {
  row: ContextRowModel;
  onToggle: (attached: boolean) => void;
  onPreview: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.path,
  });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <ContextRow
        row={row}
        dragging={isDragging}
        onToggle={onToggle}
        onPreview={onPreview}
        handleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { repoId } = useActiveRepo();
  const repos = useRepos();
  const docsQuery = useContextDocs(repoId);
  const view = useAgentContext(agent.id, repoId);
  const setAttachments = useSetContextAttachments();
  const [filter, setFilter] = React.useState("");
  // Optimistic direct-path order; null means "trust the server data".
  const [pending, setPending] = React.useState<string[] | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  // A rejected replace that was a *conflict* rather than a failure (LU). Kept
  // apart from `setAttachments.isError` so the banner can say why, and cleared
  // when the next replace is issued.
  const [conflict, setConflict] = React.useState(false);
  // PointerSensor only, inherited from `SkillsTab`. A KeyboardSensor belongs to
  // both tabs or neither (spec Open question 5) — not to this one alone.
  const sensors = useSensors(useSensor(PointerSensor));

  const attachments = view.data;
  const serverPaths = React.useMemo(
    () => directPathsOf(attachments, repoId ?? ""),
    [attachments, repoId],
  );
  const directPaths = pending ?? serverPaths;

  if (!repoId) {
    return (
      <EmptyState
        icon="GitBranch"
        title={t("contextTab.noRepoTitle")}
        body={t("contextTab.noRepoBody")}
      />
    );
  }
  if (view.isLoading || docsQuery.isLoading) return <Skeleton height={220} />;
  // Discovery failing on its own is a degradation, not a dead end: the stored
  // attachments still render below, so the user can detach one. Only the view
  // failing takes the tab out.
  if (view.isError || !attachments) {
    return <ErrorState body={t("contextTab.loadError")} onRetry={() => view.refetch()} />;
  }

  /* One mutation instance for the whole tab. `mutate` re-points the single
     mutation observer, so only the newest call's **mutate-level** callbacks —
     the two below — ever run (client/INSIGHTS.md, 2026-08-03). That guarantee
     covers these and nothing else: the callbacks declared inside
     `useSetContextAttachments` are the Mutation's own and query-core runs them
     unconditionally, in completion order, which is why the hook carries its own
     sequence guard. One instance per row would remove both protections. */
  const activeRepoId: string = repoId;

  function commit(next: string[]) {
    setPending(next);
    setConflict(false);
    setAttachments.mutate(
      { ownerKind: "agent", ownerId: agent.id, repoId: activeRepoId, paths: next },
      {
        onSuccess: () => setPending(null),
        /* Both handlers clear the optimistic list rather than restoring a
           snapshot. A replace that failed changed nothing, so the server view
           already *is* the pre-toggle list (AC-44) — while a `pending` that
           outlives its request keeps shadowing `serverPaths` for good: the next
           refetch would be ignored, and the next toggle would post a complete
           replacement built from a stale set, deleting whatever had been
           attached in the meantime. */
        onError: (error) => {
          setPending(null);
          /* A 409 is not the same event as a 500 (LU). The write was refused
             because the stored state moved on since this list was loaded, so
             the cached view the tab falls back to is itself out of date —
             dropping the optimistic list is necessary but not sufficient. Take
             the server's state (the refetch) and say why (the banner), rather
             than leaving the user looking at a list that quietly disagrees with
             what is stored. */
          if (error instanceof ApiError && error.status === 409) {
            setConflict(true);
            void view.refetch();
          }
        },
      },
    );
  }

  const docs = docsQuery.data?.docs ?? [];
  const rows = orderRows(docs, attachments, { activeRepoId, directPaths });
  const q = filter.trim().toLowerCase();
  // AC-46: a case-insensitive substring of the *full* repo-relative path, so
  // `specs/` narrows by folder just as well as a filename does.
  const visible = q ? rows.filter((r) => r.path.toLowerCase().includes(q)) : rows;
  const draggable = visible.filter((r) => r.kind === "direct");
  const rest = visible.filter((r) => r.kind !== "direct");

  const toggle = (path: string, attached: boolean) =>
    commit(attached ? [...directPaths, path] : directPaths.filter((p) => p !== path));

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = directPaths.indexOf(String(active.id));
    const to = directPaths.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    commit(moveAttached(directPaths, from, to));
  }

  const repoName = (id: string) => repos.data?.find((r) => r.id === id)?.name ?? id;
  const mapReduce = agent.strategy === "map-reduce" || agent.strategy === "auto";

  return (
    <div style={s.pane}>
      <div style={s.headRow}>
        <h2 style={s.heading}>{t("contextTab.heading")}</h2>
        <span style={s.badge}>
          {t("contextTab.badge", {
            effective: attachments.effective_count,
            discovered: attachments.discovered_count,
          })}
        </span>
        <span style={s.direct}>{t("contextTab.direct", { count: attachments.direct_count })}</span>
      </div>
      <p style={s.hint}>{t("contextTab.hint")}</p>

      {docsQuery.isError && <p style={s.notice}>{t("contextTab.discoveryError")}</p>}
      {docsQuery.data?.status === "no_clone" && <p style={s.notice}>{t("contextTab.noClone")}</p>}

      <div style={s.filter}>
        <TextInput
          value={filter}
          onChange={setFilter}
          placeholder={t("contextTab.filterPlaceholder")}
          aria-label={t("contextTab.filterPlaceholder")}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="FileText"
          title={t("contextTab.emptyTitle")}
          body={t("contextTab.emptyBody")}
        />
      ) : (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={draggable.map((r) => r.path)}
              strategy={verticalListSortingStrategy}
            >
              {draggable.map((row) => (
                <SortableContextRow
                  key={row.path}
                  row={row}
                  onToggle={(attached) => toggle(row.path, attached)}
                  onPreview={() => setPreview(row.path)}
                />
              ))}
            </SortableContext>
          </DndContext>

          {/* Keyed by repository as well as kind and path: the same document may
              be attached in several repositories, and each of those is its own
              inert row (AC-50). */}
          {rest.map((row) => (
            <ContextRow
              key={`${row.kind}:${row.repoId ?? ""}:${row.path}`}
              row={row}
              repoLabel={row.repoId ? repoName(row.repoId) : undefined}
              onToggle={(attached) => toggle(row.path, attached)}
              onPreview={() => setPreview(row.path)}
            />
          ))}
        </>
      )}

      <p style={s.footer}>
        {t("contextTab.footer", { tokens: attachments.token_estimate })}{" "}
        {mapReduce && <span style={s.footerNote}>{t("contextTab.footerMapReduce")}</span>}
      </p>

      {/* One banner, two messages: a conflict is reported as a conflict, and
          every other rejection keeps the generic save failure. */}
      {conflict ? (
        <div style={s.error}>{t("contextTab.saveConflict")}</div>
      ) : (
        setAttachments.isError && <div style={s.error}>{t("contextTab.saveFailed")}</div>
      )}

      {preview && (
        <ContextDocPreview repoId={repoId} path={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
