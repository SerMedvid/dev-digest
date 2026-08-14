import { describe, it, expect, vi } from 'vitest';
import type { OnboardingSectionValue } from '@devdigest/shared';
import { OnboardingService } from '../src/modules/onboarding/service.js';
import type { OnboardingServiceDeps, RepoIntelPort } from '../src/modules/onboarding/ports.js';
import type { StoredTour, TourEnvelope } from '../src/modules/onboarding/domain.js';

/**
 * `runGenerate` is the job body, and its one invariant is that every terminal
 * path writes a status — a tour left `running` is a permanent spinner. Most of
 * these tests exist to hold that line.
 */

const unindexed: RepoIntelPort = {
  getIndexState: async () => ({ lastIndexedSha: '', filesIndexed: 0 }),
  getTopFilesByRank: async () => [],
  getFileRank: async () => [],
  getRepoMap: async () => ({ text: '' }),
  getCriticalPaths: async () => [],
};

function harness(over: Partial<OnboardingServiceDeps> = {}) {
  let stored: StoredTour | undefined;

  const repo = {
    getRepo: vi.fn(async () => ({ id: 'r1', name: 'acme/api', clonePath: '/tmp/clone' })),
    getEnvelope: vi.fn(async () => stored),
    markRunning: vi.fn(async (_id: string, previous: OnboardingSectionValue[]) => {
      stored = {
        envelope: { status: 'running', indexSha: '', indexedFiles: 0, sections: previous },
        generatedAt: new Date(0),
      };
    }),
    saveReady: vi.fn(async (_id: string, envelope: TourEnvelope) => {
      stored = { envelope, generatedAt: new Date(1) };
    }),
    saveFailed: vi.fn(async (_id: string, error: string, previous: OnboardingSectionValue[]) => {
      stored = {
        envelope: { status: 'failed', error, indexSha: '', indexedFiles: 0, sections: previous },
        generatedAt: new Date(0),
      };
    }),
    featureModelChoice: vi.fn(async () => undefined),
  };

  const deps: OnboardingServiceDeps = {
    repo: repo as unknown as OnboardingServiceDeps['repo'],
    repoIntel: {
      getIndexState: async () => ({ lastIndexedSha: 'sha-1', filesIndexed: 12 }),
      getTopFilesByRank: async () => ['src/server.ts'],
      getFileRank: async (_r, paths) => paths.map((p) => ({ path: p, percentile: 99 })),
      getRepoMap: async () => ({ text: 'MAP' }),
      getCriticalPaths: async () => [],
    },
    clone: { readFile: async () => undefined, exists: async () => false },
    model: async () => ({
      provider: 'openai',
      model: 'gpt-4.1',
      write: async () => ({
        architecture: { body: 'b', diagram: null },
        criticalPathNotes: [{ path: 'src/server.ts', note: 'bootstrap' }],
        readingPathNotes: [],
        commandComments: [],
        firstTasks: [],
      }),
    }),
    ...over,
  };

  return { deps, repo, service: new OnboardingService(deps) };
}

describe('OnboardingService.view', () => {
  it('reports empty/never_generated when nothing is stored', async () => {
    const { service } = harness();
    const view = await service.view('w1', 'r1');
    expect(view).toMatchObject({ status: 'empty', reason: 'never_generated', sections: [] });
    expect(view.indexedFiles).toBe(12);
  });

  it('reports empty/not_indexed when the repo has no index', async () => {
    const { service } = harness({ repoIntel: unindexed });
    const view = await service.view('w1', 'r1');
    expect(view).toMatchObject({ status: 'empty', reason: 'not_indexed' });
  });

  it('404s for a repo outside the workspace', async () => {
    const { service, repo } = harness();
    repo.getRepo.mockResolvedValueOnce(undefined);
    await expect(service.view('w1', 'r1')).rejects.toThrow(/not found/i);
  });

  it('marks a tour stale when the index moved on', async () => {
    const { service, deps } = harness();
    await service.runGenerate('w1', 'r1');
    deps.repoIntel.getIndexState = async () => ({ lastIndexedSha: 'sha-2', filesIndexed: 13 });
    const view = await service.view('w1', 'r1');
    expect(view.status).toBe('ready');
    expect(view.stale).toBe(true);
  });

  it('is not stale while the index still matches', async () => {
    const { service } = harness();
    await service.runGenerate('w1', 'r1');
    const view = await service.view('w1', 'r1');
    expect(view.stale).toBe(false);
    expect(view.sections).toHaveLength(5);
  });

  it('surfaces the stored error for a failed tour', async () => {
    const { service, repo } = harness();
    await service.runGenerate('w1', 'r1');
    await repo.saveFailed('r1', 'model exploded', []);
    const view = await service.view('w1', 'r1');
    expect(view.status).toBe('failed');
    expect(view.error).toBe('model exploded');
  });
});

