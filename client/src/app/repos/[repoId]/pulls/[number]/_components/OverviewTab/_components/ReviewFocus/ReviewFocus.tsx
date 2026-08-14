"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Badge } from "@devdigest/ui";
import type { ReviewFocusItem } from "@devdigest/shared";
import { fileAnchorId } from "@/components/diff-viewer";
import { s } from "./styles";

interface ReviewFocusProps {
  items: ReviewFocusItem[] | null | undefined;
  /** Paths the diff actually renders. A file absent from it is not clickable. */
  diffPaths: string[];
  /** Switches the page's `?tab=`; the page owns navigation. */
  onSetTab: (tab: string) => void;
}

/**
 * "Read these first" — the brief's ordered list, at the foot of the overview.
 *
 * Order is the content: the server asked the model to rank by where a mistake
 * would be most expensive, so the list is rendered in the order it arrived and
 * numbered, never re-sorted by path.
 *
 * `line` appears only when it is not null. A null line is not missing data — it
 * means no finding vouched for a line on that file, and printing `:0` or
 * guessing one would undo the grounding gate on the client.
 */
export function ReviewFocus({ items, diffPaths, onSetTab }: ReviewFocusProps) {
  const t = useTranslations("brief");
  if (!items || items.length === 0) return null;

  const rendered = new Set(diffPaths);

  // Switch the tab first, then scroll: the diff is not mounted until the tab
  // changes, so the element does not exist on this frame. One frame is enough
  // for React to commit the new tab; without the deferral the lookup misses and
  // the click silently does nothing.
  const jump = (file: string) => {
    onSetTab("diff");
    requestAnimationFrame(() => {
      document
        .getElementById(fileAnchorId(file))
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return (
    <section>
      <SectionLabel
        icon="Eye"
        right={<Badge color="var(--text-secondary)">{t("focusCount", { count: items.length })}</Badge>}
      >
        {t("focusTitle")}
      </SectionLabel>
      <ul style={s.list}>
        {items.map((item, i) => {
          const label = item.line != null ? `${item.file}:${item.line}` : item.file;
          // A file the current diff does not render is shown unlinked rather
          // than as a control that scrolls nowhere — the brief is served at the
          // PR's head, but the Files tab can be filtered or the row missing.
          const clickable = rendered.has(item.file);
          return (
            <li key={`${item.file}:${item.line ?? "none"}`} style={s.row}>
              {clickable ? (
                <button type="button" style={s.button} onClick={() => jump(item.file)}>
                  <span style={s.ordinal}>{i + 1}</span>
                  <span style={s.path}>{label}</span>
                  <span style={s.reason}>{item.reason}</span>
                </button>
              ) : (
                <div style={s.staticRow}>
                  <span style={s.ordinal}>{i + 1}</span>
                  <span style={s.pathPlain}>{label}</span>
                  <span style={s.reason}>{item.reason}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
