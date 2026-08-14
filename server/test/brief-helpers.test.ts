/**
 * brief — the budget estimator, the per-source renderers and their cap
 * reporting. Hermetic and pure: no ports, no model, no DB.
 *
 * What is under test is one property: a truncated input can never read as a
 * complete one. Every renderer that drops something has to say so in its
 * `source` label, because that label is what the user sees on the card.
 */
import { describe, it, expect } from 'vitest';
import {
  capPrompt,
  estTokens,
  renderDocs,
  renderFiles,
  renderFindings,
  renderInputs,
  renderIssue,
  MAX_PROMPT_CHARS,
} from '../src/modules/brief/helpers.js';
import {
  MAX_EST_TOKENS_IN,
  MAX_FILES,
  MAX_FINDINGS,
  MAX_SPEC_DOCS,
  MAX_SPEC_DOC_CHARS,
} from '../src/modules/brief/constants.js';
import type {
  BriefBlastMap,
  BriefFileRow,
  BriefFindingRow,
  BriefIntentRef,
  BriefPullRef,
} from '../src/modules/brief/ports.js';

const PULL: BriefPullRef = {
  id: 'pr1',
  number: 482,
  title: 'Add rate limiting to public API endpoints',
  body: 'Prevent abuse. Closes #471.',
  headSha: 'a1b2c3d4e5f6',
  repoId: 'repo1',
  author: 'marisa.koch',
  headRef: 'feat/rate-limit-public',
  baseRef: 'main',
};

const FILES: BriefFileRow[] = [
  { path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
  { path: 'src/config.ts', additions: 4, deletions: 0 },
];

const INTENT: BriefIntentRef = {
  intent: 'Add rate limiting',
  in_scope: ['middleware'],
  out_of_scope: ['auth'],
  confidence: 'medium',
  linkedIssue: { number: 471, title: 'Rate limit us', body: 'Please.' },
};

const BLAST: BriefBlastMap = {
  status: 'ok',
  reason: null,
  head_sha: 'a1b2c3d4e5f6',
  changed_symbols: [
    {
      name: 'rateLimit',
      kind: 'function',
      file: 'src/middleware/ratelimit.ts',
      line: 12,
      callers: [{ file: 'src/api/public/index.ts', line: 23, symbol: 'publicRouter', rank: 0.9 }],
      endpoints: ['GET /api/public/items'],
      crons: [],
    },
  ],
  endpoints: ['GET /api/public/items'],
  crons: ['job:reset-rate-buckets'],
  summary: null,
};

const FINDING: BriefFindingRow = {
  file: 'src/config.ts',
  startLine: 12,
  endLine: 12,
  severity: 'CRITICAL',
  category: 'security',
  kind: 'finding',
  title: 'Hardcoded Stripe secret key',
};

function files(n: number): BriefFileRow[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `src/generated/module-${i}.ts`,
    additions: i,
    deletions: 1,
  }));
}

describe('estTokens', () => {
  it('is zero for the empty string and exactly the ceiling at 32 000 chars', () => {
    expect(estTokens('')).toBe(0);
    expect(estTokens('x'.repeat(32_000))).toBe(MAX_EST_TOKENS_IN);
    // Ceiling, not floor: one character over must cost a token, or the budget
    // would round its way past the limit.
    expect(estTokens('x'.repeat(32_001))).toBe(MAX_EST_TOKENS_IN + 1);
    expect(estTokens('abc')).toBe(1);
  });
});

