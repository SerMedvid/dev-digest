import type {
  BlastRadiusRef,
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

/** Top callers listed per symbol before the projection says how many it dropped. */
const MAX_TOP_CALLERS = 5;

export interface BlastSymbolProjection {
  name: string;
  file: string;
  line: number | null;
  caller_count: number;
  /** "file:line (enclosingSymbol)", rank-descending, capped. */
  top_callers: string[];
  endpoints: string[];
  crons: string[];
}

export interface BlastProjection {
  status: string;
  reason?: string;
  head_sha: string;
  symbols: BlastSymbolProjection[];
  endpoints: string[];
  crons: string[];
  summary?: string;
  note?: string;
}

/**
 * Compact the blast map for an agent: counts plus the top callers, not every
 * row. `status` and `reason` are always carried through — a `degraded` map
 * projected as a successful-looking empty result is the one failure mode this
 * tool must not have, because the caller cannot tell it from "nothing calls
 * this".
 */
export function projectBlastRadius(res: BlastRadiusRef): BlastProjection {
  const symbols: BlastSymbolProjection[] = res.changed_symbols.map((s) => ({
    name: s.name,
    file: s.file,
    line: s.line,
    caller_count: s.callers.length,
    top_callers: s.callers
      .slice(0, MAX_TOP_CALLERS)
      .map((c) => `${c.file}:${c.line} (${c.symbol})`),
    endpoints: s.endpoints,
    crons: s.crons,
  }));

  const projection: BlastProjection = {
    status: res.status,
    head_sha: res.head_sha,
    symbols,
    endpoints: res.endpoints,
    crons: res.crons,
  };
  if (res.reason) projection.reason = res.reason;
  if (res.summary) projection.summary = res.summary;

  const truncated = res.changed_symbols.filter((s) => s.callers.length > MAX_TOP_CALLERS);
  const notes: string[] = [];
  if (truncated.length > 0) {
    notes.push(
      `top_callers is capped at ${MAX_TOP_CALLERS} per symbol; caller_count is the true total.`,
    );
  }
  // Spelled out rather than left for the model to infer from a status string.
  if (res.status === 'degraded') {
    notes.push(
      'The index could not be read, so the empty arrays above mean "unknown", not "nothing".',
    );
  } else if (res.status === 'partial') {
    notes.push('The index is incomplete or behind this PR, so some callers may be missing.');
  }
  if (notes.length > 0) projection.note = notes.join(' ');

  return projection;
}
