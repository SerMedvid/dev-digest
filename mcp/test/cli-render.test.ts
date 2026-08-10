/**
 * The stdout payload is a contract — a CI step is meant to parse it — so it is
 * pinned as an exact string rather than by substring probes.
 */
import { describe, it, expect } from 'vitest';
import { renderReview, exitCodeFor } from '../src/cli/render.js';
import type { AdhocReviewRef } from '../src/types.js';

function res(over: Partial<AdhocReviewRef> = {}): AdhocReviewRef {
  return {
    review: { verdict: 'request_changes', summary: 'Two problems.', score: 61, findings: [] },
    blockers: 0,
    dropped: [],
    scope_dropped: [],
    agent: { name: 'Security Reviewer', ci_fail_on: 'critical' },
    model: 'claude-opus-5',
    ...over,
  };
}

describe('renderReview', () => {
  it('groups findings by severity, most severe first, with line ranges', () => {
    const out = renderReview(
      res({
        review: {
          verdict: 'request_changes',
          summary: 'Two problems.',
          score: 61,
          findings: [
            {
              severity: 'SUGGESTION',
              title: 'Prefer const',
              file: 'src/a.ts',
              start_line: 9,
              end_line: 9,
            },
            {
              severity: 'CRITICAL',
              title: 'Hardcoded secret',
              file: 'src/config.ts',
              start_line: 12,
              end_line: 14,
            },
            {
              severity: 'WARNING',
              title: 'N+1 query',
              file: 'src/api/users.ts',
              start_line: 45,
              end_line: 45,
            },
          ],
        },
        blockers: 1,
        dropped: ['no citation for src/ghost.ts:1'],
        scope_dropped: ['out of scope'],
      }),
    );

    expect(out).toBe(
      [
        'request_changes (61) — agent Security Reviewer, model claude-opus-5',
        'Two problems.',
        '',
        'CRITICAL   src/config.ts:12-14  Hardcoded secret',
        'WARNING    src/api/users.ts:45  N+1 query',
        'SUGGESTION src/a.ts:9  Prefer const',
        '',
        'dropped: 1 (grounding)',
        'scope_dropped: 1',
        '',
        'blockers: 1 (fail on: critical)',
      ].join('\n'),
    );
  });

  it('says so plainly when a clean review found nothing', () => {
    const out = renderReview(
      res({ review: { verdict: 'approve', summary: 'Looks good.', score: 95, findings: [] } }),
    );
    expect(out).toContain('No findings.');
    expect(out).toContain('blockers: 0 (fail on: critical)');
    // Nothing was dropped, so nothing claims to have been.
    expect(out).not.toContain('dropped:');
  });
});

describe('exitCodeFor', () => {
  it('is 0 with no blockers and 1 with any', () => {
    expect(exitCodeFor(res({ blockers: 0 }))).toBe(0);
    expect(exitCodeFor(res({ blockers: 1 }))).toBe(1);
    expect(exitCodeFor(res({ blockers: 7 }))).toBe(1);
  });
});
