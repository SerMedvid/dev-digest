/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments.

   Every prop below is optional and, absent, the render is unchanged from the
   base diff viewer — Smart Diff (Task 8) is the only consumer that passes
   them, and its `?order=original` fallback depends on that being true. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { FindingMark } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

/** A mark anchors to the new-side line it names — never a deleted line, which
    has no `newNo`. */
function markForLine(ln: Line, marks: FindingMark[] | undefined): FindingMark | undefined {
  if (!marks || marks.length === 0 || ln.kind === "del" || ln.newNo == null) return undefined;
  return marks.find((m) => m.line === ln.newNo);
}

export function FileCard({
  file,
  commenting,
  open: openProp,
  onToggle,
  marks,
  onMarkClick,
  scrollToLine,
  headerExtra,
  preBody,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  /** Controlled open state. Omit both this and `onToggle` for the original
      uncontrolled behaviour (auto-expand under `AUTO_EXPAND_MAX_LINES`, toggled
      by clicking the header). */
  open?: boolean;
  onToggle?: () => void;
  /** Finding markers to render inline (Smart Diff). */
  marks?: FindingMark[];
  onMarkClick?: (findingId: string) => void;
  /** New-side line number to scroll into view once, while open. Fires at most
      once per distinct value — see the scroll effect below. */
  scrollToLine?: number | null;
  /** Rendered in the header, after the +/- stat (the Smart Diff summary pill). */
  headerExtra?: React.ReactNode;
  /** Rendered above the lines, only while open (the Smart Diff "What this does" line). */
  preBody?: React.ReactNode;
}) {
  const t = useTranslations("shell");
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : uncontrolledOpen;
  const toggle = () => {
    if (isControlled) onToggle?.();
    else setUncontrolledOpen((o) => !o);
  };

  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  // scrollToLine is one-shot per distinct value, not per render: the effect
  // re-runs whenever `lines` gets a new identity (a Smart Diff refetch hands
  // FileCard a brand-new `file` prop) or `open` flips, but a ref latch —
  // rather than just comparing the prop — stops it from replaying the jump
  // once that value has already been handled. See client/INSIGHTS.md
  // (2026-08-02) for the equivalent bug this pattern avoids elsewhere.
  const scrolledToRef = React.useRef<number | null>(null);
  const lineElsRef = React.useRef(new Map<number, HTMLDivElement | null>());
  React.useEffect(() => {
    if (scrollToLine == null || !open) return;
    if (scrolledToRef.current === scrollToLine) return;
    const el = lineElsRef.current.get(scrollToLine);
    if (el) {
      el.scrollIntoView({ block: "center" });
      scrolledToRef.current = scrollToLine;
    }
  }, [scrollToLine, open, lines]);

  return (
    <div style={s.fileCard}>
      <div onClick={toggle} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {headerExtra}
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {preBody}
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => {
              const isScrollTarget =
                scrollToLine != null && ln.kind !== "del" && ln.newNo === scrollToLine;
              return (
                <CodeLine
                  key={i}
                  ln={ln}
                  path={file.path}
                  threads={threadsForLine(ln, matched)}
                  commenting={commenting}
                  mark={markForLine(ln, marks)}
                  onMarkClick={onMarkClick}
                  ref={
                    isScrollTarget
                      ? (el: HTMLDivElement | null) => {
                          lineElsRef.current.set(scrollToLine, el);
                        }
                      : undefined
                  }
                />
              );
            })
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
