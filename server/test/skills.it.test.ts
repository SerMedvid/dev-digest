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

/** Version history: what creates a version, what doesn't, and restore. */
d('/skills versioning', () => {
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

  it('a body change appends a version carrying the summary; list is newest-first', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: body() })).json().id;

    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { body: '# v2 body', summary: 'Added Tests dimension' },
    });
    expect(res.json().version).toBe(2);

    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({ summary: 'Added Tests dimension', body: '# v2 body' });
    expect(versions[1].summary).toBeNull();
    await app.close();
  });

  it('a rename does not create a version', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: body() })).json().id;
    await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { name: 'renamed-rule' } });
    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions).toHaveLength(1);
    await app.close();
  });

  it('saving an identical body does not create a version', async () => {
    const app = await makeApp();
    const payload = body();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload })).json().id;
    await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: payload.body } });
    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions).toHaveLength(1);
    await app.close();
  });

  it('two concurrent body saves each get their own version and snapshot', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: body() })).json().id;

    // Both requests read v1 before either writes. Computing the next version in
    // JS gave both of them "2", so the second snapshot insert hit the
    // (skill_id, version) unique index and was dropped by onConflictDoNothing —
    // leaving skills.version at 2 with a snapshot holding the other body.
    await Promise.all([
      app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: '# from A' } }),
      app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: '# from B' } }),
    ]);

    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(
      versions.slice(0, 2).map((v: { body: string }) => v.body).sort(),
    ).toEqual(['# from A', '# from B']);

    // The live row is one of the two, and its version has a matching snapshot.
    const skill = (await app.inject({ method: 'GET', url: `/skills/${id}` })).json();
    expect(skill.version).toBe(3);
    const current = versions.find((v: { version: number }) => v.version === skill.version);
    expect(current.body).toBe(skill.body);
    await app.close();
  });

  it('restore appends a new version with the old body instead of rewinding', async () => {
    const app = await makeApp();
    const payload = body();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload })).json().id;
    await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: '# v2' } });

    const restored = await app.inject({
      method: 'POST',
      url: `/skills/${id}/versions/1/restore`,
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ version: 3, body: payload.body });

    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(versions[0].summary).toBe('Restored from v1');
    await app.close();
  });

  it('stats report the agents that link the skill', async () => {
    const app = await makeApp();
    const skillId = (
      await app.inject({ method: 'POST', url: '/skills', payload: body() })
    ).json().id;

    const empty = await app.inject({ method: 'GET', url: `/skills/${skillId}/stats` });
    expect(empty.json()).toEqual({ agent_count: 0, agents: [] });

    const agentId = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Security Reviewer',
          provider: 'openai',
          model: 'gpt-4o-mini',
          system_prompt: 'Review the diff.',
        },
      })
    ).json().id;
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skillId] },
    });

    const stats = (await app.inject({ method: 'GET', url: `/skills/${skillId}/stats` })).json();
    expect(stats.agent_count).toBe(1);
    expect(stats.agents[0]).toMatchObject({
      id: agentId,
      name: 'Security Reviewer',
      enabled: true,
    });

    const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(list.find((s: { id: string }) => s.id === skillId).agent_count).toBe(1);
    await app.close();
  });

  it('404s restoring a version that was never recorded', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: body() })).json().id;
    const res = await app.inject({ method: 'POST', url: `/skills/${id}/versions/99/restore` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