describe('OnboardingService.requestGenerate', () => {
  it('rejects an unknown repo', async () => {
    const { service, repo } = harness();
    repo.getRepo.mockResolvedValueOnce(undefined);
    await expect(service.requestGenerate('w1', 'r1')).rejects.toThrow(/not found/i);
  });

  it('rejects a second request while one is running', async () => {
    const { service, repo } = harness();
    repo.getEnvelope.mockResolvedValueOnce({
      envelope: { status: 'running', indexSha: '', indexedFiles: 0, sections: [] },
      generatedAt: new Date(0),
    });
    await expect(service.requestGenerate('w1', 'r1')).rejects.toThrow(/already/i);
  });

  it('reserves the slot so the screen shows running before the job starts', async () => {
    const { service, repo } = harness();
    await service.requestGenerate('w1', 'r1');
    expect(repo.markRunning).toHaveBeenCalledTimes(1);
  });
});

describe('OnboardingService.runGenerate', () => {
  it('writes a ready envelope with five sections', async () => {
    const { service, repo } = harness();
    await service.runGenerate('w1', 'r1');
    expect(repo.saveReady).toHaveBeenCalledTimes(1);
    const envelope = repo.saveReady.mock.calls[0]![1] as TourEnvelope;
    expect(envelope.status).toBe('ready');
    expect(envelope.sections).toHaveLength(5);
    expect(envelope.indexSha).toBe('sha-1');
    expect(envelope.indexedFiles).toBe(12);
  });

  it('keeps the previous sections visible while running', async () => {
    const { service, repo } = harness();
    await service.runGenerate('w1', 'r1');
    await service.runGenerate('w1', 'r1');
    const previous = repo.markRunning.mock.calls[1]![1] as unknown[];
    expect(previous).toHaveLength(5);
  });

  it('writes a failed status instead of throwing when the model fails', async () => {
    const { service, repo } = harness({
      model: async () => ({
        provider: 'openai',
        model: 'gpt-4.1',
        write: async () => {
          throw new Error('model exploded');
        },
      }),
    });
    await expect(service.runGenerate('w1', 'r1')).resolves.toBeUndefined();
    expect(repo.saveFailed).toHaveBeenCalledTimes(1);
    expect(repo.saveFailed.mock.calls[0]![1]).toMatch(/model exploded/);
  });

  it('fails cleanly when the repo has no clone on disk', async () => {
    const { service, repo } = harness();
    repo.getRepo.mockResolvedValue({ id: 'r1', name: 'acme/api', clonePath: null });
    await service.runGenerate('w1', 'r1');
    expect(repo.saveFailed).toHaveBeenCalledTimes(1);
    expect(repo.saveReady).not.toHaveBeenCalled();
  });

  it('fails cleanly when the repo is not indexed', async () => {
    const { service, repo } = harness({ repoIntel: unindexed });
    await service.runGenerate('w1', 'r1');
    expect(repo.saveFailed).toHaveBeenCalledTimes(1);
    expect(repo.saveReady).not.toHaveBeenCalled();
  });

  it('writes a status even when the repo lookup itself throws', async () => {
    const { service, repo } = harness();
    repo.getRepo.mockRejectedValueOnce(new Error('db down'));
    await expect(service.runGenerate('w1', 'r1')).resolves.toBeUndefined();
    expect(repo.saveFailed).toHaveBeenCalledTimes(1);
  });

  it('makes exactly one model call per generation', async () => {
    const write = vi.fn(async () => ({
      architecture: { body: 'b', diagram: null },
      criticalPathNotes: [],
      readingPathNotes: [],
      commandComments: [],
      firstTasks: [],
    }));
    const { service } = harness({
      model: async () => ({ provider: 'openai', model: 'gpt-4.1', write }),
    });
    await service.runGenerate('w1', 'r1');
    expect(write).toHaveBeenCalledTimes(1);
  });
});
