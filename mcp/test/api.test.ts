import { describe, it, expect } from 'vitest';
import { HttpApiClient, ApiHttpError, ApiUnavailableError } from '../src/api.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('HttpApiClient', () => {
  it('GETs /repos and returns the parsed body', async () => {
    const calls: string[] = [];
    const api = new HttpApiClient('http://api.test', async (input) => {
      calls.push(String(input));
      return jsonResponse([{ id: 'r1', owner: 'acme', name: 'pay', full_name: 'acme/pay' }]);
    });

    const repos = await api.listRepos();

    expect(calls).toEqual(['http://api.test/repos']);
    expect(repos[0]?.full_name).toBe('acme/pay');
  });

  it('POSTs the agentId when starting a review and returns the runs', async () => {
    let seenBody = '';
    let seenMethod = '';
    const api = new HttpApiClient('http://api.test', async (_input, init) => {
      seenMethod = String(init?.method);
      seenBody = String(init?.body);
      return jsonResponse({ pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Sec' }] });
    });

    const runs = await api.startReview('p1', 'a1');

    expect(seenMethod).toBe('POST');
    expect(JSON.parse(seenBody)).toEqual({ agentId: 'a1' });
    expect(runs).toEqual([{ run_id: 'run1', agent_id: 'a1', agent_name: 'Sec' }]);
  });

  it('raises ApiHttpError carrying the API error code and message', async () => {
    const api = new HttpApiClient('http://api.test', async () =>
      jsonResponse({ error: { code: 'not_found', message: 'Agent not found' } }, 404),
    );

    await expect(api.listAgents()).rejects.toMatchObject({
      name: 'ApiHttpError',
      status: 404,
      code: 'not_found',
      message: 'Agent not found',
    });
  });

  it('raises ApiUnavailableError when the connection fails', async () => {
    const api = new HttpApiClient('http://api.test', async () => {
      throw new TypeError('fetch failed');
    });

    await expect(api.listRepos()).rejects.toBeInstanceOf(ApiUnavailableError);
  });
});
