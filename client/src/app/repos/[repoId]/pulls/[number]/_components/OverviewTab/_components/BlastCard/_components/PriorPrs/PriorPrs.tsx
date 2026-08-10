"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Skeleton } from "@devdigest/ui";
import { usePriorPrs } from "@/lib/hooks/blast";
import { githubPrUrl } from "@/lib/github-urls";
import { s } from "./styles";

interface PriorPrsProps {
  prId: string | null;
  /** `null` when the repo is unknown; rows then render as plain text. */
  repoFullName: string | null;
}

/**
 * Which merged or closed PRs have already been in these files.
 *
 * Fetches on its own rather than taking data from `BlastCard`: this is a
 * secondary read beside the map, and a failure here must never take the map
 * down. It reads no code index, so it is equally valid on a degraded map.
 *
 * Collapsible, open on mount. The header is a real `<button aria-expanded>`
 * controlling the body by id — the same disclosure `SymbolRow` uses — so a long
 * history can be folded away without leaving the section invisible. Collapsing
 * hides the list and its `uncomparable_prs` note together, which is what keeps
 * the pairing honest: an empty list is never on screen without its caveat.
 */
export function PriorPrs({ prId, repoFullName }: PriorPrsProps) {
  const t = useTranslations("blast");
  const { data, isLoading, isError } = usePriorPrs(prId);
  const [open, setOpen] = React.useState(true);

  // Guarded on `prs` rather than on `data` alone: a secondary read is exactly
  // the one whose payload can arrive shaped wrong, and this section rendering
  // nothing is always preferable to it throwing inside the card.
  const prs = data?.prs;
  const bodyId = "blast-prior-prs-body";
  const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;

  return (
    <div style={s.block}>
      <button
        type="button"
        style={s.header}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <Chevron size={14} style={s.chevron} />
        <span style={s.title}>{t("priorPrs.title")}</span>
        {/* The count rides on the header so the collapsed state still says how
            much is folded away, rather than reading as an empty section. */}
        {prs && prs.length > 0 && (
          <span style={s.count}>{t("priorPrs.count", { count: prs.length })}</span>
        )}
      </button>

      {open && (
        <div id={bodyId} style={s.body}>
          {isLoading && <Skeleton height={14} width="60%" />}

          {/* Inline and muted — never an ErrorState, never a Retry. A failed
              secondary read must not look like the card failed. */}
          {isError && <p style={s.note}>{t("priorPrs.error")}</p>}

          {prs && prs.length > 0 && (
            <ul style={s.list}>
              {prs.map((pr) => {
                const href = repoFullName ? githubPrUrl(repoFullName, pr.number) : null;
                const label = (
                  <>
                    <span style={s.number}>#{pr.number}</span>
                    <span style={s.title2}>{pr.title}</span>
                  </>
                );
                return (
                  <li key={pr.number} style={s.row}>
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" style={s.row}>
                        {label}
                      </a>
                    ) : (
                      label
                    )}
                    <span style={s.meta}>
                      {t("priorPrs.overlap", { count: pr.overlap_count })} · {pr.author}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {/* An empty list is only honest next to what could not be compared:
              `pr_files` is populated by opening a PR, so PRs nobody opened are
              invisible to the query. */}
          {prs && prs.length === 0 && data.uncomparable_prs === 0 && (
            <p style={s.note}>{t("priorPrs.empty")}</p>
          )}
          {prs && data.uncomparable_prs > 0 && (
            <p style={s.note}>{t("priorPrs.incomplete", { count: data.uncomparable_prs })}</p>
          )}
        </div>
      )}
    </div>
  );
}
