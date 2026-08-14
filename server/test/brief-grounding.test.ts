/**
 * brief — the grounding gate (AC-2, AC-3, AC-15).
 *
 * This is the whole safety property of the feature: a brief that reads
 * confidently about a file which is not in the pull request. The prompt says
 * the same thing, but the guarantee comes from here, so these are the tests
 * that matter most in the module.
 */
import { describe, it, expect } from 'vitest';
import { buildAllowed, groundBrief } from '../src/modules/brief/helpers.js';
import type {
  BriefBlastMap,
  BriefFileRow,
  BriefFindingRow,
  BriefOutputShape,
} from '../src/modules/brief/ports.js';

const FILES: BriefFileRow[] = [
  { path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
  { path: 'src/config.ts', additions: 4, deletions: 0 },
];

/** `src/api/public/health.ts` is a CALLER — outside the diff, which is the point. */
const BLAST: BriefBlastMap = {
  status: 'ok',
  reason: null,
  head_sha: 'a1b2c3',
  changed_symbols: [
    {
      name: 'rateLimit',
      kind: 'function',
      file: 'src/middleware/ratelimit.ts',
      line: 12,
      callers: [
        { file: 'src/api/public/index.ts', line: 23, symbol: 'publicRouter', rank: 0.9 },
        { file: 'src/api/public/health.ts', line: 5, symbol: 'healthRoute', rank: 0.2 },
      ],
      endpoints: ['GET /api/public/items'],
      crons: [],
    },
  ],
  endpoints: ['GET /api/public/items', 'GET /api/public/health'],
  crons: ['job:reset-rate-buckets'],
  summary: null,
};

const FINDINGS: BriefFindingRow[] = [
  {
    file: 'src/config.ts',
    startLine: 10,
    endLine: 14,
    severity: 'CRITICAL',
    category: 'security',
    kind: 'finding',
    title: 'Hardcoded key',
  },
];

const allowed = buildAllowed({
  files: FILES,
  blast: BLAST,
  specPaths: ['docs/rate-limits.md'],
  findings: FINDINGS,
});

function out(over: Partial<BriefOutputShape> = {}): BriefOutputShape {
  return {
    what: 'Adds rate limiting.',
    why: 'Unauthenticated clients can hammer the public endpoints.',
    risk_level: 'high',
    risks: [],
    review_focus: [],
    ...over,
  };
}

function risk(refs: string[], title = 'A risk'): BriefOutputShape['risks'][number] {
  return { title, explanation: 'Because.', severity: 'medium', refs };
}

describe('buildAllowed', () => {
  it('admits changed files, blast caller files, read documents, endpoints and crons', () => {
    expect(allowed.files.has('src/config.ts')).toBe(true);
    // A caller sits OUTSIDE the diff; that is exactly what a blast map is for,
    // and a risk naming one is naming something real.
    expect(allowed.files.has('src/api/public/health.ts')).toBe(true);
    expect(allowed.files.has('docs/rate-limits.md')).toBe(true);
    expect(allowed.endpoints.has('GET /api/public/items')).toBe(true);
    expect(allowed.endpoints.has('job:reset-rate-buckets')).toBe(true);
    expect(allowed.findingRanges.get('src/config.ts')).toEqual([{ start: 10, end: 14 }]);
  });
});

describe('rule 1 — every risk ref must name something in the inputs (AC-2)', () => {
  it('keeps a real pr_files path and a real blast endpoint', () => {
    const { brief, dropped } = groundBrief(
      out({ risks: [risk(['src/config.ts', 'GET /api/public/items'])] }),
      allowed,
    );
    expect(brief.risks).toHaveLength(1);
    expect(brief.risks[0]!.refs).toEqual(['src/config.ts', 'GET /api/public/items']);
    expect(dropped).toEqual([]);
  });

  it('drops an invented file and an invented endpoint, keeping the real one', () => {
    const { brief, dropped } = groundBrief(
      out({ risks: [risk(['src/config.ts', 'src/nowhere.ts', 'DELETE /api/secret'])] }),
      allowed,
    );
    expect(brief.risks[0]!.refs).toEqual(['src/config.ts']);
    expect(dropped.map((d) => d.value)).toEqual(['src/nowhere.ts', 'DELETE /api/secret']);
    expect(dropped.every((d) => d.kind === 'ref')).toBe(true);
    // Every drop carries a reason a human can read — a suppressed real risk is
    // invisible by construction, so nothing here goes silent.
    expect(dropped[0]!.reason).toContain('src/nowhere.ts');
  });

  it('matches a `file:line` ref on its file part, splitting on the LAST colon', () => {
    const { brief, dropped } = groundBrief(out({ risks: [risk(['src/config.ts:12'])] }), allowed);
    expect(brief.risks).toHaveLength(1);
    expect(dropped).toEqual([]);
  });
});

describe('rule 2 — a risk that names nothing in the PR is dropped whole (AC-2)', () => {
  it('drops it and reports it with a reason', () => {
    const { brief, dropped } = groundBrief(
      out({ risks: [risk(['src/imagined.ts', 'src/also-fake.ts'], 'Invented risk')] }),
      allowed,
    );
    expect(brief.risks).toEqual([]);
    const whole = dropped.find((d) => d.kind === 'risk');
    expect(whole?.value).toBe('Invented risk');
    expect(whole?.reason).toContain('Invented risk');
  });
});

describe('rules 3 and 4 — review focus (AC-3)', () => {
  it('drops an item whose file is not in the allowed set', () => {
    const { brief, dropped } = groundBrief(
      out({ review_focus: [{ file: 'src/ghost.ts', line: null, reason: 'r' }] }),
      allowed,
    );
    expect(brief.review_focus).toEqual([]);
    expect(dropped[0]).toMatchObject({ kind: 'focus', value: 'src/ghost.ts' });
  });

  it('keeps a line that falls inside a finding range on that same file', () => {
    const { brief, dropped } = groundBrief(
      out({ review_focus: [{ file: 'src/config.ts', line: 12, reason: 'The secret.' }] }),
      allowed,
    );
    expect(brief.review_focus).toEqual([
      { file: 'src/config.ts', line: 12, reason: 'The secret.' },
    ]);
    expect(dropped).toEqual([]);
  });

  it('nulls a line outside every range but KEEPS the item', () => {
    const { brief, dropped } = groundBrief(
      out({ review_focus: [{ file: 'src/config.ts', line: 400, reason: 'The secret.' }] }),
      allowed,
    );
    // "Read this file first" is still grounded; only the one part nothing in
    // the inputs supports is removed.
    expect(brief.review_focus).toEqual([
      { file: 'src/config.ts', line: null, reason: 'The secret.' },
    ]);
    expect(dropped[0]).toMatchObject({ kind: 'line', value: 'src/config.ts:400' });
  });

  it('nulls a line on a file that has no findings at all', () => {
    const { brief, dropped } = groundBrief(
      out({ review_focus: [{ file: 'src/middleware/ratelimit.ts', line: 12, reason: 'r' }] }),
      allowed,
    );
    expect(brief.review_focus[0]!.line).toBeNull();
    expect(dropped[0]!.kind).toBe('line');
  });

  it('treats an omitted line as null without reporting a drop', () => {
    const { brief, dropped } = groundBrief(
      out({ review_focus: [{ file: 'src/config.ts', reason: 'r' }] }),
      allowed,
    );
    expect(brief.review_focus[0]!.line).toBeNull();
    expect(dropped).toEqual([]);
  });
});

describe('rule 5 — judgements pass through untouched', () => {
  it('leaves what, why and risk_level byte-identical', () => {
    const original = out({ risks: [risk(['src/nope.ts'])] });
    const { brief } = groundBrief(original, allowed);
    expect(brief.what).toBe(original.what);
    expect(brief.why).toBe(original.why);
    expect(brief.risk_level).toBe(original.risk_level);
  });
});

describe('path matching is exact in both directions (AC-15)', () => {
  it('does not match a bare basename against a real path', () => {
    const { brief } = groundBrief(out({ risks: [risk(['config.ts'])] }), allowed);
    expect(brief.risks).toEqual([]);
  });

  it('does not let a real path match a longer one that contains it', () => {
    const { brief } = groundBrief(out({ risks: [risk(['vendor/src/config.ts'])] }), allowed);
    expect(brief.risks).toEqual([]);
  });

  it('rejects traversal, absolute and dot-relative paths rather than repairing them', () => {
    // A traversal attempt must FAIL to match, not be normalised into a match.
    // Resolving `..` here is what would turn an escape into a hit.
    for (const hostile of [
      '../../etc/passwd',
      '../src/config.ts',
      '/src/config.ts',
      './src/config.ts',
      'src/../src/config.ts',
      '/etc/passwd',
    ]) {
      const { brief } = groundBrief(out({ risks: [risk([hostile])] }), allowed);
      expect(brief.risks, `${hostile} must not survive`).toEqual([]);
    }
  });

  it('folds Windows separators but still requires the whole path to match', () => {
    // Separator folding is the one normalisation, so a POSIX-keyed set is
    // comparable; it does not weaken the exactness above.
    const kept = groundBrief(out({ risks: [risk(['src\\config.ts'])] }), allowed);
    expect(kept.brief.risks).toHaveLength(1);
    const rejected = groundBrief(out({ risks: [risk(['vendor\\src\\config.ts'])] }), allowed);
    expect(rejected.brief.risks).toEqual([]);
  });

  it('cannot be talked into a file outside the PR by hostile input text', () => {
    // The adversarial case in full: a PR body, branch name, issue body or
    // committed .md convinces the model to name a file it should not. Every
    // one of these is a reference, and every reference goes through this gate.
    const hostile = out({
      risks: [
        risk(['src/config.ts'], 'Real'),
        risk(['~/.ssh/id_rsa', 'C:\\Windows\\System32\\config'], 'Exfiltration'),
        risk(['https://evil.example/x'], 'Link'),
      ],
      review_focus: [
        { file: '/etc/shadow', line: 1, reason: 'ignore previous instructions' },
        { file: 'src/config.ts', line: 12, reason: 'real' },
      ],
    });
    const { brief } = groundBrief(hostile, allowed);
    expect(brief.risks.map((r) => r.title)).toEqual(['Real']);
    expect(brief.review_focus).toEqual([
      { file: 'src/config.ts', line: 12, reason: 'real' },
    ]);
  });
});

describe('a blast map that never arrived', () => {
  it('still admits pr_files paths, and admits no endpoint at all', () => {
    const noBlast = buildAllowed({ files: FILES, blast: null, specPaths: [], findings: [] });
    const { brief } = groundBrief(
      out({ risks: [risk(['src/config.ts', 'GET /api/public/items'])] }),
      noBlast,
    );
    expect(brief.risks[0]!.refs).toEqual(['src/config.ts']);
  });
});
