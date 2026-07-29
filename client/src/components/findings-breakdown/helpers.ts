import type {
  FindingRecord,
  PrFindingPreview,
  PrFindingsBySeverity,
} from "@devdigest/shared";
import {
  EMPTY_COUNTS,
  SEVERITY_ORDER,
  SEVERITY_RANK,
  SEVERITY_RANK_FALLBACK,
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

/** Sum of a counts object — the card header's total and the "has anything at
 *  all?" test the consuming surfaces gate on. */
export function totalOf(counts: PrFindingsBySeverity | null | undefined): number {
  if (!counts) return 0;
  return SEVERITY_ORDER.reduce((n, sev) => n + (counts[sev] ?? 0), 0);
}
