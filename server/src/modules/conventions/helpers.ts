import type { ConventionCandidate, ConventionScan } from '@devdigest/shared';
import type { ConventionRecord, DropCounts, DropReason, ScanRecord } from './domain.js';

/**
 * Pure transforms. No DB, no fs, no SDK — this file is in the core ring, so it
 * may import `@devdigest/shared` (a port) and `domain.ts`, and nothing else.
 */

/**
 * Dedup key for a rule. Two models — or two calls to one model — phrase the
 * same rule with different casing, spacing and trailing punctuation, and those
 * would otherwise reach the user as separate candidates.
 */
export function normaliseRule(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Kebab-case heading for a rule's section in the merged skill body. */
export function slugifyRule(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Number every line, 1-based, and state the cut when truncating. Without the
 * numbers the model guesses at line references and verification discards almost
 * everything; without the truncation note it happily cites past the cut.
 */
export function numberLines(content: string, maxLines: number): string {
  const lines = content.split('\n');
  const head = lines.slice(0, maxLines).map((line, i) => `${i + 1}: ${line}`);
  if (lines.length > maxLines) head.push(`… truncated at line ${maxLines} of ${lines.length}`);
  return head.join('\n');
}

/** Increment one drop counter, returning a new object. */
export function bumpDrop(counts: DropCounts, reason: DropReason): DropCounts {
  return { ...counts, [reason]: (counts[reason] ?? 0) + 1 };
}

export function toCandidateDto(record: ConventionRecord): ConventionCandidate {
  return {
    id: record.id,
    category: record.category,
    rule: record.rule,
    evidence_path: record.evidencePath,
    evidence_line: record.evidenceLine,
    evidence_snippet: record.evidenceSnippet,
    confidence: record.confidence,
    status: record.status,
  };
}

export function toScanDto(record: ScanRecord): ConventionScan {
  return {
    status: record.status,
    pool_count: record.poolCount,
    sample_count: record.sampleCount,
    candidate_count: record.candidateCount,
    dropped: record.dropped,
    provider: record.provider,
    model: record.model,
    error: record.error,
    started_at: record.startedAt ? record.startedAt.toISOString() : null,
    finished_at: record.finishedAt ? record.finishedAt.toISOString() : null,
  };
}
