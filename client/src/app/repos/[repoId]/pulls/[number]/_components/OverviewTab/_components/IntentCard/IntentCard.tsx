"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Skeleton, Icon } from "@devdigest/ui";
import { usePrIntent, useDeriveIntent } from "@/lib/hooks/intent";
import { ApiError } from "@/lib/api";
import type { BriefRisk } from "@devdigest/shared";
import { RiskAreas } from "./_components/RiskAreas";
import { isStale, sourceLine } from "./helpers";
import { s, badgeConfidence } from "./styles";

interface IntentCardProps {
  prId: string | null;
  /** The PR's current head commit — an intent derived against another is stale. */
  headSha: string;
  /**
   * The brief's risk areas (L05), rendered below the scope lists.
   *
   * Passed in rather than fetched: `OverviewTab` owns the one `usePrBrief`
   * call, so the card stays presentational and the overview makes one query
   * for the three places the brief appears.
   */
  risks?: BriefRisk[] | null;
}

/**
 * What the system thinks this PR is for, above the review results, so the user
 * can check the understanding before spending a review on it. The source line
 * and the confidence badge are the point: a conclusion without its evidence is
 * not checkable.
 */
export function IntentCard({ prId, headSha, risks }: IntentCardProps) {
  const t = useTranslations("prReview");
  const { data, isLoading, isError, error, refetch, isFetching } = usePrIntent(prId);
  const derive = useDeriveIntent(prId);

  // A failed derivation has to say so. The button re-enables the moment the
  // mutation settles, so without this a 409 ("a derivation is already running",
  // which a concurrent review batch really does produce) or a 500 looks exactly
  // like a click that did nothing — and the user clicks again. The server's own
  // message is the useful one for an ApiError, same as the load-error branch
  // below; the catalogue string is only for a failure that carries none.
  const deriveError = derive.isError
    ? derive.error instanceof ApiError
      ? derive.error.message
      : t("intent.deriveError")
    : null;

  /**
   * The intent's own content, in two slots with `RiskAreas` between them.
   *
   * The branches below are the whole point of the split. The risks come from
   * the BRIEF, not from this query — they are drawn in this card only because
   * "what this PR is for" and "what could go wrong with it" read as one card —
   * so rendering them *inside* a branch made them hostage to `usePrIntent`: a
   * failed read, or an intent that goes away, unmounted `RiskAreas` and took
   * its expanded row with it, silently undoing the reader's click. Returning
   * head/foot instead keeps `RiskAreas` a fixed sibling at the same position in
   * every branch, so it is never remounted and never loses its open row.
   */
  function intentSlots(): { head: React.ReactNode; foot: React.ReactNode } {
    if (isLoading) {
      // Matches the card's own footprint (border/padding/heading) rather than
      // rendering nothing, so the page doesn't blank-then-shift once data lands.
      return {
        head: (
          <>
            <SectionLabel icon="Target">{t("intent.title")}</SectionLabel>
            <Skeleton height={14} width="55%" />
            <Skeleton height={64} />
          </>
        ),
        foot: null,
      };
    }

    if (isError) {
      return {
        head: (
          <>
            <SectionLabel icon="Target">{t("intent.title")}</SectionLabel>
            <div style={s.warning}>
              {error instanceof ApiError ? error.message : t("intent.loadError")}
            </div>
            {/* The GET failed — retry the GET. `derive.mutate()` here would answer
                a failed read with a paid POST classification, which is not what
                the user asked for and costs a model call every click. */}
            <Button onClick={() => void refetch()} disabled={isFetching}>
              {t("intent.retry")}
            </Button>
          </>
        ),
        foot: null,
      };
    }

    if (!data) {
      return {
        head: (
          <>
            <SectionLabel icon="Target">{t("intent.title")}</SectionLabel>
            <div style={s.meta}>{t("intent.empty")}</div>
            {deriveError && (
              <div style={s.warning} role="alert">
                {deriveError}
              </div>
            )}
            <Button onClick={() => derive.mutate()} disabled={derive.isPending}>
              {derive.isPending ? t("intent.deriving") : t("intent.derive")}
            </Button>
          </>
        ),
        foot: null,
      };
    }

    const stale = isStale(data, headSha);
    const confidenceLevel = t(`intent.confidence.${data.confidence}`);

    return {
      head: (
        <>
          {/* The action rides in the heading's `right` slot, same as DiffTab's —
              it is the card's one action, and at the bottom it sat behind a
              variable-length list of sources and had to be hunted for. */}
          <SectionLabel
            icon="Target"
            right={
              <Button
                kind="ghost"
                size="sm"
                icon="RefreshCw"
                onClick={() => derive.mutate()}
                disabled={derive.isPending}
              >
                {derive.isPending
                  ? t("intent.deriving")
                  : stale
                    ? t("intent.reDerive")
                    : t("intent.refresh")}
              </Button>
            }
          >
            {t("intent.title")}
          </SectionLabel>

          {/* Directly under the button that produces it. At the foot of the card
              it would be a screen away from the control the user just clicked. */}
          {deriveError && (
            <div style={s.warning} role="alert">
              {deriveError}
            </div>
          )}

          <p style={s.statement}>“{data.intent}”</p>

          <div style={s.columns}>
            <div>
              <div style={{ ...s.listHeading, ...s.inScopeHeading }}>
                <Icon.Check size={12} />
                {t("intent.inScope")}
              </div>
              {data.in_scope.length > 0 ? (
                <ul style={s.list}>
                  {data.in_scope.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p style={s.emptyNote}>{t("intent.noneSpecified")}</p>
              )}
            </div>
            <div>
              <div style={{ ...s.listHeading, ...s.outOfScopeHeading }}>
                <Icon.X size={12} />
                {t("intent.outOfScope")}
              </div>
              {data.out_of_scope.length > 0 ? (
                <ul style={s.list}>
                  {data.out_of_scope.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p style={s.emptyNote}>{t("intent.noneSpecified")}</p>
              )}
            </div>
          </div>
        </>
      ),
      foot: (
        <>
          {data.missing_context.length > 0 && (
            <ul style={s.warning}>
              {data.missing_context.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}

          {stale && <div style={s.warning}>{t("intent.stale")}</div>}

          <div style={s.meta}>
            {/* The colour is redundant with the label, never a replacement for it —
                the design system's own rule for severity badges (WCAG AA: never
                colour alone), and the reason the level stays spelled out. */}
            <span
              style={{ ...s.badge, ...badgeConfidence[data.confidence] }}
              title={t(`intent.confidenceHint.${data.confidence}`)}
            >
              <span style={s.badgeDot} />
              {t("intent.confidenceLabel", { level: confidenceLevel })}
            </span>
            <span>
              {t("intent.from", {
                sources: sourceLine(data.sources, (tag) => t(`intent.source.${tag}`)),
              })}
            </span>
            <span>{data.model}</span>
          </div>
        </>
      ),
    };
  }

  const { head, foot } = intentSlots();

  return (
    // Exactly three children in every branch — `foot` is null rather than
    // absent — so `RiskAreas` holds index 1 whatever the intent query does.
    // React matches children by position, and a shifting position is a remount.
    <section style={s.card}>
      {head}
      <RiskAreas risks={risks} />
      {foot}
    </section>
  );
}
