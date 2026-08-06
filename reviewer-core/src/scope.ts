import type { Finding } from '@devdigest/shared';

/**
 * Scope gate — the deterministic half of the Intent Layer.
 *
 * The reviewer model marks findings `out_of_scope`; this decides what that is
 * allowed to mean. It may suppress NOISE only: a SUGGESTION about style, perf or
 * test hygiene in something the PR never set out to change. Everything else
 * survives and stays visible with its marker, which is why the injection guard's
 * promise — that a stated intent "can never turn a real defect into zero
 * findings" — still holds with this gate on.
 *
 * Widening this list is a product decision, not a refactor. The failure mode it
 * guards against is a suppressed real bug, which is silent by construction.
 */
const NEVER_DROP_KINDS = new Set(['secret_leak', 'lethal_trifecta', 'phantom', 'hook']);
const DROPPABLE_CATEGORIES = new Set(['style', 'perf', 'test']);

export interface ScopeResult {
  kept: Finding[];
  /** Dropped findings with reasons — never silent, same contract as grounding. */
  dropped: { finding: Finding; reason: string }[];
}

export function scopeFindings(findings: Finding[], intentPresent: boolean): ScopeResult {
  // No intent in the prompt ⇒ nothing to judge scope against, and `out_of_scope`
  // (if the model set it anyway) means nothing. Behave exactly as before L03.
  if (!intentPresent) return { kept: findings, dropped: [] };

  const kept: Finding[] = [];
  const dropped: { finding: Finding; reason: string }[] = [];

  for (const finding of findings) {
    const droppable =
      finding.out_of_scope === true &&
      finding.severity === 'SUGGESTION' &&
      DROPPABLE_CATEGORIES.has(finding.category) &&
      !(finding.kind && NEVER_DROP_KINDS.has(finding.kind));

    if (droppable) {
      dropped.push({
        finding,
        reason: `out of scope for this PR (${finding.severity}/${finding.category} suggestion)`,
      });
    } else {
      kept.push(finding);
    }
  }

  return { kept, dropped };
}

/** Human-readable summary, e.g. "2 out-of-scope suggestion(s) filtered". */
export function scopeSummary(result: ScopeResult): string {
  return `${result.dropped.length} out-of-scope suggestion(s) filtered`;
}
