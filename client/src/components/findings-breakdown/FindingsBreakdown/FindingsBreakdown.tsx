/* FindingsBreakdown — per-severity findings counters plus the click-to-open
   card that lists the findings behind them. One component for all three
   surfaces (PR list column, run timeline, review-run accordion headers), so the
   same counts always render the same way.

   Two things are load-bearing:
   - The whole widget swallows clicks. Every surface it sits on is itself
     clickable (a row that navigates, a header that toggles), and opening the
     card must never also fire that.
   - The card is pinned in viewport coordinates, not laid out in the row. Every
     host surface clips its rounded corners with `overflow: hidden`, which cuts
     an absolutely-positioned card off at the row's edge. See `cardPlacement`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFindingsBySeverity } from "@devdigest/shared";
import { githubPrFilesUrl } from "@/lib/github-urls";
import { FindingRow } from "../FindingRow";
import { SeverityCounters } from "../SeverityCounters";
import { useDiffAnchors } from "../hooks";
import {
  cardPlacement,
  previewTotals,
  totalOf,
  type BreakdownFinding,
  type CardPlacement,
} from "../helpers";
import { s } from "../styles";

export function FindingsBreakdown({
  counts,
  findings,
  align = "left",
  totalOverride,
  link,
  onOpenFinding,
}: {
  counts: PrFindingsBySeverity;
  findings: BreakdownFinding[];
  /** Which edge of the trigger the card aligns to. */
  align?: "left" | "right";
  /** Header total when `findings` is a capped preview rather than the full set. */
  totalOverride?: number;
  /** Enables the rows' file links. Omitted (or before the repo has loaded) the
   *  file:line stays plain text — every surface must survive not knowing this. */
  link?: { repoFullName: string; prNumber: number };
  /** Enables the rows' title jump. The surface decides what "go there" means:
   *  a route push from the list, an in-page scroll on the PR detail page. */
  onOpenFinding?: (findingId: string) => void;
}) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [placement, setPlacement] = React.useState<CardPlacement | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  // Outside-click close, same mechanism as the vendored Dropdown. It also gives
  // "at most one card open at a time" for free: opening a second one mousedowns
  // outside the first.
  React.useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const reposition = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    setPlacement(
      cardPlacement(
        el.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        align,
      ),
    );
  }, [align]);

  // The card is pinned in viewport coordinates (see `cardPlacement`), so it has
  // to be re-measured whenever the trigger moves under it. Scroll is captured,
  // not bubbled: the surfaces scroll inside `<main overflow:auto>`, and a
  // descendant scroller's scroll event never reaches window on the bubble path.
  React.useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  const { total, hidden } = previewTotals(findings.length, totalOverride);

  // Digests are only worth computing for a card the user actually opened, and
  // only when there's a repo to build a URL against.
  const anchors = useDiffAnchors(
    findings.map((f) => f.file),
    open && !!link,
  );

  // Closing first keeps the card from hanging over whatever we just jumped to —
  // on the PR detail surfaces the destination is right underneath it.
  const openFinding = onOpenFinding
    ? (id: string) => {
        setOpen(false);
        onOpenFinding(id);
      }
    : undefined;

  if (totalOf(counts) === 0) return null;

  return (
    <div
      ref={rootRef}
      style={s.root}
      // Covers the trigger, the card, AND the click a keyboard Enter/Space
      // synthesizes on the button — so the row/header underneath never fires.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (!open) return;
          e.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
          return;
        }
        // Enter/Space activate the surface underneath (the accordion header is
        // a role="button"); the native trigger already handles them. Only these
        // are swallowed — global shortcuts still reach the document.
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("findings.openBreakdown")}
        // Measured before the open commit, so the card's first paint is already
        // in the right place.
        onClick={() => {
          if (!open) reposition();
          setOpen(!open);
        }}
        // Hover lives here rather than on the cluster: this is the click target,
        // so its padding has to count as hovering the badges too.
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={s.trigger}
      >
        <SeverityCounters counts={counts} hovered={hovered} />
      </button>

      {open && placement && (
        <div role="dialog" aria-label={t("findings.openBreakdown")} style={s.card(placement)}>
          <div style={s.cardHeader}>{t("findings.header", { count: total })}</div>
          {findings.map((f) => (
            <FindingRow
              key={f.id}
              f={f}
              // Un-anchored until the digest lands (and permanently without
              // SubtleCrypto) — still the right diff, just not scrolled.
              href={
                link
                  ? githubPrFilesUrl(
                      link.repoFullName,
                      link.prNumber,
                      anchors[f.file],
                      f.start_line,
                      f.end_line,
                    )
                  : undefined
              }
              onOpen={openFinding}
            />
          ))}
          {hidden > 0 && <div style={s.footer}>{t("findings.more", { count: hidden })}</div>}
        </div>
      )}
    </div>
  );
}

export default FindingsBreakdown;
