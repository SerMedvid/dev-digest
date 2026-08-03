import {
  MAX_CANDIDATES,
  MAX_PER_CATEGORY,
  MIN_CONFIDENCE,
  SNIPPET_WINDOW,
} from './constants.js';
import type { DropCounts, RawCandidate } from './domain.js';
import { bumpDrop, normaliseRule } from './helpers.js';

/**
 * The evidence gate: everything the model claimed, checked against the files we
 * actually showed it. Pure — the caller passes the file contents in, so this is
 * unit-testable with no clone and no database.
 *
 * The one non-obvious rule is the snippet window. Models quote code correctly
 * while missing the line number by a few positions; an exact-line check throws
 * away valid rules for a cosmetic error. Searching ±SNIPPET_WINDOW and
 * *correcting* the number keeps the rule without weakening the check — the
 * snippet still has to genuinely be in the file, near where the model said.
 */

export interface VerifyInput {
  candidates: RawCandidate[];
  /** Every path we gave the model → that file's lines. */
  shown: Map<string, string[]>;
}

export interface VerifyResult {
  kept: RawCandidate[];
  dropped: DropCounts;
}

/** Whitespace-insensitive comparison key for one line of code. */
function squash(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

/**
 * The real 1-based line of the snippet's first non-empty line, searched
 * outward from `claimed`, or null when it is not in the window.
 */
function locate(lines: string[], claimed: number, snippet: string): number | null {
  const needle = squash(snippet.split('\n').find((l) => squash(l).length > 0) ?? '');
  if (needle.length === 0) return null;

  const from = Math.max(1, claimed - SNIPPET_WINDOW);
  const to = Math.min(lines.length, claimed + SNIPPET_WINDOW);
  let best: number | null = null;
  for (let line = from; line <= to; line += 1) {
    if (squash(lines[line - 1] ?? '').includes(needle)) {
      // Prefer the closest match to what the model claimed.
      if (best === null || Math.abs(line - claimed) < Math.abs(best - claimed)) best = line;
    }
  }
  return best;
}

export function verifyCandidates(input: VerifyInput): VerifyResult {
  let dropped: DropCounts = {};
  const grounded: RawCandidate[] = [];

  for (const candidate of input.candidates) {
    if (!input.shown.has(candidate.evidencePath)) {
      dropped = bumpDrop(dropped, 'unknown_path');
      continue;
    }
    const lines = input.shown.get(candidate.evidencePath)!;
    if (lines.length === 0) {
      dropped = bumpDrop(dropped, 'missing_file');
      continue;
    }
    if (candidate.evidenceLine < 1 || candidate.evidenceLine > lines.length) {
      dropped = bumpDrop(dropped, 'line_out_of_range');
      continue;
    }
    const line = locate(lines, candidate.evidenceLine, candidate.evidenceSnippet);
    if (line === null) {
      dropped = bumpDrop(dropped, 'snippet_not_found');
      continue;
    }
    if (candidate.confidence < MIN_CONFIDENCE) {
      dropped = bumpDrop(dropped, 'low_confidence');
      continue;
    }
    grounded.push({ ...candidate, evidenceLine: line });
  }

  // Most confident first, so both dedup and the quotas keep the best.
  const ranked = [...grounded].sort((a, b) => b.confidence - a.confidence);

  const seen = new Set<string>();
  const deduped: RawCandidate[] = [];
  for (const candidate of ranked) {
    const key = normaliseRule(candidate.rule);
    if (seen.has(key)) {
      dropped = bumpDrop(dropped, 'duplicate');
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }

  const perCategory = new Map<string, number>();
  const kept: RawCandidate[] = [];
  for (const candidate of deduped) {
    const used = perCategory.get(candidate.category) ?? 0;
    if (used >= MAX_PER_CATEGORY || kept.length >= MAX_CANDIDATES) {
      dropped = bumpDrop(dropped, 'over_quota');
      continue;
    }
    perCategory.set(candidate.category, used + 1);
    kept.push(candidate);
  }

  return { kept, dropped };
}
