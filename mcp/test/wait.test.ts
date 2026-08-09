import { describe, it, expect } from 'vitest';
import { waitForRun } from '../src/wait.js';
import { makeFakeApi } from './helpers/fake-api.js';
import type { RunRef } from '../src/types.js';

function run(status: string, over: Partial<RunRef> = {}): RunRef {
  return {
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'Security Reviewer',
    status,
    error: null,
    score: null,
    findings_count: null,
    ...over,
  };
}

/** Deterministic clock: every sleep advances it by exactly the slept amount. */
function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe('waitForRun', () => {
  it('returns done as soon as the run reaches a terminal state', async () => {
    const api = makeFakeApi({ runs: [[run('running')], [run('done', { score: 80 })]] });
    const c = clock();

    const result = await waitForRun(api, 'pr-1', 'run-1', {
      budgetMs: 10_000,
      pollIntervalMs: 1000,
      ...c,
    });

    expect(result.outcome).toBe('done');
    expect(result.run?.score).toBe(80);
  });

  it('reports failed and keeps the run so the caller can show the error', async () => {
    const api = makeFakeApi({ runs: [[run('failed', { error: 'quota exceeded' })]] });
    const result = await waitForRun(api, 'pr-1', 'run-1', {
      budgetMs: 10_000,
      pollIntervalMs: 1000,
      ...clock(),
    });
    expect(result.outcome).toBe('failed');
    expect(result.run?.error).toBe('quota exceeded');
  });

  it('reports cancelled', async () => {
    const api = makeFakeApi({ runs: [[run('cancelled')]] });
    const result = await waitForRun(api, 'pr-1', 'run-1', {
      budgetMs: 10_000,
      pollIntervalMs: 1000,
      ...clock(),
    });
    expect(result.outcome).toBe('cancelled');
  });

  it('times out once the budget is spent, without hanging', async () => {
    const api = makeFakeApi({ runs: [[run('running')]] });
    const result = await waitForRun(api, 'pr-1', 'run-1', {
      budgetMs: 3000,
      pollIntervalMs: 1000,
      ...clock(),
    });
    expect(result.outcome).toBe('timeout');
    expect(result.run?.status).toBe('running');
  });

  it('reports vanished when the run id is absent from the list', async () => {
    const api = makeFakeApi({ runs: [[]] });
    const result = await waitForRun(api, 'pr-1', 'run-1', {
      budgetMs: 3000,
      pollIntervalMs: 1000,
      ...clock(),
    });
    expect(result.outcome).toBe('vanished');
  });
});
