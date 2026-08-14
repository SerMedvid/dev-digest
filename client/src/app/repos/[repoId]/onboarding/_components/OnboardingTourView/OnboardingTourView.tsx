/* OnboardingTourView — the generated five-section tour of an unfamiliar repo.

   Two things here are decisions, not omissions:

   The screen never sorts, filters or renumbers `sections` or the files inside
   them. Their order is the server's — reading path is file-rank order, which is
   the entire premise of that section — so a client-side sort would silently
   replace the feature with a different one.

   A regeneration keeps the previous tour on screen. The server preserves the
   old sections under a `running` status precisely so this screen can, and
   blanking the page for the length of an LLM call would be a worse trade than
   showing a tour that is one commit stale for thirty seconds.

   `Share link` copies the page URL. There is no token, no unauthenticated
   route: publishing a repo tour to anyone holding a link is an authorization
   surface this feature did not ask for. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { useGenerateOnboarding, useOnboardingTour } from "@/lib/hooks/onboarding";
import { SectionCard } from "./_components/SectionCard";
import { TourToc } from "./_components/TourToc";
import { COPIED_MS } from "./constants";
import { anchorFor, relativeTime } from "./helpers";
import { s } from "./styles";

export function OnboardingTourView({ repoId, repoName }: { repoId: string; repoName: string }) {
  const t = useTranslations("onboarding");
  const tour = useOnboardingTour(repoId);
  const generate = useGenerateOnboarding(repoId);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const data = tour.data;
  const sections = data?.sections ?? [];
  const running = data?.status === "running";

  function scrollTo(sectionId: string) {
    setActiveId(sectionId);
    document.getElementById(anchorFor(sectionId))?.scrollIntoView({ behavior: "smooth" });
  }

  async function share() {
    try {
      await navigator.clipboard?.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      /* clipboard blocked (insecure origin, denied permission) — no-op */
    }
  }

  if (tour.isLoading) {
    return (
      <div style={s.page}>
        <div style={s.main}>
          <div style={s.column}>
            <Skeleton height={140} />
          </div>
        </div>
      </div>
    );
  }

  if (tour.isError || !data) {
    return (
      <div style={s.page}>
        <div style={s.main}>
          <div style={s.column}>
            <ErrorState title={t("loadError.title")} />
          </div>
        </div>
      </div>
    );
  }

  /* Nothing generated yet. An unindexed repo gets a different explanation and a
     disabled button: the tour is built from file ranks, so there is genuinely
     nothing to generate from, and offering the action anyway would just queue a
     job that fails. */
  if (data.status === "empty") {
    const notIndexed = data.reason === "not_indexed";
    return (
      <div style={s.page}>
        <div style={s.main}>
          <div style={s.centred}>
            <div style={s.gate}>
              <h2 style={s.gateTitle}>
                {notIndexed ? t("notIndexed.title") : t("generate.title")}
              </h2>
              <p style={s.gateBody}>{notIndexed ? t("notIndexed.body") : t("generate.body")}</p>
              <Button
                onClick={() => generate.mutate()}
                disabled={notIndexed || generate.isPending}
              >
                {generate.isPending ? t("generate.generating") : t("generate.cta")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* A first generation has nothing to keep on screen — no header stamp worth
     printing, no sections to navigate — so it is a skeleton rather than an
     empty frame. A REgeneration takes the branch below instead and keeps the
     previous tour up. */
  if (running && sections.length === 0) {
    return (
      <div style={s.page}>
        <div style={s.main}>
          <div style={s.column} data-testid="tour-skeleton">
            <p style={s.subtitle}>{t("generate.generating")}</p>
            <Skeleton height={120} />
            <Skeleton height={180} />
          </div>
        </div>
      </div>
    );
  }

  /* A failure with no previous tour is the whole screen. With one, the error
     rides above the tour that is still readable. */
  const failedBanner =
    data.status === "failed" ? (
      <div style={s.centred}>
        <div style={s.gate}>
          <h2 style={s.gateTitle}>{t("failed.title")}</h2>
          {data.error ? <p style={s.errorText}>{data.error}</p> : null}
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
            {t("failed.retry")}
          </Button>
        </div>
      </div>
    ) : null;

  if (failedBanner && sections.length === 0) {
    return (
      <div style={s.page}>
        <div style={s.main}>{failedBanner}</div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <TourToc sections={sections} activeId={activeId} onSelect={scrollTo} />

      <div style={s.main}>
        <div style={s.column}>
          <header>
            <div style={s.head}>
              <h1 style={s.title}>
                {t.rich("title", {
                  repo: () => (
                    <span className="mono" style={s.titleRepo}>
                      {repoName}
                    </span>
                  ),
                })}
              </h1>
              <div style={s.headActions}>
                <Button
                  kind="secondary"
                  icon="RefreshCw"
                  loading={running || generate.isPending}
                  onClick={() => generate.mutate()}
                  disabled={running || generate.isPending}
                >
                  {running ? t("regenerating") : t("regenerate")}
                </Button>
                <Button kind="secondary" icon="Link" onClick={share}>
                  {copied ? t("linkCopied") : t("shareLink")}
                </Button>
              </div>
            </div>

            <p style={s.subtitle}>
              {data.generatedAt
                ? t("subtitle", {
                    count: data.indexedFiles,
                    when: relativeTime(data.generatedAt),
                  })
                : t("subtitleNever", { count: data.indexedFiles })}
            </p>

            {data.stale ? (
              <div style={s.staleRow}>
                <Badge icon="AlertTriangle" color="var(--warning, #f59e0b)">
                  {t("stale")}
                </Badge>
              </div>
            ) : null}
          </header>

          {failedBanner}

          {sections.map((section) => (
            <SectionCard key={section.id} section={section} />
          ))}
        </div>
      </div>
    </div>
  );
}
