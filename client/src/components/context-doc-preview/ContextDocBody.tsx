/* ContextDocBody — one project-context document, rendered read-only.
   Shared on purpose: the Project Context page reads it inline in its detail
   panel and ContextDocPreview shows the same thing in a modal, so the loading,
   failure and truncation branches exist once. There is no edit path here and
   none is coming — GitClient has no write method and `sync` fast-forwards the
   clone, so a local edit would be destroyed on the next sync (AC-37). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import { useContextDoc } from "@/lib/hooks/project-context";
import { s } from "./styles";

export function ContextDocBody({ repoId, path }: { repoId: string; path: string }) {
  const t = useTranslations("context");
  const doc = useContextDoc(repoId, path);

  if (doc.isLoading) return <Skeleton height={120} />;
  if (doc.isError || !doc.data) {
    return <ErrorState title={t("detail.loadError")} onRetry={() => doc.refetch()} />;
  }

  return (
    <div style={s.body}>
      {/* The 64kb cap is a read-time cap, so what is missing here is missing
          from the prompt too — say so rather than showing a silent stub. */}
      {doc.data.truncated && <p style={s.truncated}>{t("detail.truncated")}</p>}
      <Markdown>{doc.data.content}</Markdown>
    </div>
  );
}
