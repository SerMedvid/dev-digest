import { MAX_SNIPPET_LINES } from './constants.js';
import { CONVENTION_CATEGORIES, type ConventionRecord } from './domain.js';
import { slugifyRule } from './helpers.js';

/**
 * Assembles the accepted candidates into one skill body. This text becomes
 * prompt input for every review the skill is linked to, so the shape matters:
 * a directive preamble, then one section per rule with its evidence.
 *
 * Evidence is capped at MAX_SNIPPET_LINES and fenced. Whole files must never
 * reach a skill body — see §7 of the design on what `source: 'extracted'` costs.
 */

export interface SkillDraftInput {
  repoName: string;
  candidates: ConventionRecord[];
}

export function buildSkillName(repoName: string): string {
  return `${repoName}-conventions`;
}

export function buildSkillDescription(count: number, repoName: string): string {
  const noun = count === 1 ? 'convention' : 'conventions';
  return `${count} house ${noun} extracted from ${repoName}`;
}

/** Rules read as instructions, so each ends in a full stop — exactly one. */
function asSentence(rule: string): string {
  const trimmed = rule.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function section(candidate: ConventionRecord): string {
  const snippet = candidate.evidenceSnippet
    .split('\n')
    .slice(0, MAX_SNIPPET_LINES)
    .join('\n');
  return [
    `## ${slugifyRule(candidate.rule)}`,
    asSentence(candidate.rule),
    '',
    `Detected in \`${candidate.evidencePath}:${candidate.evidenceLine}\`:`,
    '',
    '```',
    snippet,
    '```',
  ].join('\n');
}

export function buildSkillBody(input: SkillDraftInput): string {
  const order = new Map(CONVENTION_CATEGORIES.map((c, i) => [c, i]));
  const sorted = [...input.candidates].sort(
    (a, b) => (order.get(a.category) ?? 0) - (order.get(b.category) ?? 0),
  );
  return [
    `# ${buildSkillName(input.repoName)}`,
    '',
    `House conventions for \`${input.repoName}\`. Flag changes that violate any rule ` +
      'below and cite the offending `file:line`.',
    '',
    ...sorted.map(section).flatMap((s) => [s, '']),
  ]
    .join('\n')
    .trimEnd();
}
