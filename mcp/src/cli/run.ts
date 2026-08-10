import { ApiHttpError, ApiUnavailableError, type ApiClient } from '../api.js';
import { repoRoot, untrackedCount, workingDiff } from './git.js';
import { exitCodeFor, renderReview } from './render.js';

/**
 * The orchestrator, fully injectable: git, the API, and both output streams
 * are dependencies, so every branch below is tested without spawning a process
 * or opening a socket.
 */
export interface CliDeps {
  git: {
    repoRoot: typeof repoRoot;
    workingDiff: typeof workingDiff;
    untrackedCount: typeof untrackedCount;
  };
  api: Pick<ApiClient, 'reviewAdhoc'>;
  /** stdout — the review payload ONLY, so a CI step can parse it. */
  out(line: string): void;
  /** stderr — every diagnostic, warning and error. */
  err(line: string): void;
  cwd: string;
}

export interface CliOptions {
  mode: 'working' | 'staged' | 'branch';
  agent?: string;
}

/**
 * Exit codes are a documented contract (`--help` states the same):
 *   0 — the review ran and found no blockers (also the nothing-to-review case)
 *   1 — the review ran and found blockers
 *   2 — the review could NOT run
 * The 1/2 split is the important one: a CI step must be able to tell "your
 * code has problems" from "this tool did not work".
 */
export async function runReviewCommand(opts: CliOptions, deps: CliDeps): Promise<0 | 1 | 2> {
  if (opts.mode !== 'working') {
    deps.err(
      `--mode ${opts.mode} is not implemented yet. Use --mode working to review the current working tree.`,
    );
    return 2;
  }

  const root = await deps.git.repoRoot(deps.cwd);
  if (!root) {
    deps.err(`Not a git repository: ${deps.cwd}`);
    return 2;
  }

  const [diff, untracked] = await Promise.all([
    deps.git.workingDiff(root),
    deps.git.untrackedCount(root),
  ]);

  // Honest exclusion: `git diff HEAD` cannot see untracked files, so they are
  // counted and reported rather than silently missing from the review.
  if (untracked > 0) {
    deps.err(
      `${untracked} untracked file(s) not reviewed (git diff HEAD does not see them — stage or commit to include).`,
    );
  }

  if (diff.trim().length === 0) {
    deps.out('Nothing to review.');
    return 0;
  }

  let res;
  try {
    res = await deps.api.reviewAdhoc(diff, opts.agent);
  } catch (err) {
    if (err instanceof ApiUnavailableError) {
      deps.err(
        `Cannot reach the DevDigest API at ${err.apiUrl}. Start it with \`cd server && pnpm dev\`, or point DEVDIGEST_API_URL at a running instance.`,
      );
      return 2;
    }
    if (err instanceof ApiHttpError) {
      deps.err(`Review failed (${err.status} ${err.code}): ${err.message}`);
      return 2;
    }
    deps.err(`Review failed: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  deps.out(renderReview(res));
  return exitCodeFor(res);
}
