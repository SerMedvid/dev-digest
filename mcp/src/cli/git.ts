import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * The three git reads the CLI needs. Every function takes `cwd` explicitly
 * rather than relying on `process.cwd()`, so the tests can run them against a
 * real throwaway repository instead of mocking git.
 *
 * `execFile` (not `exec`) — the arguments are passed as an array, so nothing
 * here goes through a shell and a path with spaces or quotes cannot become an
 * injection.
 */

/** The repository root, or `null` when `cwd` is not inside a git repository. */
export async function repoRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['rev-parse', '--show-toplevel'], { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Staged + unstaged changes to TRACKED files. This is the entire review input:
 * `git diff HEAD` cannot see untracked files, which is why `untrackedCount`
 * exists and why the exclusion is reported rather than worked around.
 */
export async function workingDiff(root: string): Promise<string> {
  const { stdout } = await exec('git', ['diff', 'HEAD'], {
    cwd: root,
    // A working tree's diff can comfortably exceed execFile's 1 MB default,
    // and a truncated diff would be reviewed as if it were complete.
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/** How many untracked files exist — counted so the CLI can say what it skipped. */
export async function untrackedCount(root: string): Promise<number> {
  const { stdout } = await exec('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.split('\n').filter((line) => line.trim().length > 0).length;
}
