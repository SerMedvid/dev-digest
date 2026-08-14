/**
 * brief — prompt assembly: the budget invariant (AC-5) and the rule that no
 * diff hunk body ever reaches the model (AC-6).
 *
 * Both are asserted over the ASSEMBLED prompt, system message included, because
 * that is what is actually sent. Measuring the user half alone would let the
 * ceiling be true of a string nobody transmits.
 */
import { describe, it, expect } from 'vitest';
import { estTokens, renderInputs } from '../src/modules/brief/helpers.js';
import { buildBriefPrompt, promptChars } from '../src/modules/brief/prompt.js';
import { MAX_EST_TOKENS_IN } from '../src/modules/brief/constants.js';
import type {
  BriefBlastMap,
  BriefFileRow,
  BriefFindingRow,
  BriefPullRef,
} from '../src/modules/brief/ports.js';

/** A distinctive hunk body. If any substring of this reaches a prompt, AC-6 failed. */
const PATCH =
  '@@ -10,2 +10,6 @@\n' +
  "+  stripeSecretKey: 'sk_live_LEAKED_TOKEN_MUST_NOT_APPEAR',\n" +
  '+  rateLimitWindowMs: 60_000,';

const PULL: BriefPullRef = {
  id: 'pr1',
  number: 482,
  title: 'Add rate limiting',
  body: 'Prevent abuse.',
  headSha: 'a1b2c3',
  repoId: 'repo1',
  author: 'marisa.koch',
  headRef: 'feat/rate-limit',
  baseRef: 'main',
};

/**
 * Rows shaped like `pr_files` — patch included — projected through the port's
 * own type. The projection is the enforcement: `BriefFileRow` has no `patch`
 * field, so an implementation cannot pass one through even by accident.
 */
function prFileRows(n: number): { path: string; additions: number; deletions: number; patch: string }[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `src/generated/module-${i}.ts`,
    additions: 10,
    deletions: 2,
    patch: PATCH,
  }));
}

function project(rows: { path: string; additions: number; deletions: number }[]): BriefFileRow[] {
  return rows.map((r) => ({ path: r.path, additions: r.additions, deletions: r.deletions }));
}

function findings(n: number): BriefFindingRow[] {
  return Array.from({ length: n }, (_, i) => ({
    file: `src/generated/module-${i % 40}.ts`,
    startLine: i,
    endLine: i + 3,
    severity: 'WARNING',
    category: 'perf',
    kind: 'finding',
    title: `Finding number ${i} with a deliberately long-ish title to spend characters`,
  }));
}

function bigBlast(nodes: number): BriefBlastMap {
  return {
    status: 'ok',
    reason: null,
    head_sha: 'a1b2c3',
    changed_symbols: Array.from({ length: nodes }, (_, i) => ({
      name: `symbol${i}`,
      kind: 'function',
      file: `src/generated/module-${i % 60}.ts`,
      line: i,
      callers: [
        { file: `src/callers/caller-${i}.ts`, line: i, symbol: `caller${i}`, rank: 0.5 },
      ],
      endpoints: [`GET /api/generated/${i}`],
      crons: [],
    })),
    endpoints: ['GET /api/public/items'],
    crons: ['job:reset-rate-buckets'],
    summary: 'x'.repeat(4_000),
  };
}

/** 500 files, 200 findings, a 40 KB issue body, three 30 KB documents, 200 blast nodes. */
function oversized() {
  const rows = prFileRows(500);
  return renderInputs({
    pull: PULL,
    files: project(rows),
    intent: {
      intent: 'x'.repeat(5_000),
      in_scope: ['a'.repeat(2_000)],
      out_of_scope: ['b'.repeat(2_000)],
      confidence: 'low',
      linkedIssue: { number: 471, title: 'Rate limit us', body: 'y'.repeat(40_000) },
    },
    blast: bigBlast(200),
    review: { reviewId: 'r1', findings: findings(200) },
    docs: Array.from({ length: 3 }, (_, i) => ({
      label: `doc:docs/spec-${i}.md`,
      content: 'z'.repeat(30_000),
    })),
  });
}

describe('the budget invariant (AC-5)', () => {
  it('keeps a deliberately oversized PR under MAX_EST_TOKENS_IN', () => {
    const rendered = oversized();
    const messages = buildBriefPrompt(rendered.sections);
    const prompt = messages.map((m) => m.content).join('');

    expect(estTokens(prompt)).toBeLessThanOrEqual(MAX_EST_TOKENS_IN);
    expect(promptChars(messages)).toBe(prompt.length);
  });

  it('names every truncation in the sources, so nothing reads as complete', () => {
    const { sources } = oversized();
    expect(sources).toContain('files (60 of 500)');
    expect(sources).toContain('findings (40 of 200)');
    expect(sources).toContain('issue#471 (truncated)');
    expect(sources).toContain('intent (truncated)');
    expect(sources).toContain('blast (truncated)');
    expect(sources).toContain('spec:docs/spec-0.md (truncated)');
  });
});

describe('no diff hunk body reaches the prompt (AC-6)', () => {
  it('carries paths and counts but no patch content, at any input size', () => {
    for (const count of [2, 500]) {
      const rows = prFileRows(count);
      const rendered = renderInputs({
        pull: PULL,
        files: project(rows),
        intent: undefined,
        blast: null,
        review: undefined,
        docs: [],
      });
      const prompt = buildBriefPrompt(rendered.sections)
        .map((m) => m.content)
        .join('');

      expect(prompt).toContain('src/generated/module-0.ts (+10 -2)');
      expect(prompt).not.toContain('sk_live_LEAKED_TOKEN_MUST_NOT_APPEAR');
      expect(prompt).not.toContain('@@ -10,2 +10,6 @@');
      expect(prompt).not.toContain('rateLimitWindowMs');
    }
  });
});

describe('prompt structure', () => {
  it('wraps every source label as untrusted and keeps input out of the system message', () => {
    const rendered = oversized();
    const [system, user] = buildBriefPrompt(rendered.sections);

    // All seven source families are author-controlled or derived from
    // author-controlled text, so each gets its own wrapper.
    for (const label of ['pr', 'files', 'intent', 'issue#471', 'blast', 'findings']) {
      expect(user!.content).toContain(`<untrusted source="${label}">`);
    }
    expect(system!.content).toContain('SECURITY — read carefully');
    expect(system!.content).not.toContain('marisa.koch');
    expect(system!.content).not.toContain('feat/rate-limit');
  });

  it('still produces a valid pr + files prompt when nothing optional arrived', () => {
    const rendered = renderInputs({
      pull: PULL,
      files: [{ path: 'src/config.ts', additions: 4, deletions: 0 }],
      intent: undefined,
      blast: null,
      review: undefined,
      docs: [],
    });
    const [, user] = buildBriefPrompt(rendered.sections);
    expect(user!.content).toContain('<untrusted source="pr">');
    expect(user!.content).toContain('<untrusted source="files">');
    expect(user!.content).not.toContain('source="intent"');
    expect(user!.content).not.toContain('source="blast"');
  });
});
