import type {
  ConventionRef,
  ConventionStatus,
  ConventionsRef,
  FindingRef,
  ReviewRef,
  Severity,
} from './types.js';

export type Format = 'concise' | 'detailed';

/** What the model actually sees. Anything not listed here never leaves. */
export interface CompactFinding {
  severity: Severity;
  category: string;
  title: string;
  file: string;
  /** "10" for a single line, "10-24" for a range. */
  lines: string;
  rationale?: string;
  suggestion?: string;
  confidence?: number;
}

export interface SeverityCounts {
  CRITICAL: number;
  WARNING: number;
  SUGGESTION: number;
}

export interface FindingsProjection {
  verdict: string;
  score: number | null;
  agents: string[];
  counts: SeverityCounts;
  findings: CompactFinding[];
  total: number;
  shown: number;
  note?: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

/** Worst wins: a single request_changes decides the PR. */
const VERDICT_ORDER = ['request_changes', 'comment', 'approve'];

function lineRange(f: FindingRef): string {
  return f.start_line === f.end_line ? String(f.start_line) : `${f.start_line}-${f.end_line}`;
}

function compact(f: FindingRef, format: Format): CompactFinding {
  const base: CompactFinding = {
    severity: f.severity,
    category: f.category,
    title: f.title,
    file: f.file,
    lines: lineRange(f),
  };
  if (format === 'concise') return base;
  return {
    ...base,
    rationale: f.rationale,
    suggestion: f.suggestion ?? undefined,
    confidence: f.confidence,
  };
}

export function projectFindings(
  reviews: ReviewRef[],
  opts: { format: Format; limit: number; severity?: Severity; agentName?: string },
): FindingsProjection {
  const wantedAgent = opts.agentName?.trim().toLowerCase();
  const scoped = wantedAgent
    ? reviews.filter((r) => (r.agent_name ?? '').toLowerCase() === wantedAgent)
    : reviews;

  const live = scoped
    .flatMap((r) => r.findings)
    .filter((f) => f.dismissed_at === null)
    .filter((f) => (opts.severity ? f.severity === opts.severity : true));

  const counts: SeverityCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of live) counts[f.severity] += 1;

  const sorted = [...live].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const shown = sorted.slice(0, opts.limit);

  const verdicts = scoped.map((r) => r.verdict).filter((v): v is string => v !== null);
  const verdict =
    scoped.length === 0
      ? 'no_reviews'
      : (VERDICT_ORDER.find((v) => verdicts.includes(v)) ?? verdicts[0] ?? 'unknown');

  const scores = scoped.map((r) => r.score).filter((s): s is number => s !== null);

  const projection: FindingsProjection = {
    verdict,
    score: scores.length > 0 ? Math.min(...scores) : null,
    agents: scoped.map((r) => r.agent_name ?? 'unknown'),
    counts,
    findings: shown.map((f) => compact(f, opts.format)),
    total: live.length,
    shown: shown.length,
  };

  if (live.length > shown.length) {
    projection.note =
      `Showing ${shown.length} of ${live.length} findings. ` +
      `Narrow with the severity argument (CRITICAL first) or raise limit.`;
  }
  return projection;
}

export interface CompactConvention {
  category: string;
  rule: string;
}

export interface ConventionsProjection {
  scan_status: string;
  conventions: CompactConvention[];
  total: number;
  shown: number;
  note?: string;
}

export function projectConventions(
  view: ConventionsRef,
  opts: { limit: number; status: ConventionStatus | 'all'; category?: string },
): ConventionsProjection {
  const wantedCategory = opts.category?.trim().toLowerCase();
  const matching = view.candidates
    .filter((c: ConventionRef) => (opts.status === 'all' ? true : c.status === opts.status))
    .filter((c) => (wantedCategory ? c.category.toLowerCase() === wantedCategory : true));

  const shown = matching.slice(0, opts.limit);

  const projection: ConventionsProjection = {
    scan_status: view.scan ? view.scan.status : 'never_scanned',
    conventions: shown.map((c) => ({ category: c.category, rule: c.rule })),
    total: matching.length,
    shown: shown.length,
  };

  if (matching.length > shown.length) {
    projection.note =
      `Showing ${shown.length} of ${matching.length} conventions. ` +
      `Narrow with the category argument or raise limit.`;
  }
  return projection;
}
