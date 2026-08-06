/**
 * `SmartDiffService`, hermetic — no DB, no Docker, runs in the fast lane.
 *
 * Two mechanisms that need no database but do need control over WHEN a
 * dependency resolves, so they live here rather than in
 * `smart-diff-routes.it.test.ts` (whose `.it.test.ts` suffix drops the whole
 * file from the hermetic lane's `--exclude` glob) or
 * `smart-diff-summary.it.test.ts` (an `app.inject()` HTTP test can't observe
 * a race: `MockLLMProvider.completeStructured` resolves synchronously, so a
 * second inject always arrives after the first has already finished):
 *
 *   - findings-fetch degradation (SS-7): a failure reading findings must
 *     degrade to empty marks with grouping intact, not fail the whole
 *     response.
 *   - the in-flight 409 guard on `summarize()`: a second concurrent call for
 *     the same (prId, path) must reject while the first is still running, and
 *     the guard must release afterwards so a later call is allowed. Mirrors
 *     `intent-service.test.ts`'s gated-promise pattern (`404s an unknown PR
 *     and 409s a concurrent derivation`).
 */
import { describe, it, expect } from 'vitest';
import { SmartDiffService } from '../src/modules/smart-diff/service.js';
import type { SmartDiffServiceDeps } from '../src/modules/smart-diff/service.js';
import type { SmartDiffStorePort } from '../src/modules/smart-diff/domain.js';
import { AppError } from '../src/platform/errors.js';

function deps(over: Partial<SmartDiffServiceDeps> = {}): SmartDiffServiceDeps {
  return {
    store: {
      getPull: async () => ({ id: 'pr-1', headSha: 'sha-1' }),
      getPrFiles: async () => [
        { path: 'src/service.ts', additions: 5, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b' },
        { path: 'README.md', additions: 1, deletions: 0 },
      ],
      findingsForPull: async () => [],
    },
    repo: {
      summariesForPr: async () => [],
      upsertSummary: async () => {},
      featureModelChoice: async () => undefined,
    },
    model: async () => ({
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash-lite',
      summarize: async () => ({ summary: 'A one-sentence summary.' }),
    }),
    ...over,
  };
}

describe('SmartDiffService.get degradation (hermetic)', () => {
  it('degrades to empty marks, grouping intact, when findingsForPull rejects', async () => {
    const store: SmartDiffStorePort = {
      getPull: async () => ({ id: 'pr-1', headSha: 'sha-1' }),
      getPrFiles: async () => [
        { path: 'src/service.ts', additions: 5, deletions: 1 },
        { path: 'README.md', additions: 1, deletions: 0 },
      ],
      findingsForPull: async () => {
        throw new Error('db unavailable');
      },
    };
    const warnings: unknown[] = [];
    const service = new SmartDiffService(
      deps({ store, log: { warn: (obj) => warnings.push(obj) } }),
    );

    const result = await service.get('ws-1', 'pr-1');

    expect(result.groups.map((g) => g.role)).toEqual(['core', 'boilerplate']);
    for (const group of result.groups) {
      for (const file of group.files) {
        expect(file.finding_marks).toEqual([]);
      }
    }
    expect(warnings).toHaveLength(1);
  });
});

describe('SmartDiffService.summarize in-flight guard (hermetic)', () => {
  it('409s a concurrent summarize() for the same file, then releases the guard', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slow = deps({
      model: async () => ({
        provider: 'openrouter',
        model: 'google/gemini-2.5-flash-lite',
        summarize: async () => {
          await gate;
          return { summary: 'Adds a token-bucket limiter.' };
        },
      }),
    });
    const service = new SmartDiffService(slow);

    // Fire the first call but do NOT await it yet — the model call is
    // parked behind `gate`, so the guard is held for as long as we choose.
    const first = service.summarize('ws-1', 'pr-1', 'src/service.ts');

    // A second call for the SAME (prId, path) while the first is still
    // in flight must reject as a conflict, not queue or double-call the model.
    const second = service.summarize('ws-1', 'pr-1', 'src/service.ts');
    await expect(second).rejects.toBeInstanceOf(AppError);
    await expect(second).rejects.toMatchObject({ code: 'conflict', statusCode: 409 });

    // Release the gate: the first call completes normally.
    release();
    const resolved = await first;
    expect(resolved.summary).toBe('Adds a token-bucket limiter.');

    // The guard cleared in `finally`, so a later call is allowed again — a
    // failed/finished derivation must never poison the file forever.
    await expect(service.summarize('ws-1', 'pr-1', 'src/service.ts')).resolves.toBeTruthy();
  });

  it('releases the guard on a failed model call too, not just success', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((_r, reject) => (release = () => reject(new Error('provider down'))));
    const failing = deps({
      model: async () => ({
        provider: 'openrouter',
        model: 'google/gemini-2.5-flash-lite',
        summarize: async () => {
          await gate;
          return { summary: 'unreachable' };
        },
      }),
    });
    const service = new SmartDiffService(failing);

    const first = service.summarize('ws-1', 'pr-1', 'src/service.ts');
    const second = service.summarize('ws-1', 'pr-1', 'src/service.ts');
    await expect(second).rejects.toMatchObject({ code: 'conflict' });

    release();
    await expect(first).rejects.toThrow('provider down');

    // The guard released in `finally` even though the call failed: a third
    // call reaches the model again (the SAME already-rejected `gate`, so it
    // fails the identical way) rather than being rejected as a 409 conflict —
    // it's the guard clearing that's under test here, not the model succeeding.
    const third = service.summarize('ws-1', 'pr-1', 'src/service.ts');
    await expect(third).rejects.toThrow('provider down');
    await expect(third).rejects.not.toMatchObject({ code: 'conflict' });
  });
});
