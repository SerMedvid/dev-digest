import { describe, it, expect } from 'vitest';
import {
  computeConfidence,
  crossRepoIssueRefs,
  docReferences,
  linkedIssueNumbers,
} from '../src/modules/intent/helpers.js';

describe('linkedIssueNumbers', () => {
  it('matches every GitHub closing keyword, case-insensitively, with an optional colon', () => {
    const body = [
      'Closes #1',
      'closed: #2',
      'FIX #3',
      'fixes #4',
      'Fixed #5',
      'resolve #6',
      'resolves: #7',
      'RESOLVED #8',
      'close #9',
    ].join('\n');
    expect(linkedIssueNumbers(body)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('ignores a bare mention and de-duplicates', () => {
    expect(linkedIssueNumbers('See #12 for context. Fixes #13. fixes #13')).toEqual([13]);
  });

  it('handles no body', () => {
    expect(linkedIssueNumbers(null)).toEqual([]);
  });
});

describe('crossRepoIssueRefs', () => {
  it('records a cross-repo reference instead of fetching it', () => {
    expect(crossRepoIssueRefs('Fixes octo-org/octo-repo#100')).toEqual(['octo-org/octo-repo#100']);
  });
});

describe('docReferences', () => {
  it('finds repo-relative markdown paths', () => {
    const refs = docReferences(
      'Implements docs/plans/rate-limit.md and server/specs/limits.md',
      'acme',
      'payments-api',
    );
    expect(refs).toEqual(['docs/plans/rate-limit.md', 'server/specs/limits.md']);
  });

  it('reduces a same-repo blob URL to its path', () => {
    expect(
      docReferences(
        'See https://github.com/acme/payments-api/blob/main/docs/plans/x.md',
        'acme',
        'payments-api',
      ),
    ).toEqual(['docs/plans/x.md']);
  });

  it('ignores another repository’s blob URL and non-markdown files', () => {
    expect(
      docReferences(
        'https://github.com/other/repo/blob/main/docs/x.md and src/index.ts',
        'acme',
        'payments-api',
      ),
    ).toEqual([]);
  });
});

describe('computeConfidence', () => {
  it('is high only with a description plus a ticket or document', () => {
    expect(
      computeConfidence({ hasBody: true, hasIssue: true, hasDoc: false, missingContext: [] }),
    ).toBe('high');
    expect(
      computeConfidence({ hasBody: true, hasIssue: false, hasDoc: true, missingContext: [] }),
    ).toBe('high');
  });

  it('is medium with exactly one source', () => {
    expect(
      computeConfidence({ hasBody: true, hasIssue: false, hasDoc: false, missingContext: [] }),
    ).toBe('medium');
    expect(
      computeConfidence({ hasBody: false, hasIssue: true, hasDoc: false, missingContext: [] }),
    ).toBe('medium');
  });

  it('is low with none — title, files and hunk headers only', () => {
    expect(
      computeConfidence({ hasBody: false, hasIssue: false, hasDoc: false, missingContext: [] }),
    ).toBe('low');
  });

  it('caps at medium when anything could not be retrieved', () => {
    expect(
      computeConfidence({
        hasBody: true,
        hasIssue: true,
        hasDoc: true,
        missingContext: ['issue #7 could not be fetched: 404'],
      }),
    ).toBe('medium');
  });
});
