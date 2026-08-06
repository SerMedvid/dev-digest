/**
 * GET/POST /pulls/:id/intent — the whole composition, end to end: the container
 * builds the service, the service pulls title + description + linked issue +
 * hunk headers, and the record is persisted and then served back.
 *
 * The LLM is a MockLLMProvider keyed by schema name ('Intent' — the schemaName
 * `classifyIntent` sends), so this asserts wiring, not model behaviour. Gated on
 * Docker (needs Postgres), matching the other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const INTENT_FIXTURE = {
  intent: 'Add rate limiting to public API endpoints',
  in_scope: ['Add middleware for rate limiting'],
  out_of_scope: ['Authentication changes'],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `intent-routes-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting to public API endpoints',
      body: 'Prevent abuse of the public API. Closes #471.',
      author: 'marisa.koch',
      branch: 'feat/rate-limit-public',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

d('intent endpoints (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let llm: MockLLMProvider;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    llm = new MockLLMProvider('openai', { structuredBySchema: { Intent: INTENT_FIXTURE } });
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      // The registry default for review_intent is openrouter/gemini-flash-lite,
      // so that is the provider slot the container resolves.
      overrides: { llm: { openrouter: llm }, git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    prId = pr.id;
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('404s before anything is derived', async () => {
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/intent` });
    expect(res.statusCode).toBe(404);
  });

  it('derives, persists and then serves the record', async () => {
    const post = await app.inject({ method: 'POST', url: `/pulls/${prId}/intent` });
    expect(post.statusCode).toBe(200);
    expect(post.json().intent).toBe(INTENT_FIXTURE.intent);
    expect(post.json().sources).toContain('hunk_headers');
    // Title, description and the linked issue all composed the prompt.
    expect(post.json().sources).toEqual(
      expect.arrayContaining(['title', 'description', 'issue#471', 'hunk_headers']),
    );
    expect(post.json().model).toBe('google/gemini-2.5-flash-lite');

    const get = await app.inject({ method: 'GET', url: `/pulls/${prId}/intent` });
    expect(get.statusCode).toBe(200);
    expect(get.json().pr_id).toBe(prId);
    expect(get.json().head_sha).toBe('a1b2c3d4');
    expect(['high', 'medium', 'low']).toContain(get.json().confidence);
  });

  it('sends the hunk digest to the model, never the diff bodies', () => {
    const call = llm.calls.find((c) => c.method === 'completeStructured');
    expect(call).toBeDefined();
    const sent = JSON.stringify(call!.req);
    // MockGitClient's default diff adds a line containing sk_live_xxx; the
    // digest carries hunk headers only, so it must never reach the prompt.
    expect(sent).toContain('@@');
    expect(sent).not.toContain('sk_live');
  });

  it('404s an unknown PR', async () => {
    const res = await app.inject({ method: 'POST', url: `/pulls/${crypto.randomUUID()}/intent` });
    expect(res.statusCode).toBe(404);
  });
});
