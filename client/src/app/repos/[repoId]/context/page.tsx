/* Route: /repos/:repoId/context — the documents discovered under the
   repository's configured context roots, read-only. Thin by convention: the
   screen's logic lives in _components/ProjectContextView. */
"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ProjectContextView } from "./_components/ProjectContextView";

export default function ProjectContextPage() {
  const t = useTranslations("context");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const notFound = useRepoNotFound(repoId);

  const crumb = [{ label: t("crumb.workspace") }, { label: t("crumb.context") }];

  if (notFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <ProjectContextView repoId={repoId} repoName={activeRepo?.name ?? t("repoFallback")} />
    </AppShell>
  );
}
