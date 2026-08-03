import { describe, it, expect, vi } from 'vitest';
import { NotFoundError } from '../src/platform/errors.js';
import { ConventionsService } from '../src/modules/conventions/service.js';
import type {
  ConventionsRepoPort,
  ConventionsServiceDeps,
  ScanStats,
} from '../src/modules/conventions/ports.js';
import type {
  ConventionRecord,
  RawCandidate,
  ScanRecord,
} from '../src/modules/conventions/domain.js';

const WS = 'ws1';
const REPO = 'repo1';

const FILE = 'import x from "y";\nclass UserRepository {\n  find() {}\n}\n';

function raw(over: Partial<RawCandidate> = {}): RawCandidate {
  return {
    category: 'naming',
    rule: 'Always suffix repositories with Repository',
    evidencePath: 'src/a.ts',
    evidenceLine: 2,
    evidenceSnippet: 'class UserRepository {',
    confidence: 0.9,
    ...over,
  };
}

/** An in-memory repo port: enough state to assert transitions and replace-all. */
function fakeRepo(overrides: Partial<ConventionsRepoPort> = {}) {
  const state = {
    scan: undefined as ScanRecord | undefined,
    candidates: [] as ConventionRecord[],
    stats: undefined as ScanStats | undefined,
    error: undefined as string | undefined,
  };
  const port: ConventionsRepoPort = {
    getRepo: async () => ({ id: REPO, name: 'payments-api', clonePath: '/clones/payments-api' }),
    getScan: async () => state.scan,
    queueScan: async () => {
      state.scan = blankScan('queued');
    },
    markRunning: async (_id, provider, model) => {
      state.scan = { ...blankScan('running'), provider, model };
    },
    completeScan: async (_ws, _repo, candidates, stats) => {
      state.stats = stats;
      state.candidates = candidates.map((c, i) => ({ ...c, id: `c${i}`, status: 'pending' }));
      state.scan = { ...blankScan('done'), ...stats, provider: stats.provider, model: stats.model };
    },
    failScan: async (_id, error) => {
      state.error = error;
      state.scan = { ...blankScan('failed'), error };
    },
    listCandidates: async () => state.candidates,
    listAccepted: async () => state.candidates.filter((c) => c.status === 'accepted'),
    patchCandidate: async () => undefined,
    ...overrides,
  };
  return { port, state };
}

