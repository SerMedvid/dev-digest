/* OctokitGitHubClient.getRepoInfo — which default branch a FORK reports.
 *
 * `GET /repos/{owner}/{repo}` on a fork returns three default branches: the
 * fork's own at the top level, and the upstream's under both `parent` and
 * `source`. We clone the fork, so the fork's is the only correct answer — a
 * head taken from `parent` names a branch on a repository we never fetch, which
 * either does not exist on our remote or exists and holds different work.
 *
 * The payload here is deliberately hostile: every one of the three is a
 * different name, so any of the three wrong reads fails.
 */
import { describe, it, expect } from 'vitest';
import { OctokitGitHubClient } from '../src/adapters/github/octokit.js';

const REPO = { owner: 'SerMedvid', name: 'dev-digest' };

/** A fork payload: our branch, and two upstream ones that must not win. */
function forkPayload() {
  return {
    data: {
      default_branch: 'main',
      fork: true,
      parent: { default_branch: 'course-main' },
      source: { default_branch: 'trunk' },
    },
  };
}

/** The client builds its own Octokit in the constructor, so the seam is the
    instance field. No network is touched. */
function clientReturning(payload: unknown, calls: unknown[] = []) {
  const client = new OctokitGitHubClient('token');
  (client as unknown as { octokit: unknown }).octokit = {
    rest: {
      repos: {
        get: async (args: unknown) => {
          calls.push(args);
          return payload;
        },
      },
    },
  };
  return client;
}

describe('OctokitGitHubClient.getRepoInfo', () => {
  it("returns the fork's own default branch, never the upstream's", async () => {
    const calls: unknown[] = [];
    const client = clientReturning(forkPayload(), calls);

    const info = await client.getRepoInfo(REPO);

    expect(info.defaultBranch).toBe('main');
    expect(info.defaultBranch).not.toBe('course-main'); // parent
    expect(info.defaultBranch).not.toBe('trunk'); // source
    expect(calls[0]).toEqual({ owner: 'SerMedvid', repo: 'dev-digest' });
  });

  it('reports a non-main default branch as it is', async () => {
    // The whole reason the column could not stay a hardcoded 'main'.
    const client = clientReturning({ data: { default_branch: 'master', fork: false } });
    expect((await client.getRepoInfo(REPO)).defaultBranch).toBe('master');
  });
});
