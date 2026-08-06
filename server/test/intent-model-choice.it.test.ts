/**
 * IntentRepository.featureModelChoice — the workspace's Settings choice for
 * `review_intent`, or undefined when unset. Gated on Docker (needs Postgres),
 * matching the other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FEATURE_MODELS } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('review_intent model choice (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('is undefined until the workspace picks one', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: {} });
    expect(await app.container.intentRepo.featureModelChoice(workspaceId)).toBeUndefined();
    await app.close();
  });

  it('returns the workspace choice once set', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: {} });

    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { review_intent: { provider: 'openrouter', model: 'openai/gpt-5-nano' } } },
    });
    expect(put.statusCode).toBe(200);

    expect(await app.container.intentRepo.featureModelChoice(workspaceId)).toEqual({
      provider: 'openrouter',
      model: 'openai/gpt-5-nano',
    });

    await app.close();
  });

  it('the registry default is what Settings advertises — flash-class, not gpt-4.1', () => {
    const entry = FEATURE_MODELS.find((f) => f.id === 'review_intent')!;
    expect(entry.defaultProvider).toBe('openrouter');
    expect(entry.defaultModel).toBe('google/gemini-2.5-flash-lite');
  });
});
