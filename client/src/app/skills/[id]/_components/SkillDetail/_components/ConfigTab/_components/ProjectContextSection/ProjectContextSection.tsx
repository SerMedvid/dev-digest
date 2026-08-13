/* ProjectContextSection — which project-context documents this *skill* carries.
   Every agent linked to the skill inherits them, which is the whole point of
   attaching here rather than on each agent (the hint says so in the catalogue).

   No Save button, and no relationship to the skill's own Save button above it:
   every toggle posts the complete ordered path list immediately (AC-43) and
   reverts to the pre-toggle list if the post fails (AC-44). One mutation
   instance for the section — `mutate` re-points the single mutation observer, so
   only the newest call's **mutate-level** callbacks run (client/INSIGHTS.md,
   2026-08-03). That covers the two passed to `mutate` here and nothing more: the
   callbacks declared inside `useSetContextAttachments` belong to the Mutation
   and query-core runs them unconditionally, which is why the hook carries its
   own sequence guard. Do not split it per row.

   The `SERIALIZES AS` panel renders the block the **server** assembled, verbatim.
   It is not re-derived here and it is not run through the markdown renderer: the
   point of the panel is that the heading (`## Project context`) and each
   `<untrusted source="spec-N">` wrapper are the literal bytes a run sends
   (AC-49). The comp's `## Project specifications` path list is not what is sent
   and is deliberately absent. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton, TextInput } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ContextDocPreview } from "@/components/context-doc-preview";
import { ApiError } from "@/lib/api";
import { useRepos } from "@/lib/hooks/core";
import {
  useContextDocs,
  useSetContextAttachments,
  useSkillContext,
  useSkillContextPreview,
} from "@/lib/hooks/project-context";
import { useActiveRepo } from "@/lib/repo-context";
import { DocRow } from "./_components/DocRow";
import { attachedPathsOf, orderRows } from "./helpers";
import { s } from "./styles";

/** Heading, explanation and the optional count — present in every state. */
function Section({ badge, children }: { badge?: React.ReactNode; children: React.ReactNode }) {
  const t = useTranslations("skills");
  return (
    <section style={s.section}>
      <div style={s.headRow}>
        <h3 style={s.heading}>{t("projectContext.heading")}</h3>
        {badge}
      </div>
      <p style={s.hint}>{t("projectContext.hint")}</p>
      {children}
    </section>
  );
}

/**
 * The serialisation preview. It owns its own query rather than taking the block
 * as a prop: nothing above it needs the text, and mounting it only inside the
 * loaded branch keeps the request out of the states where there is no repository
 * to preview against.
 */