function blankScan(status: ScanRecord['status']): ScanRecord {
  return {
    status,
    poolCount: 0,
    sampleCount: 0,
    candidateCount: 0,
    dropped: {},
    provider: null,
    model: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}

function deps(over: Partial<ConventionsServiceDeps> = {}): ConventionsServiceDeps {
  const { port } = fakeRepo();
  return {
    repo: port,
    sampler: {
      configSamples: async () => [{ path: 'tsconfig.json', content: '{}', kind: 'config' }],
      readSamples: async (_clone, paths) =>
        paths.map((path) => ({ path, content: FILE, kind: 'code' as const })),
    },
    repoIntel: {
      // `src/a.ts` is the top-ranked file, so the default candidate's evidence
      // path is genuinely among the sampled files — verification keeps it.
      getTopFilesByRank: async (_id, n) =>
        Array.from({ length: n }, (_, i) => (i === 0 ? 'src/a.ts' : `src/ranked${i}.ts`)),
    },
    model: async () => ({
      provider: 'openrouter',
      model: 'cheap',
      selectFiles: async ({ pool }) => pool.slice(0, 12),
      extract: async () => [raw()],
    }),
    skills: {
      createExtracted: async () => ({ id: 'sk1' }),
      assertAgent: async () => {},
      linkToAgent: async () => {},
      deleteSkill: async () => {},
    },
    tokenCount: (text) => text.length,
    ...over,
  };
}

describe('requestScan', () => {
  it('queues a scan for an existing repo', async () => {
    const { port, state } = fakeRepo();
    const svc = new ConventionsService(deps({ repo: port }));
    await svc.requestScan(WS, REPO);
    expect(state.scan!.status).toBe('queued');
  });

  it('404s for a repo in another workspace', async () => {
    const { port } = fakeRepo({ getRepo: async () => undefined });
    const svc = new ConventionsService(deps({ repo: port }));
    await expect(svc.requestScan(WS, REPO)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('409s when a scan is already running', async () => {
    const { port } = fakeRepo({ getScan: async () => blankScan('running') });
    const svc = new ConventionsService(deps({ repo: port }));
    await expect(svc.requestScan(WS, REPO)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('allows a re-scan once the previous one finished', async () => {
    const { port } = fakeRepo({ getScan: async () => blankScan('done') });
    const svc = new ConventionsService(deps({ repo: port }));
    await expect(svc.requestScan(WS, REPO)).resolves.toBeUndefined();
  });
});

describe('runScan', () => {
  it('records the pool, the sample and the surviving candidates', async () => {
    const { port, state } = fakeRepo();
    const svc = new ConventionsService(deps({ repo: port }));
    await svc.runScan(WS, REPO);
    expect(state.stats!.poolCount).toBe(40);
    // 12 selected code files + 1 config
    expect(state.stats!.sampleCount).toBe(13);
    expect(state.stats!.candidateCount).toBe(1);
    expect(state.candidates).toHaveLength(1);
  });

  it('falls back to ranked files when selection returns nothing usable', async () => {
    const { port, state } = fakeRepo();
    const svc = new ConventionsService(
      deps({
        repo: port,
        model: async () => ({
          provider: 'openrouter',
          model: 'cheap',
          selectFiles: async () => ['does/not/exist/in/pool.ts'],
          extract: async () => [raw()],
        }),
      }),
    );
    await svc.runScan(WS, REPO);
    expect(state.stats!.sampleCount).toBeGreaterThan(1);
    expect(state.stats!.candidateCount).toBe(1);
  });

  it('still succeeds when the selection call throws', async () => {
    const { port, state } = fakeRepo();
    const warn = vi.fn();
    const svc = new ConventionsService(
      deps({
        repo: port,
        logger: { info: vi.fn(), warn },
        model: async () => ({
          provider: 'openrouter',
          model: 'cheap',
          selectFiles: async () => {
            throw new Error('rate limited');
          },
          extract: async () => [raw()],
        }),
      }),
    );
    await svc.runScan(WS, REPO);
    expect(state.scan!.status).toBe('done');
    expect(warn).toHaveBeenCalled();
  });

  it('drops a candidate whose evidence is not in the sampled files', async () => {
    const { port, state } = fakeRepo();
    const svc = new ConventionsService(
      deps({
        repo: port,
        model: async () => ({
          provider: 'openrouter',
          model: 'cheap',
          selectFiles: async ({ pool }) => pool.slice(0, 12),
          extract: async () => [raw({ evidencePath: 'src/hallucinated.ts' })],
        }),
      }),
    );
    await svc.runScan(WS, REPO);
    expect(state.stats!.candidateCount).toBe(0);
    expect(state.stats!.dropped.unknown_path).toBe(1);
  });

  it('marks the scan failed when extraction throws', async () => {
    const { port, state } = fakeRepo();
    const svc = new ConventionsService(
      deps({
        repo: port,
        model: async () => ({
          provider: 'openrouter',
          model: 'cheap',
          selectFiles: async ({ pool }) => pool.slice(0, 12),
          extract: async () => {
            throw new Error('no api key');
          },
        }),
      }),
    );
    await svc.runScan(WS, REPO);
    expect(state.scan!.status).toBe('failed');
    expect(state.error).toContain('no api key');
  });

  it('scans configs only when the repo is not indexed', async () => {
    const { port, state } = fakeRepo();
    const svc = new ConventionsService(
      deps({ repo: port, repoIntel: { getTopFilesByRank: async () => [] } }),
    );
    await svc.runScan(WS, REPO);
    expect(state.stats!.poolCount).toBe(0);
    expect(state.stats!.sampleCount).toBe(1);
    expect(state.scan!.status).toBe('done');
  });

  it('fails a scan for a repo that was never cloned', async () => {
    const { port, state } = fakeRepo({
      getRepo: async () => ({ id: REPO, name: 'r', clonePath: null }),
    });
    const svc = new ConventionsService(deps({ repo: port }));
    await svc.runScan(WS, REPO);
    expect(state.scan!.status).toBe('failed');
  });
});

describe('skillDraft and createSkill', () => {
  const accepted: ConventionRecord = { ...raw(), id: 'c1', status: 'accepted' };

  it('drafts a name, description, body and token estimate from accepted rules', async () => {
    const { port } = fakeRepo({ listAccepted: async () => [accepted] });
    const svc = new ConventionsService(deps({ repo: port }));
    const draft = await svc.skillDraft(WS, REPO);
    expect(draft.name).toBe('payments-api-conventions');
    expect(draft.description).toBe('1 house convention extracted from payments-api');
    expect(draft.type).toBe('convention');
    expect(draft.body).toContain('## always-suffix-repositories-with-repository');
    expect(draft.token_estimate).toBe(draft.body.length);
  });

  it('409s a draft with nothing accepted', async () => {
    const { port } = fakeRepo({ listAccepted: async () => [] });
    const svc = new ConventionsService(deps({ repo: port }));
    await expect(svc.skillDraft(WS, REPO)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('creates the skill with the accepted evidence paths and links the agent', async () => {
    const { port } = fakeRepo({ listAccepted: async () => [accepted] });
    const createExtracted = vi.fn(async () => ({ id: 'sk9' }));
    const linkToAgent = vi.fn(async () => {});
    const svc = new ConventionsService(
      deps({
        repo: port,
        skills: {
          createExtracted,
          assertAgent: async () => {},
          linkToAgent,
          deleteSkill: async () => {},
        },
      }),
    );
    const out = await svc.createSkill(WS, REPO, {
      name: 'payments-api-conventions',
      description: 'd',
      type: 'convention',
      body: 'edited by the user',
      agentId: 'agent1',
    });
    expect(out.id).toBe('sk9');
    expect(createExtracted).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ body: 'edited by the user', evidenceFiles: ['src/a.ts'] }),
    );
    expect(linkToAgent).toHaveBeenCalledWith('agent1', 'sk9');
  });

  it('refuses an agent outside the workspace, before writing a skill', async () => {
    const { port } = fakeRepo({ listAccepted: async () => [accepted] });
    const createExtracted = vi.fn(async () => ({ id: 'sk9' }));
    const linkToAgent = vi.fn(async () => {});
    const svc = new ConventionsService(
      deps({
        repo: port,
        skills: {
          createExtracted,
          assertAgent: async () => {
            throw new NotFoundError('Agent not found');
          },
          linkToAgent,
          deleteSkill: async () => {},
        },
      }),
    );
    await expect(
      svc.createSkill(WS, REPO, {
        name: 'n',
        description: 'd',
        type: 'convention',
        body: 'b',
        agentId: 'agent-in-another-workspace',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    // The ordering is the point: a rejected link must not leave a skill behind.
    expect(createExtracted).not.toHaveBeenCalled();
    expect(linkToAgent).not.toHaveBeenCalled();
  });

  it('deletes the skill it just created when the link fails', async () => {
    const { port } = fakeRepo({ listAccepted: async () => [accepted] });
    const deleteSkill = vi.fn(async () => {});
    const svc = new ConventionsService(
      deps({
        repo: port,
        skills: {
          createExtracted: async () => ({ id: 'sk9' }),
          assertAgent: async () => {},
          linkToAgent: async () => {
            throw new Error('agent_skills insert failed');
          },
          deleteSkill,
        },
      }),
    );
    await expect(
      svc.createSkill(WS, REPO, {
        name: 'n',
        description: 'd',
        type: 'convention',
        body: 'b',
        agentId: 'agent1',
      }),
    ).rejects.toThrow('agent_skills insert failed');
    // Otherwise the retry collides with the name this attempt already wrote.
    expect(deleteSkill).toHaveBeenCalledWith(WS, 'sk9');
  });

  it('does not link when no agent was chosen', async () => {
    const { port } = fakeRepo({ listAccepted: async () => [accepted] });
    const linkToAgent = vi.fn(async () => {});
    const svc = new ConventionsService(
      deps({
        repo: port,
        skills: {
          createExtracted: async () => ({ id: 'sk9' }),
          assertAgent: async () => {},
          linkToAgent,
          deleteSkill: async () => {},
        },
      }),
    );
    await svc.createSkill(WS, REPO, {
      name: 'n',
      description: 'd',
      type: 'convention',
      body: 'b',
    });
    expect(linkToAgent).not.toHaveBeenCalled();
  });

  it('409s a create with nothing accepted, so an extracted skill always has evidence', async () => {
    const { port } = fakeRepo({ listAccepted: async () => [] });
    const svc = new ConventionsService(deps({ repo: port }));
    await expect(
      svc.createSkill(WS, REPO, { name: 'n', description: 'd', type: 'convention', body: 'b' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('view', () => {
  it('returns a null scan for a repo that was never scanned', async () => {
    const { port } = fakeRepo();
    const svc = new ConventionsService(deps({ repo: port }));
    const view = await svc.view(WS, REPO);
    expect(view.scan).toBeNull();
    expect(view.candidates).toEqual([]);
  });

  it('404s for a repo in another workspace', async () => {
    const { port } = fakeRepo({ getRepo: async () => undefined });
    const svc = new ConventionsService(deps({ repo: port }));
    await expect(svc.view(WS, REPO)).rejects.toMatchObject({ statusCode: 404 });
  });
});
