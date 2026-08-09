import type { ApiClient } from '../../src/api.js';
import type {
  AgentRef,
  ConventionsRef,
  PullRef,
  RepoRef,
  ReviewRef,
  RunRef,
  StartedRun,
} from '../../src/types.js';

export interface FakeApiSeed {
  repos: RepoRef[];
  pulls: Record<string, PullRef[]>;
  agents: AgentRef[];
  runs: RunRef[][];
  reviews: ReviewRef[];
  conventions: ConventionsRef;
  started: StartedRun[];
}

const DEFAULT_SEED: FakeApiSeed = {
  repos: [{ id: 'repo-1', owner: 'acme', name: 'payments-api', full_name: 'acme/payments-api' }],
  pulls: { 'repo-1': [{ id: 'pr-1', number: 482, title: 'Add refund endpoint' }] },
  agents: [
    {
      id: 'agent-1',
      name: 'Security Reviewer',
      description: 'Finds security defects',
      provider: 'anthropic',
      model: 'claude-opus-5',
      enabled: true,
    },
  ],
  runs: [],
  reviews: [],
  conventions: { scan: { status: 'done' }, candidates: [] },
  started: [{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security Reviewer' }],
};

/**
 * In-memory ApiClient. `runs` is a QUEUE of responses: each listRuns() call
 * shifts the next entry, so a test can script "running, running, done".
 */
export function makeFakeApi(seed: Partial<FakeApiSeed> = {}): ApiClient & { calls: string[] } {
  const s: FakeApiSeed = { ...DEFAULT_SEED, ...seed };
  const runQueue = [...s.runs];
  const calls: string[] = [];

  return {
    calls,
    async listRepos() {
      calls.push('listRepos');
      return s.repos;
    },
    async listPulls(repoId) {
      calls.push(`listPulls:${repoId}`);
      return s.pulls[repoId] ?? [];
    },
    async listAgents() {
      calls.push('listAgents');
      return s.agents;
    },
    async startReview(prId, agentId) {
      calls.push(`startReview:${prId}:${agentId}`);
      return s.started;
    },
    async listRuns(prId) {
      calls.push(`listRuns:${prId}`);
      return runQueue.length > 1 ? runQueue.shift()! : (runQueue[0] ?? []);
    },
    async listReviews(prId) {
      calls.push(`listReviews:${prId}`);
      return s.reviews;
    },
    async getConventions(repoId) {
      calls.push(`getConventions:${repoId}`);
      return s.conventions;
    },
  };
}
