/* Route: /repos/:repoId/onboarding — the generated five-section tour of the
   repository. Thin by convention: the screen's logic lives in
   _components/OnboardingTourView.

   Not to be confused with /onboarding, which is the add-a-repository screen. */
"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { OnboardingTourView } from "./_components/OnboardingTourView";

export default function OnboardingTourPage() {
  const t = useTranslations("onboarding");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const notFound = useRepoNotFound(repoId);

  const crumb = [{ label: t("crumb.workspace") }, { label: t("crumb.tour") }];

  if (notFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <OnboardingTourView repoId={repoId} repoName={activeRepo?.name ?? "this repository"} />
    </AppShell>
  );
}
