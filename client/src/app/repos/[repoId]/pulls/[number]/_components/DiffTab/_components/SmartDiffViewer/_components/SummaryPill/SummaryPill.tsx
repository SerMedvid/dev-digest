/* SummaryPill — the ✨ per-file "what does this do?" button, rendered into
   FileCard's `headerExtra` slot. An explicit click, never automatic: viewing
   Smart Diff must never call a model (design §5, §6.1). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { notify } from "@/lib/toast";
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
      // Same toast pattern DiffTab's own comment-post failure uses — the
      // summary endpoint has no i18n error catalogue entry of its own,
      // just like that one doesn't.
      notify.error(err instanceof Error ? err.message : "Couldn't summarize this file.");
    } finally {
      setPending(false);
    }
  };

  return (
    <button type="button" onClick={handleClick} disabled={pending} style={s.pill}>
      {pending ? t("smartDiff.summarizing") : t("smartDiff.summarize")}
    </button>
  );
}
