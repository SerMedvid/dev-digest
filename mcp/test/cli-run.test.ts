/**
 * Every branch of the CLI's contract, with fake deps — no processes, no
 * sockets. What each branch writes to WHICH stream matters as much as the exit
 * code: stdout is the parseable payload, stderr is everything else.
 */
import { describe, it, expect } from 'vitest';
import { runReviewCommand, type CliDeps } from '../src/cli/run.js';
import { parseArgs } from '../src/cli/args.js';
import { ApiHttpError, ApiUnavailableError } from '../src/api.js';
import { makeFakeApi } from './helpers/fake-api.js';
import type { AdhocReviewRef } from '../src/types.js';

const DIFF = 'diff --git a/a.ts b/a.ts\n@@ -1 +1,2 @@\n a\n+b\n';

interface Harness {
  deps: CliDeps;
  out: string[];
  err: string[];
}

function harness(over: {
  root?: string | null;
  diff?: string;
  untracked?: number;
  adhoc?: Partial<AdhocReviewRef>;
  reviewAdhoc?: CliDeps['api']['reviewAdhoc'];
} = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const fake = makeFakeApi(
    over.adhoc
      ? { adhoc: { ...makeFakeApiDefaults(), ...over.adhoc } as AdhocReviewRef }
      : {},
  );
  return {
    out,
    err,
    deps: {
      git: {
        repoRoot: async () => (over.root === undefined ? '/repo' : over.root),
        workingDiff: async () => over.diff ?? DIFF,
        untrackedCount: async () => over.untracked ?? 0,
      },
      api: { reviewAdhoc: over.reviewAdhoc ?? fake.reviewAdhoc },
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      cwd: '/repo/sub',
    },
  };
}

/** The fake's default adhoc payload, so a partial override stays well-typed. */
function makeFakeApiDefaults(): AdhocReviewRef {
  return {
    review: { verdict: 'approve', summary: 'Nothing blocking.', score: 92, findings: [] },
    blockers: 0,
    dropped: [],
    scope_dropped: [],
    agent: { name: 'Security Reviewer', ci_fail_on: 'critical' },
    model: 'claude-opus-5',
  };
}

describe('runReviewCommand — the review ran', () => {
  it('prints the review to stdout and exits 0 when nothing blocks', async () => {
    const h = harness();
    const code = await runReviewCommand({ mode: 'working' }, h.deps);
    expect(code).toBe(0);
    expect(h.out.join('\n')).toContain('blockers: 0');
    expect(h.err).toEqual([]);
  });

  it('exits 1 when the review found blockers — a different code from "could not run"', async () => {
    const h = harness({ adhoc: { blockers: 2 } });
    const code = await runReviewCommand({ mode: 'working' }, h.deps);
    expect(code).toBe(1);
    expect(h.out.join('\n')).toContain('blockers: 2');
  });

  it('passes the agent name through when given', async () => {
    const seen: Array<[string, string | undefined]> = [];
    const h = harness({
      reviewAdhoc: async (diff, agent) => {
        seen.push([diff, agent]);
        return makeFakeApiDefaults();
      },
    });
    await runReviewCommand({ mode: 'working', agent: 'Security Reviewer' }, h.deps);
    expect(seen[0]![1]).toBe('Security Reviewer');
  });
});

describe('runReviewCommand — untracked files', () => {
  it('warns on stderr and still reviews the tracked changes', async () => {
    const h = harness({ untracked: 3 });
    const code = await runReviewCommand({ mode: 'working' }, h.deps);

    expect(h.err.join('\n')).toContain('3 untracked file(s) not reviewed');
    expect(h.err.join('\n')).toContain('git diff HEAD does not see them');
    // The warning is not a failure — the tracked diff was still reviewed.
    expect(code).toBe(0);
    expect(h.out.join('\n')).toContain('blockers: 0');
  });

  it('keeps the warning off stdout, which a CI step parses', async () => {
    const h = harness({ untracked: 1 });
    await runReviewCommand({ mode: 'working' }, h.deps);
    expect(h.out.join('\n')).not.toContain('untracked');
  });
});