describe('capPrompt', () => {
  it('leaves anything within the ceiling untouched', () => {
    const text = 'x'.repeat(MAX_PROMPT_CHARS);
    expect(capPrompt(text)).toBe(text);
  });

  it('marks the truncation with the exact dropped count and stays under the ceiling', () => {
    const text = 'x'.repeat(MAX_PROMPT_CHARS + 5_000);
    const out = capPrompt(text);

    // The RESULT — marker included — honours the ceiling. Slicing to the
    // ceiling and then appending would breach it by the marker's own length.
    expect(out.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    const match = /…\[truncated (\d+) chars\]$/.exec(out);
    expect(match).not.toBeNull();
    const dropped = Number(match![1]);
    const kept = out.length - `\n…[truncated ${dropped} chars]`.length;
    expect(kept + dropped).toBe(text.length);
  });

  it('subtracts what the system message already spends', () => {
    const text = 'x'.repeat(MAX_PROMPT_CHARS);
    const out = capPrompt(text, 2_000);
    expect(out.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS - 2_000);
  });
});

describe('renderFiles', () => {
  it('lists paths and counts, and never a patch', () => {
    const { section, source } = renderFiles(FILES);
    expect(section.text).toContain('src/config.ts (+4 -0)');
    expect(source).toBe('files');
  });

  it('caps the list and reports the true total in the source label', () => {
    const { section, source } = renderFiles(files(500));
    const lines = section.text.split('\n');
    // 60 files plus the "and N more" line.
    expect(lines).toHaveLength(MAX_FILES + 1);
    expect(lines.at(-1)).toBe(`… ${500 - MAX_FILES} more file(s)`);
    // "N of M", not "(truncated)": how many files the PR really touches is
    // itself a fact the reader needs.
    expect(source).toBe(`files (${MAX_FILES} of 500)`);
  });
});

describe('renderFindings', () => {
  it('caps the list and reports the true total', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...FINDING, title: `finding ${i}` }));
    const { section, source } = renderFindings({ reviewId: 'r1', findings: many });
    expect(section.text.split('\n')).toHaveLength(MAX_FINDINGS + 1);
    expect(source).toBe(`findings (${MAX_FINDINGS} of 200)`);
  });

  it('renders the line range but never rationale or suggestion', () => {
    const { section } = renderFindings({ reviewId: 'r1', findings: [FINDING] });
    expect(section.text).toContain('src/config.ts:12-12');
    expect(section.text).toContain('Hardcoded Stripe secret key');
    expect(section.text).not.toContain('sk_live');
  });
});

describe('renderIssue', () => {
  it('reports the truncation on the source label', () => {
    const { source } = renderIssue({ number: 471, title: 't', body: 'x'.repeat(40_000) });
    expect(source).toBe('issue#471 (truncated)');
  });
});

describe('renderDocs', () => {
  it('caps the document count and truncates each, saying so per document', () => {
    const docs = Array.from({ length: 5 }, (_, i) => ({
      label: `doc:docs/spec-${i}.md`,
      content: 'x'.repeat(30_000),
    }));
    const { sections, sources } = renderDocs(docs);
    expect(sections).toHaveLength(MAX_SPEC_DOCS);
    expect(sections[0]!.text).toHaveLength(MAX_SPEC_DOC_CHARS);
    // One section per document, each carrying its own path in its label — three
    // documents merged into one block would let the second read as the first.
    expect(sources).toEqual([
      'spec:docs/spec-0.md (truncated)',
      'spec:docs/spec-1.md (truncated)',
      'spec:docs/spec-2.md (truncated)',
    ]);
  });
});

describe('renderInputs', () => {
  it('renders every source that arrived, each under its own label', () => {
    const { sections, sources } = renderInputs({
      pull: PULL,
      files: FILES,
      intent: INTENT,
      blast: BLAST,
      review: { reviewId: 'r1', findings: [FINDING] },
      docs: [{ label: 'doc:docs/rate-limits.md', content: '# Limits' }],
    });
    expect(sources).toEqual([
      'pr',
      'files',
      'intent',
      'issue#471',
      'blast',
      'findings',
      'spec:docs/rate-limits.md',
    ]);
    expect(sections.map((s) => s.label)).toEqual(sources);
  });

  it('omits an absent source entirely rather than leaving an empty heading', () => {
    const { sections, sources } = renderInputs({
      pull: PULL,
      files: FILES,
      intent: undefined,
      blast: null,
      review: undefined,
      docs: [],
    });
    // An empty "Derived intent" heading reads to the model as "there is an
    // intent and it is blank", which is a different and false claim from
    // "no intent was derived".
    expect(sources).toEqual(['pr', 'files']);
    expect(sections.every((s) => s.text.length > 0)).toBe(true);
  });

  it('omits the issue when the intent linked none, and the findings when a review has none', () => {
    const { sources } = renderInputs({
      pull: PULL,
      files: FILES,
      intent: { ...INTENT, linkedIssue: null },
      blast: null,
      review: { reviewId: 'r1', findings: [] },
      docs: [],
    });
    expect(sources).toEqual(['pr', 'files', 'intent']);
  });
});
