/* FindingsBreakdown — per-severity findings counters plus the click-to-open
   card that lists the findings behind them. One component for all three
   surfaces (PR list column, run timeline, review-run accordion headers), so the
   same counts always render the same way.

   Two things are load-bearing:
   - The whole widget swallows clicks. Every surface it sits on is itself
     clickable (a row that navigates, a header that toggles), and opening the
     card must never also fire that.
   - Severity is never colour alone — badges and rows pair the icon with a
     count, matching the SeverityBadge convention. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  ConfidenceNum,
  SEV,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { PrFindingsBySeverity } from "@devdigest/shared";
import { SEVERITY_ORDER } from "./constants";
import { lineLabel, totalOf, type BreakdownFinding } from "./helpers";
import { s } from "./styles";

/** The badge cluster on its own — presentational, no card, no interaction.
 *  Renders nothing when every severity is zero. */
export function SeverityCounters({ counts }: { counts: PrFindingsBySeverity }) {
  const shown = SEVERITY_ORDER.filter((sev) => (counts[sev] ?? 0) > 0);
  if (shown.length === 0) return null;
  return (
    <span style={s.counters}>
      {shown.map((sev) => (
        <SeverityBadge key={sev} severity={sev as Severity} count={counts[sev]} compact />
      ))}
    </span>
  );
}

function FindingRow({ f }: { f: BreakdownFinding }) {
  const sev = SEV[f.severity as Severity] ?? SEV.INFO;
  const SevIcon = Icon[sev.icon];
  return (
    <div style={s.findingRow}>
      <SevIcon size={13} style={s.sevIcon(sev.c)} />
      <div style={s.findingMain}>
        <div style={s.titleRow}>
          <span style={s.title}>{f.title}</span>
          {/* Renders nothing for a category outside the known set. */}
          <CategoryTag category={f.category as Category} />
        </div>
        <div style={s.metaRow}>
          <span className="mono" style={s.location}>
            {f.file}:{lineLabel(f)}
          </span>
          <ConfidenceNum value={f.confidence} />
        </div>
        {f.snippet && <div style={s.snippet}>{f.snippet}</div>}
      </div>
    </div>
  );
}

export function FindingsBreakdown({
  counts,
  findings,
  align = "left",
  totalOverride,
}: {
  counts: PrFindingsBySeverity;
  findings: BreakdownFinding[];
  /** Which edge of the trigger the card aligns to. */
  align?: "left" | "right";
  /** Header total when `findings` is a capped preview rather than the full set. */
  totalOverride?: number;
}) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState(false);
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

  const total = totalOverride ?? findings.length;
  const hidden = Math.max(0, total - findings.length);

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
        onClick={() => setOpen((o) => !o)}
        style={s.trigger}
      >
        <SeverityCounters counts={counts} />
      </button>

      {open && (
        <div role="dialog" aria-label={t("findings.openBreakdown")} style={s.card(align)}>
          <div style={s.cardHeader}>{t("findings.header", { count: total })}</div>
          {findings.map((f) => (
            <FindingRow key={f.id} f={f} />
          ))}
          {hidden > 0 && <div style={s.footer}>{t("findings.more", { count: hidden })}</div>}
        </div>
      )}
    </div>
  );
}

export default FindingsBreakdown;