describe('runReviewCommand — nothing to do', () => {
  it('exits 0 on an empty diff, saying so on stdout', async () => {
    const h = harness({ diff: '   \n' });
    const code = await runReviewCommand({ mode: 'working' }, h.deps);
    expect(code).toBe(0);
    expect(h.out).toEqual(['Nothing to review.']);
  });

  it('does not call the API for an empty diff', async () => {
    let called = 0;
    const h = harness({
      diff: '',
      reviewAdhoc: async () => {
        called++;
        return makeFakeApiDefaults();
      },
    });
    await runReviewCommand({ mode: 'working' }, h.deps);
    expect(called).toBe(0);
  });
});

describe('runReviewCommand — could not run (exit 2)', () => {
  it('refuses a directory that is not a git repository', async () => {
    const h = harness({ root: null });
    const code = await runReviewCommand({ mode: 'working' }, h.deps);
    expect(code).toBe(2);
    expect(h.err.join('\n')).toContain('Not a git repository');
    expect(h.out).toEqual([]);
  });

  it('refuses the unimplemented modes by name', async () => {
    for (const mode of ['staged', 'branch'] as const) {
      const h = harness();
      const code = await runReviewCommand({ mode }, h.deps);
      expect(code).toBe(2);
      expect(h.err.join('\n')).toContain(`--mode ${mode} is not implemented`);
    }
  });

  it('names DEVDIGEST_API_URL and how to start the server when it is unreachable', async () => {
    const h = harness({
      reviewAdhoc: async () => {
        throw new ApiUnavailableError('http://localhost:3001', new Error('ECONNREFUSED'));
      },
    });
    const code = await runReviewCommand({ mode: 'working' }, h.deps);
    expect(code).toBe(2);
    expect(h.err.join('\n')).toContain('http://localhost:3001');
    expect(h.err.join('\n')).toContain('DEVDIGEST_API_URL');
    expect(h.err.join('\n')).toContain('pnpm dev');
  });

  it("surfaces an API error's own message rather than a generic one", async () => {
    const h = harness({
      reviewAdhoc: async () => {
        throw new ApiHttpError(409, 'no_agents', 'No enabled agents — create one.');
      },
    });
    const code = await runReviewCommand({ mode: 'working' }, h.deps);
    expect(code).toBe(2);
    expect(h.err.join('\n')).toContain('No enabled agents');
    expect(h.err.join('\n')).toContain('409');
  });

  it('handles an unexpected failure without leaking a stack to stdout', async () => {
    const h = harness({
      reviewAdhoc: async () => {
        throw new Error('something odd');
      },
    });
    expect(await runReviewCommand({ mode: 'working' }, h.deps)).toBe(2);
    expect(h.out).toEqual([]);
    expect(h.err.join('\n')).toContain('something odd');
  });
});

describe('parseArgs', () => {
  it('accepts the documented invocation', () => {
    const got = parseArgs(['review', '--mode', 'working', '--agent', 'Sec']);
    expect(got).toEqual({ ok: true, opts: { mode: 'working', agent: 'Sec' } });
  });

  it('omits agent entirely when not given', () => {
    const got = parseArgs(['review', '--mode', 'working']);
    expect(got).toEqual({ ok: true, opts: { mode: 'working' } });
  });

  it('ignores a bare -- separator, which pnpm forwards verbatim', () => {
    // `pnpm review -- --mode working` reaches us as ['review', '--', ...].
    expect(parseArgs(['review', '--', '--mode', 'working'])).toEqual({
      ok: true,
      opts: { mode: 'working' },
    });
  });

  it('requires --mode rather than guessing one', () => {
    expect(parseArgs(['review'])).toEqual({ ok: false, message: '--mode is required.' });
  });

  it('rejects an unknown command, option, mode, and a flag with no value', () => {
    expect(parseArgs(['frobnicate'])).toMatchObject({ ok: false });
    expect(parseArgs(['review', '--mode', 'working', '--wat'])).toMatchObject({ ok: false });
    expect(parseArgs(['review', '--mode', 'sideways'])).toMatchObject({ ok: false });
    expect(parseArgs(['review', '--mode'])).toEqual({
      ok: false,
      message: '--mode needs a value.',
    });
  });

  it('treats --help as a usage request, not an error', () => {
    expect(parseArgs(['--help'])).toEqual({ ok: false, message: null });
    expect(parseArgs(['-h'])).toEqual({ ok: false, message: null });
  });
});
