import type { ApiClient } from './api.js';
import type { RunRef } from './types.js';

export type WaitOutcome = 'done' | 'failed' | 'cancelled' | 'timeout' | 'vanished';

export interface WaitResult {
  outcome: WaitOutcome;
  run: RunRef | null;
}

const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export interface WaitOptions {
  budgetMs: number;
  pollIntervalMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll `GET /pulls/:id/runs` until the run is terminal or the budget is spent.
 *
 * The API starts reviews fire-and-forget (ReviewService.runReview returns run
 * ids and executes in the background), so "wait for the result" has to be done
 * here. `timeout` is a normal outcome, not an error — the caller hands the
 * run id back to the model with a next step.
 */
export async function waitForRun(
  api: ApiClient,
  prId: string,
  runId: string,
  opts: WaitOptions,
): Promise<WaitResult> {
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const deadline = now() + opts.budgetMs;

  let last: RunRef | null = null;
  for (;;) {
    const runs = await api.listRuns(prId);
    last = runs.find((r) => r.run_id === runId) ?? null;

    if (last === null) return { outcome: 'vanished', run: null };
    if (last.status !== null && TERMINAL.has(last.status)) {
      return { outcome: last.status as WaitOutcome, run: last };
    }
    if (now() + opts.pollIntervalMs > deadline) return { outcome: 'timeout', run: last };

    await sleep(opts.pollIntervalMs);
  }
}
