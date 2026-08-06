/* SummaryPill — the per-file "what does this do?" button, rendered into
   FileCard's `headerExtra` slot. An explicit click, never automatic: viewing
   Smart Diff must never call a model (design §5, §6.1). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { notify } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import { s } from "./styles";

interface SummaryPillProps {
  path: string;
  onSummarize: (path: string) => Promise<unknown>;
}

/**
 * Tracks its own pending state rather than the shared `useFileSummary`
 * mutation's `isPending`: one mutation instance backs every file's pill, and
 * with react-query 5.62 `isPending` reflects only the *latest* call
 * (client/INSIGHTS.md 2026-08-03) — reading it here would make every other
 * file's pill flash "Summarizing…" the moment a different file's request
 * lands. Local state keyed to this one path avoids that entirely.
 */
export function SummaryPill({ path, onSummarize }: SummaryPillProps) {
  const t = useTranslations("prReview");
  const [pending, setPending] = React.useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    // The header row above this button toggles the file open on click.
    e.stopPropagation();
    setPending(true);
    try {
      await onSummarize(path);
    } catch (err) {
      // A file whose diff was never fetched or stored (GitHub omits `patch`
      // for large/binary files; most seeded rows have none) 404s server-side
      // before any model call — the honest message is that there's nothing to
      // summarize, not a generic failure. Every other failure keeps the same
      // toast pattern DiffTab's own comment-post failure uses — the summary
      // endpoint has no broader i18n error catalogue of its own, just like
      // that one doesn't.
      const message =
        err instanceof ApiError && err.status === 404
          ? t("smartDiff.noStoredDiff")
          : err instanceof Error
            ? err.message
            : "Couldn't summarize this file.";
      notify.error(message);
    } finally {
      setPending(false);
    }
  };

  return (
    // The sparkle is the design system's lucide `Sparkles`, the same icon the
    // agents page badges an AI-backed thing with — not an emoji in the message
    // catalogue, which renders at the mercy of the platform's emoji font.
    <button type="button" onClick={handleClick} disabled={pending} style={s.pill}>
      <Icon.Sparkles size={12} />
      {pending ? t("smartDiff.summarizing") : t("smartDiff.summarize")}
    </button>
  );
}
