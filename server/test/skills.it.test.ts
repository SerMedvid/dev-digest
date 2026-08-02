import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/** CRUD over /skills. Versioning lives in the version tests below it. */
d('/skills CRUD', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const body = (over: Record<string, unknown> = {}) => ({
    name: `rubric-${Math.random().toString(36).slice(2, 8)}`,
    description: 'Rubric for overall PR quality',
    type: 'rubric',
    body: '# PR Quality Rubric\nBe specific.',
    ...over,
  });

  it('creates a skill at version 1 with source=manual', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/skills', payload: body() });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ version: 1, source: 'manual', enabled: true });
    await app.close();
  });

  it('lists skills with an agent_count of 0 when nothing links them', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: body() });
    const list = await app.inject({ method: 'GET', url: '/skills' });
    expect(list.statusCode).toBe(200);
    const row = list.json().find((s: { id: string }) => s.id === created.json().id);
    expect(row.agent_count).toBe(0);
    await app.close();
  });

  it('rejects a duplicate name in the same workspace, case-insensitively', async () => {
    const app = await makeApp();
    const payload = body({ name: 'no-then-chains' });
    expect((await app.inject({ method: 'POST', url: '/skills', payload })).statusCode).toBe(201);
    const dup = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { ...payload, name: 'No-Then-Chains' },
    });
    expect(dup.statusCode).toBe(422);
    await app.close();
  });

  it('rejects a body over the character limit', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: body({ body: 'x'.repeat(20_001) }),
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('patches name and description without touching version', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: body() })).json().id;
    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { description: 'Tightened', enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ description: 'Tightened', enabled: false, version: 1 });
    await app.close();
  });

  it('deletes a skill and 404s afterwards', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: body() })).json().id;
    expect((await app.inject({ method: 'DELETE', url: `/skills/${id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/skills/${id}` })).statusCode).toBe(404);
    await app.close();
  });

  it('404s on an unknown id and 422s on a non-uuid id', async () => {
    const app = await makeApp();
    const ghost = '00000000-0000-0000-0000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/skills/${ghost}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/skills/not-a-uuid' })).statusCode).toBe(422);
    await app.close();
  });
});
