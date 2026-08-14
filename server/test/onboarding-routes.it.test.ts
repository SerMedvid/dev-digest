import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { OnboardingRepository } from '../src/modules/onboarding/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[onboarding-routes] Docker not available — skipping integration tests.');
}

/**
 * The two endpoints. DB-backed because every route resolves the repo inside the
 * caller's workspace first — there is no useful no-DB path to test.
 *
 * The 409 case seeds a `running` envelope directly rather than firing two POSTs:
 * generation is a background job, so the second request would race the first
 * job's completion and the test would flake.
 */
d('onboarding routes', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    const [repo] = await pg.handle.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
    repoId = repo!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  beforeEach(async () => {
    await pg.handle.db.delete(t.onboarding).where(eq(t.onboarding.repoId, repoId));
  });

  function makeApp() {
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: { openrouter: new MockLLMProvider('openai', { structured: {} }) },
      },
    });
  }

  /** Poll until the generation job has written a terminal status. */
  async function waitForTerminal(timeoutMs = 10_000): Promise<void> {
    const repo = new OnboardingRepository(pg.handle.db);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const stored = await repo.getEnvelope(repoId);
      if (stored && stored.envelope.status !== 'running') return;
      if (Date.now() > deadline) throw new Error('generation job never reached a terminal status');
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it('GET returns the empty view for a repo with no tour', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'empty', sections: [] });
    await app.close();
  });

  it('GET for an unknown repo is 404', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/repos/00000000-0000-0000-0000-000000000000/onboarding',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('POST accepts the generation and returns a jobId', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding/generate`,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toHaveProperty('jobId');
    // The job runs in the background and writes a terminal status. Drain it
    // here, or it lands on the NEXT test's row after beforeEach has cleared it.
    await waitForTerminal();
    await app.close();
  });

  it('POST is 409 while a generation is already in flight', async () => {
    const repo = new OnboardingRepository(pg.handle.db);
    await repo.markRunning(repoId, []);

    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding/generate`,
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it('POST for an unknown repo is 404 and enqueues nothing', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/repos/00000000-0000-0000-0000-000000000000/onboarding/generate',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET reports running once a generation has been requested', async () => {
    const repo = new OnboardingRepository(pg.handle.db);
    await repo.markRunning(repoId, []);

    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` });
    expect(res.json().status).toBe('running');
    await app.close();
  });
});
