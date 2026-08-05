import type { IntentConfidence } from '@devdigest/shared';

/**
 * Pure transforms for the intent module (no I/O, no `this`).
 *
 * The keyword list is GitHub's documented set — close/closes/closed,
 * fix/fixes/fixed, resolve/resolves/resolved — case-insensitive with an optional
 * colon. The pre-existing regex in the GitHub adapter matched three of the nine.
 */
const CLOSING_KEYWORDS = '(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)';
const SAME_REPO_ISSUE = new RegExp(`\\b${CLOSING_KEYWORDS}\\b:?\\s*#(\\d+)`, 'gi');
const CROSS_REPO_ISSUE = new RegExp(
  `\\b${CLOSING_KEYWORDS}\\b:?\\s*([\\w.-]+/[\\w.-]+#\\d+)`,
  'gi',
);
/** A bare repo-relative markdown path: `docs/plans/x.md`, `server/specs/y.md`. */
const MD_PATH = /(?<![\w/.-])((?:[\w.-]+\/)+[\w.-]+\.md)\b/g;

export function linkedIssueNumbers(body: string | null | undefined): number[] {
  if (!body) return [];
  const out: number[] = [];
  for (const m of body.matchAll(SAME_REPO_ISSUE)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * Cross-repo closing references. Recognised only so they can be recorded as
 * unretrieved context — fetching another repository is out of scope, and
 * pretending we read it is worse than saying we did not.
 */
export function crossRepoIssueRefs(body: string | null | undefined): string[] {
  if (!body) return [];
  const out: string[] = [];
  for (const m of body.matchAll(CROSS_REPO_ISSUE)) {
    if (m[1] && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Markdown documents referenced by the PR body, as repo-relative paths. A
 * same-repo `blob` URL is reduced to its path; another repository's URL is
 * ignored entirely (we only have this repo's clone).
 */
export function docReferences(
  body: string | null | undefined,
  owner: string,
  repo: string,
): string[] {
  if (!body) return [];
  const out: string[] = [];
  const blobUrl = new RegExp(
    `https?://github\\.com/${escapeRe(owner)}/${escapeRe(repo)}/blob/[^/\\s]+/([^\\s)\\]]+\\.md)`,
    'gi',
  );
  // Strip every github.com URL before scanning for bare paths, so another
  // repository's blob URL cannot contribute its path fragment.
  let rest = body;
  for (const m of body.matchAll(blobUrl)) {
    if (m[1] && !out.includes(m[1])) out.push(m[1]);
  }
  rest = rest.replace(/https?:\/\/\S+/g, ' ');
  for (const m of rest.matchAll(MD_PATH)) {
    if (m[1] && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Confidence is a function of the evidence that actually arrived — never asked
 * of the model, whose self-reported certainty rises exactly when it is wrong.
 */
export function computeConfidence(input: {
  hasBody: boolean;
  hasIssue: boolean;
  hasDoc: boolean;
  missingContext: string[];
}): IntentConfidence {
  const count = [input.hasBody, input.hasIssue, input.hasDoc].filter(Boolean).length;
  const base: IntentConfidence =
    input.hasBody && (input.hasIssue || input.hasDoc) ? 'high' : count >= 1 ? 'medium' : 'low';
  // Anything we failed to retrieve caps the claim: the intent was derived
  // around a hole, and the card says so.
  if (input.missingContext.length > 0 && base === 'high') return 'medium';
  return base;
}