function SerializedPanel({ skillId, repoId }: { skillId: string; repoId: string }) {
  const t = useTranslations("skills");
  const preview = useSkillContextPreview(skillId, repoId);
  const block = preview.data?.block ?? "";
  const unread = preview.data?.unread ?? [];

  return (
    <div style={s.panel}>
      <span style={s.panelLabel}>{t("projectContext.serialized.label")}</span>
      <p style={s.panelHint}>{t("projectContext.serialized.hint")}</p>

      {preview.isLoading && <Skeleton height={90} />}
      {preview.isError && <p style={s.panelEmpty}>{t("projectContext.serialized.loadError")}</p>}
      {!preview.isLoading &&
        !preview.isError &&
        (block ? (
          // Verbatim. `pre` and nothing else: a markdown render would eat the
          // heading and the untrusted wrappers this panel exists to show.
          <pre className="mono" style={s.block}>
            {block}
          </pre>
        ) : (
          <p style={s.panelEmpty}>{t("projectContext.serialized.empty")}</p>
        ))}

      {unread.length > 0 && (
        <div style={s.unread}>
          <span style={s.unreadHeading}>{t("projectContext.serialized.unreadHeading")}</span>
          <p style={s.unreadHint}>{t("projectContext.serialized.unreadHint")}</p>
          <ul style={s.unreadList}>
            {unread.map((entry) => (
              <li key={entry} className="mono" style={s.unreadItem}>
                {entry}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ProjectContextSection({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { repoId } = useActiveRepo();
  const repos = useRepos();
  const docsQuery = useContextDocs(repoId);
  const view = useSkillContext(skill.id, repoId);
  const setAttachments = useSetContextAttachments();
  const [filter, setFilter] = React.useState("");
  // Optimistic attached-path order; null means "trust the server data".
  const [pending, setPending] = React.useState<string[] | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  // A rejected replace that was a *conflict* rather than a failure (LU). Kept
  // apart from `setAttachments.isError` so the banner can say why, and cleared
  // when the next replace is issued.
  const [conflict, setConflict] = React.useState(false);

  const attachments = view.data;
  const serverPaths = React.useMemo(
    () => attachedPathsOf(attachments, repoId ?? ""),
    [attachments, repoId],
  );
  const attachedPaths = pending ?? serverPaths;

  if (!repoId) {
    return (
      <Section>
        <p style={s.notice}>{t("projectContext.noRepo")}</p>
      </Section>
    );
  }
  if (view.isLoading || docsQuery.isLoading) {
    return (
      <Section>
        <Skeleton height={160} />
      </Section>
    );
  }
  // Discovery failing on its own is a degradation, not a dead end: the stored
  // attachments still render below, so the user can detach one. Only the view
  // failing takes the section out.
  if (view.isError || !attachments) {
    return (
      <Section>
        <ErrorState body={t("projectContext.loadError")} onRetry={() => view.refetch()} />
      </Section>
    );
  }

  const activeRepoId: string = repoId;

  function commit(next: string[]) {
    setPending(next);
    setConflict(false);
    setAttachments.mutate(
      { ownerKind: "skill", ownerId: skill.id, repoId: activeRepoId, paths: next },
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
             because the stored set moved on since this list was loaded, so the
             cached view the section falls back to is itself out of date —
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

  const rows = orderRows(docsQuery.data?.docs ?? [], attachments, attachedPaths, activeRepoId);
  const q = filter.trim().toLowerCase();
  // AC-46: a case-insensitive substring of the *full* repo-relative path, so
  // `specs/` narrows by folder just as well as a filename does. Same semantics
  // as the agent editor's Context tab, deliberately.
  const visible = q ? rows.filter((row) => row.path.toLowerCase().includes(q)) : rows;
  const repoName = (id: string) => repos.data?.find((r) => r.id === id)?.name ?? id;
  const toggle = (path: string, attached: boolean) =>
    commit(attached ? [...attachedPaths, path] : attachedPaths.filter((p) => p !== path));

  return (
    <Section
      badge={
        <span style={s.badge}>
          {t("projectContext.badge", {
            attached: attachments.effective_count,
            discovered: attachments.discovered_count,
          })}
        </span>
      }
    >
      {docsQuery.isError && <p style={s.notice}>{t("projectContext.discoveryError")}</p>}
      {docsQuery.data?.status === "no_clone" && (
        <p style={s.notice}>{t("projectContext.noClone")}</p>
      )}

      <div style={s.filter}>
        <TextInput
          value={filter}
          onChange={setFilter}
          placeholder={t("projectContext.filterPlaceholder")}
          aria-label={t("projectContext.filterPlaceholder")}
        />
      </div>

      {rows.length === 0 ? (
        <p style={s.notice}>{t("projectContext.empty")}</p>
      ) : (
        // Keyed by repository *and* path: the same document may be attached in
        // several repositories, and each of those is its own inert row (AC-50).
        visible.map((row) => (
          <DocRow
            key={row.repoId ? `${row.repoId}:${row.path}` : row.path}
            row={row}
            repoLabel={row.repoId ? repoName(row.repoId) : undefined}
            onToggle={(attached) => toggle(row.path, attached)}
            onPreview={() => setPreview(row.path)}
          />
        ))
      )}

      {/* One banner, two messages: a conflict is reported as a conflict, and
          every other rejection keeps the generic save failure. */}
      {conflict ? (
        <div style={s.error}>{t("projectContext.saveConflict")}</div>
      ) : (
        setAttachments.isError && <div style={s.error}>{t("projectContext.saveFailed")}</div>
      )}

      <SerializedPanel skillId={skill.id} repoId={activeRepoId} />

      {preview && (
        <ContextDocPreview repoId={activeRepoId} path={preview} onClose={() => setPreview(null)} />
      )}
    </Section>
  );
}
