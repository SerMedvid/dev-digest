import type { CliOptions } from './run.js';

/**
 * argv parsing, kept out of `main.ts` so it can be imported without running the
 * CLI — `main.ts` executes on import by design (it is the entrypoint the bin
 * shim loads), so anything testable has to live beside it, not inside it.
 *
 * Hand-rolled rather than a dependency: three flags do not justify one, and
 * `mcp/` ships no build step, so every dependency here is one a user installing
 * the CLI has to fetch.
 */

export const USAGE = `devdigest review --mode working [--agent <name>]

Reviews your local working tree with the same reviewer DevDigest runs on a
pull request, before you push.

Options:
  --mode <working|staged|branch>  Required. Only "working" is implemented;
                                  the others exit 2.
  --agent <name>                  Reviewer to use. Defaults to the workspace's
                                  earliest-created enabled agent.
  --help                          Show this message.

What is reviewed:
  Staged and unstaged changes to TRACKED files (git diff HEAD). Untracked
  files are NOT reviewed — git diff HEAD cannot see them. They are counted and
  reported on stderr; stage or commit them to include them.

Exit codes:
  0  the review ran and found no blockers (also: nothing to review)
  1  the review ran and found blockers
  2  the review could not run (not a git repo, API unreachable, bad flags)

Environment:
  DEVDIGEST_API_URL   DevDigest API base URL (default http://localhost:3001)
`;

export interface ParsedArgs {
  ok: true;
  opts: CliOptions;
}
export interface ParseFailure {
  ok: false;
  /** Printed to stderr; `null` for --help, which prints usage to stdout. */
  message: string | null;
}

export function parseArgs(argv: string[]): ParsedArgs | ParseFailure {
  if (argv.includes('--help') || argv.includes('-h')) return { ok: false, message: null };

  const [command, ...rest] = argv;
  if (command !== 'review') {
    return {
      ok: false,
      message: command ? `Unknown command "${command}".` : 'Missing command.',
    };
  }

  let mode: string | undefined;
  let agent: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    // `pnpm review -- --mode working` forwards the separator VERBATIM (pnpm 11
    // does not strip it), so a bare `--` has to be ignored rather than treated
    // as an unknown option — otherwise the invocation this package documents
    // fails on the package manager it uses.
    if (flag === '--') {
      continue;
    } else if (flag === '--mode') {
      mode = rest[++i];
      if (mode === undefined) return { ok: false, message: '--mode needs a value.' };
    } else if (flag === '--agent') {
      agent = rest[++i];
      if (agent === undefined) return { ok: false, message: '--agent needs a value.' };
    } else {
      return { ok: false, message: `Unknown option "${flag}".` };
    }
  }

  if (mode === undefined) return { ok: false, message: '--mode is required.' };
  if (mode !== 'working' && mode !== 'staged' && mode !== 'branch') {
    return { ok: false, message: `Unknown mode "${mode}". Expected working, staged or branch.` };
  }

  return { ok: true, opts: { mode, ...(agent ? { agent } : {}) } };
}
