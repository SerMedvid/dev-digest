import { describe, it, expect } from 'vitest';
import type { GitHubClient } from '@devdigest/shared';
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
});
