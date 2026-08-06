import { describe, it, expect, vi } from 'vitest';
import type { GitHubClient } from '@devdigest/shared';
import { MAX_ISSUES } from '../src/modules/intent/constants.js';
import { GitHubIssueReader } from '../src/modules/intent/github.js';

/**
 * A `missing` note is prompt content. The provider's error text is embedded in
 * it verbatim, and a GitHub client can put a whole response body — which may
 * echo request content back — into `.message`, so it is flattened and capped.
 */
const REPO = { owner: 'acme', name: 'payments-api' };

describe('GitHubIssueReader', () => {
  it('caps the provider error text when the client cannot be resolved', async () => {
    const huge = `no token ${'A'.repeat(50_000)}`;
    const reader = new GitHubIssueReader(async () => {
      throw new Error(huge);
    });

    const { found, missing } = await reader.fetch(REPO, [471]);
    expect(found).toEqual([]);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('issue #471 could not be fetched: no token');
    expect(missing[0]!.length).toBeLessThan(300);
    expect(missing[0]!.endsWith('…')).toBe(true);
  });

  it('caps and flattens a per-issue failure, so one entry stays one line', async () => {
    const client = {
      async getIssue() {
        throw new Error(`404\nNot Found\n${'B'.repeat(9_000)}`);
      },
    } as unknown as GitHubClient;

    const { missing } = await new GitHubIssueReader(async () => client).fetch(REPO, [7]);
    expect(missing).toHaveLength(1);
    expect(missing[0]).not.toContain('\n');
    expect(missing[0]!.length).toBeLessThan(300);
    expect(missing[0]).toContain('404 Not Found');
  });

  it(`fetches only ${MAX_ISSUES} issues and reports the surplus rather than dropping it`, async () => {
    // The cap is a cost bound, but a silently dropped reference is worse than a
    // fetched one: the classifier is never told the ticket exists, so it reads
    // the PR as if the author linked nothing and describes an intent with no
    // sign that anything was missing. Every issue over the cap owes a note.
    const getIssue = vi.fn(async (_repo: unknown, n: number) => ({
      title: `Issue ${n}`,
      body: 'body',
    }));
    const client = { getIssue } as unknown as GitHubClient;
    const numbers = [1, 2, 3, 4];

    const { found, missing } = await new GitHubIssueReader(async () => client).fetch(REPO, numbers);

    expect(found).toHaveLength(MAX_ISSUES);
    expect(found.map((f) => f.label)).toEqual(numbers.slice(0, MAX_ISSUES).map((n) => `issue#${n}`));
    // The cap is a *fetch* budget: the surplus must cost no GitHub call at all.
    expect(getIssue).toHaveBeenCalledTimes(MAX_ISSUES);

    expect(missing).toHaveLength(numbers.length - MAX_ISSUES);
    for (const n of numbers.slice(MAX_ISSUES)) {
      expect(missing).toContainEqual(
        `issue #${n} was not fetched: only ${MAX_ISSUES} linked issues are read per PR`,
      );
    }
  });
});
