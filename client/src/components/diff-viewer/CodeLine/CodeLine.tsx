/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { FindingMark, Severity } from "@devdigest/shared";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor, markChipFor } from "../styles";
import { SEVERITY_LABEL_KEY, SEVERITY_ICON } from "./constants";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  mark,
  onMarkClick,
  ref,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** A finding anchored to this line (Smart Diff); absent renders nothing new. */
  mark?: FindingMark;
  onMarkClick?: (findingId: string) => void;
  /** React 19 ref-as-prop — FileCard attaches this to its scroll-target line
      only, to scroll it into view without a DOM query. */
  ref?: React.Ref<HTMLDivElement>;
}) {
  const t = useTranslations("shell");
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);
  const severityLabelFor = (severity: Severity) => t(SEVERITY_LABEL_KEY[severity]);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;

  return (
    <div
      ref={ref}
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={lineRowFor(ln.kind, mark?.severity)}>
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {mark && (
          // A sibling of the code text, never a child of it: an interactive
          // control nested inside the running text span made a screen reader
          // announce the chip's name interleaved with the code
          // (client/specs/smart-diff-display.md §6, now closed).
          <button
            type="button"
            title={severityLabelFor(mark.severity)}
            aria-label={t("diffViewer.severityFinding", {
              severity: severityLabelFor(mark.severity),
            })}
            onClick={() => onMarkClick?.(mark.finding_id)}
            style={markChipFor(mark.severity)}
          >
            {React.createElement(Icon[SEVERITY_ICON[mark.severity]], { size: 11 })}
            {severityLabelFor(mark.severity)}
          </button>
        )}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
