import type { AdhocFinding, AdhocReviewRef } from '../types.js';

/**
 * The stdout payload. Pure: no I/O, no process access — so the exact bytes a
 * CI step would parse are pinned by a test rather than eyeballed.
 */

/** Most severe first — the order a reviewer should read them in. */
const SEVERITY_ORDER: Record<AdhocFinding['severity'], number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

function lineRange(f: AdhocFinding): string {
  return f.start_line === f.end_line ? String(f.start_line) : `${f.start_line}-${f.end_line}`;
}

export function renderReview(res: AdhocReviewRef): string {
  const { review } = res;
  const lines: string[] = [
    `${review.verdict} (${review.score}) — agent ${res.agent.name}, model ${res.model}`,
  ];

  if (review.summary) lines.push(review.summary);

  if (review.findings.length === 0) {
    lines.push('', 'No findings.');
  } else {
    lines.push('');
    const sorted = [...review.findings].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
    for (const f of sorted) {
      lines.push(`${f.severity.padEnd(10)} ${f.file}:${lineRange(f)}  ${f.title}`);
    }
  }

  // Grounding is never hidden: a finding the gate dropped is a finding the
  // model produced, and silence there would misrepresent what the run did.
  if (res.dropped.length > 0) lines.push('', `dropped: ${res.dropped.length} (grounding)`);
  if (res.scope_dropped.length > 0) lines.push(`scope_dropped: ${res.scope_dropped.length}`);

  lines.push('', `blockers: ${res.blockers} (fail on: ${res.agent.ci_fail_on})`);
  return lines.join('\n');
}

/** 0 clean, 1 blocked. The "could not run" case is 2 and never reaches here. */
export function exitCodeFor(res: AdhocReviewRef): 0 | 1 {
  return res.blockers === 0 ? 0 : 1;
}
