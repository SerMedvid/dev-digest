/* Route: /repos/:repoId/conventions — extract house conventions from the clone
   and turn the accepted ones into a Skill. Thin by convention: the screen's
   logic lives in _components/ConventionsView. */
"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useRepoIntelStatus } from "@/lib/hooks/repo-intel";
import { ConventionsView } from "./_components/ConventionsView";

export default function ConventionsPage() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const notFound = useRepoNotFound(repoId);
  // `filesIndexed` is the only honest "has an index" signal — the status enum
  // reports how the last run went, not whether anything is stored.
  const indexState = useRepoIntelStatus(repoId);

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  if (notFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <ConventionsView
        repoId={repoId}
        repoName={activeRepo?.name ?? t("page.repoFallback")}
        indexed={(indexState.data?.filesIndexed ?? 0) > 0}
      />
    </AppShell>
  );
}
