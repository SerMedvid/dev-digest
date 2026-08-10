import type {
  AdhocReviewRef,
  AgentRef,
  BlastRadiusRef,
  ConventionsRef,
  PullRef,
  RepoRef,
  ReviewRef,
  RunRef,
  StartedRun,
} from './types.js';

/** The DevDigest API is not reachable at all (server down, wrong port). */
export class ApiUnavailableError extends Error {
  override readonly name = 'ApiUnavailableError';
  constructor(
    readonly apiUrl: string,
    cause: unknown,
  ) {
    super(`DevDigest API is not reachable at ${apiUrl}`, { cause });
  }
}

/** The API answered with a non-2xx status. */
export class ApiHttpError extends Error {
  override readonly name = 'ApiHttpError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Everything this package needs from the DevDigest API. Tests supply a fake. */
export interface ApiClient {
  listRepos(): Promise<RepoRef[]>;
  listPulls(repoId: string): Promise<PullRef[]>;
  listAgents(): Promise<AgentRef[]>;
  startReview(prId: string, agentId: string): Promise<StartedRun[]>;
  listRuns(prId: string): Promise<RunRef[]>;
  listReviews(prId: string): Promise<ReviewRef[]>;
  getConventions(repoId: string): Promise<ConventionsRef>;
  getBlastRadius(prId: string): Promise<BlastRadiusRef>;
  /** Stateless review of a raw unified diff — the `devdigest review` CLI. */
  reviewAdhoc(diff: string, agent?: string): Promise<AdhocReviewRef>;
}

export class HttpApiClient implements ApiClient {
  constructor(
    private readonly apiUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiUrl}${path}`, init);
    } catch (cause) {
      throw new ApiUnavailableError(this.apiUrl, cause);
    }
    if (!res.ok) {
      let code = 'http_error';
      let message = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        if (body.error?.code) code = body.error.code;
        if (body.error?.message) message = body.error.message;
      } catch {
        // Non-JSON error body — the status line above is the best we have.
      }
      throw new ApiHttpError(res.status, code, message);
    }
    return (await res.json()) as T;
  }

  listRepos(): Promise<RepoRef[]> {
    return this.request<RepoRef[]>('/repos');
  }

  listPulls(repoId: string): Promise<PullRef[]> {
    return this.request<PullRef[]>(`/repos/${repoId}/pulls`);
  }

  listAgents(): Promise<AgentRef[]> {
    return this.request<AgentRef[]>('/agents');
  }

  async startReview(prId: string, agentId: string): Promise<StartedRun[]> {
    const body = await this.request<{ runs: StartedRun[] }>(`/pulls/${prId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId }),
    });
    return body.runs;
  }

  listRuns(prId: string): Promise<RunRef[]> {
    return this.request<RunRef[]>(`/pulls/${prId}/runs`);
  }

  listReviews(prId: string): Promise<ReviewRef[]> {
    return this.request<ReviewRef[]>(`/pulls/${prId}/reviews`);
  }

  getConventions(repoId: string): Promise<ConventionsRef> {
    return this.request<ConventionsRef>(`/repos/${repoId}/conventions`);
  }

  getBlastRadius(prId: string): Promise<BlastRadiusRef> {
    return this.request<BlastRadiusRef>(`/pulls/${prId}/blast`);
  }

  reviewAdhoc(diff: string, agent?: string): Promise<AdhocReviewRef> {
    return this.request<AdhocReviewRef>('/reviews/adhoc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ diff, ...(agent ? { agent } : {}) }),
    });
  }
}
