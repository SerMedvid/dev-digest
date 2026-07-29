import { SEV, type Severity } from "@devdigest/ui";
import type {
  FindingRecord,
  PrFindingPreview,
  PrFindingsBySeverity,
} from "@devdigest/shared";
import {
  CARD_GAP,
  CARD_MAX_HEIGHT,
  CARD_MIN_HEIGHT,
  CARD_WIDTH,
  EMPTY_COUNTS,
  SEVERITY_ORDER,
  SEVERITY_RANK,
  SEVERITY_RANK_FALLBACK,
  VIEWPORT_MARGIN,
  type CounterSeverity,
} from "./constants";

/**
 * The one row shape the breakdown card renders, whichever surface fed it: the
 * PR list's capped server preview, or a run's full findings derived on the
 * client. `snippet` is already truncated on the list path and clamped visually
 * on both.
 */
export interface BreakdownFinding {
  id: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  confidence: number;
  snippet: string;
}

/** The severities a counter cluster actually shows: non-zero only, most severe
 *  first. An empty result means "render nothing", not "render zeros". */
export function shownSeverities(counts: PrFindingsBySeverity): CounterSeverity[] {
  return SEVERITY_ORDER.filter((sev) => (counts[sev] ?? 0) > 0);
}

/** Severity tokens (colour, icon, label) for a severity the DB stores as plain
 *  text. Anything outside the known set degrades to INFO rather than throwing. */
export function severityMeta(severity: string): (typeof SEV)[Severity] {
  return SEV[severity as Severity] ?? SEV.INFO;
}

/** The card header's total and its "+k more" remainder. `totalOverride` is the
 *  true count when `shown` is a capped preview; without it the rows on screen
 *  are the whole set and nothing is hidden. */
export function previewTotals(
  shown: number,
  totalOverride?: number,
): { total: number; hidden: number } {
  const total = totalOverride ?? shown;
  return { total, hidden: Math.max(0, total - shown) };
}

/** Format a finding's line range ("11" when single-line, else "11-15").
 *  Deliberately a small local copy of FindingCard's helper — this component is
 *  shared across routes and must not import from one of them. */
export function lineLabel(f: Pick<BreakdownFinding, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

/** PR-list path: one server preview row → a card row. */
export function fromPreview(p: PrFindingPreview): BreakdownFinding {
  return {
    id: p.id,
    severity: p.severity,
    category: p.category,
    title: p.title,
    file: p.file,
    start_line: p.start_line,
    end_line: p.end_line,
    confidence: p.confidence,
    snippet: p.rationale_snippet,
  };
}

function rankOf(severity: string): number {
  return SEVERITY_RANK[severity] ?? SEVERITY_RANK_FALLBACK;
}

/**
 * PR-detail path: derive both halves of the breakdown from findings already on
 * the page. Counting matches the server exactly — non-dismissed only, no
 * confidence filter, unrecognised severities counted by neither — and the
 * ordering matches the list preview's (severity rank, then confidence desc) so
 * the same card looks the same on every surface.
 */
export function fromRecords(findings: FindingRecord[]): {
  counts: PrFindingsBySeverity;
  findings: BreakdownFinding[];
} {
  const counts: PrFindingsBySeverity = { ...EMPTY_COUNTS };
  const live = findings.filter(
    (f) => !f.dismissed_at && (SEVERITY_ORDER as readonly string[]).includes(f.severity),
  );
  for (const f of live) counts[f.severity as CounterSeverity] += 1;

  const items = [...live]
    .sort((a, b) => rankOf(a.severity) - rankOf(b.severity) || b.confidence - a.confidence)
    .map((f) => ({
      id: f.id,
      severity: f.severity,
      category: f.category,
      title: f.title,
      file: f.file,
      start_line: f.start_line,
      end_line: f.end_line,
      confidence: f.confidence,
      // Not truncated here: the card clamps it to two lines visually, and the
      // full rationale is already on the page on this surface.
      snippet: f.rationale,
    }));

  return { counts, findings: items };
}

/** Where the card sits, in viewport coordinates. Exactly one of `top`/`bottom`
 *  is set: `bottom` means the card opens upward. */
export interface CardPlacement {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * Pin the card to its trigger in **viewport** coordinates.
 *
 * The card can't be laid out inside its surface: every surface that hosts the
 * widget clips its rounded corners with `overflow: hidden` (the list's table
 * card, the review-run accordion), which would cut the card off at the row's
 * edge. So the card is `position: fixed` and positioned from the trigger's rect
 * — a fixed box's containing block is the viewport, so no ancestor's overflow
 * can clip it.
 *
 * Being viewport-relative means the card also has to stay inside the viewport
 * itself: it flips above the trigger when there isn't room below, gets clamped
 * horizontally, and caps its height to whatever room the chosen side has.
 */
export function cardPlacement(
  trigger: Pick<DOMRect, "top" | "bottom" | "left" | "right">,
  viewport: { width: number; height: number },
  align: "left" | "right",
): CardPlacement {
  const wanted = align === "left" ? trigger.left : trigger.right - CARD_WIDTH;
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(wanted, viewport.width - CARD_WIDTH - VIEWPORT_MARGIN),
  );

  const below = viewport.height - trigger.bottom - CARD_GAP - VIEWPORT_MARGIN;
  const above = trigger.top - CARD_GAP - VIEWPORT_MARGIN;
  const fit = (space: number) => Math.max(CARD_MIN_HEIGHT, Math.min(CARD_MAX_HEIGHT, space));

  // Flip up only when below can't hold the card AND above holds more — a
  // cramped-both-ways viewport keeps the card below and just shrinks it.
  if (below < Math.min(CARD_MAX_HEIGHT, above)) {
    return { left, bottom: viewport.height - trigger.top + CARD_GAP, maxHeight: fit(above) };
  }
  return { left, top: trigger.bottom + CARD_GAP, maxHeight: fit(below) };
}

/** Sum of a counts object — the card header's total and the "has anything at
 *  all?" test the consuming surfaces gate on. */
export function totalOf(counts: PrFindingsBySeverity | null | undefined): number {
  if (!counts) return 0;
  return SEVERITY_ORDER.reduce((n, sev) => n + (counts[sev] ?? 0), 0);
}
