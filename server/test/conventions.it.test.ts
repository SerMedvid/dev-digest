import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import * as t from '../src/db/schema.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

const SELECTION = { paths: ['src/index.ts'] };
const EXTRACTION = {
  candidates: [
    {
      category: 'naming',
      rule: 'Always suffix repositories with Repository',
      evidence_path: 'src/index.ts',
      evidence_line: 1,
      evidence_snippet: 'export const x = 1;',
      confidence: 0.9,
    },
  ],
};

/**
 * The five conventions endpoints against a real database. The seeded repo has
 * `clone_path: null`, so a real extraction cannot sample it — which is exactly
 * the degradation path the scan-status invariant exists for.
 */
d('/conventions', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let repoId: string;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: {
          openrouter: new MockLLMProvider('openai', {
            structuredBySchema: {
              ConventionFileSelection: SELECTION,
              ConventionExtraction: EXTRACTION,
            },
          }),
        },
      },
    });
    repoId = (await app.inject({ method: 'GET', url: '/repos' })).json()[0].id;
    workspaceId = (await app.container.auth.currentWorkspace()).id;
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  describe('GET /repos/:id/conventions', () => {
    it('reports a never-scanned repo without erroring', async () => {
      const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ scan: null, candidates: [] });
    });

    it('404s a repo id that belongs to no repo', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/repos/11111111-1111-1111-1111-111111111111/conventions',
      });
      expect(res.statusCode).toBe(404);
    });

    it('422s a non-uuid repo id', async () => {
      const res = await app.inject({ method: 'GET', url: '/repos/not-a-uuid/conventions' });
      expect(res.statusCode).toBe(422);
    });
  });

  describe('POST /repos/:id/conventions/extract', () => {
    it('accepts the scan and leaves a scan row behind', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().jobId).toBeTruthy();

      await app.container.jobs.onIdle();
      const view = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
      const scan = view.json().scan;
      // The seeded repo has no clone on disk, so a real run cannot sample it. Both
      // outcomes are valid here; what must never happen is a scan left `running`.
      expect(['done', 'failed']).toContain(scan.status);
      expect(scan.status).not.toBe('running');
    });

    it('409s a second scan while one is in flight', async () => {
      // queueScan directly so the state is 'queued' with no worker race.
      await app.container.conventionsRepo.queueScan(repoId);
      const res = await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('conflict');
    });
  });

  describe('PATCH /conventions/:id', () => {
    let candidateId: string;

    beforeAll(async () => {
      await app.container.conventionsRepo.replaceCandidates(workspaceId, repoId, [
        {
          category: 'naming',
          rule: 'Always suffix repositories with Repository',
          evidencePath: 'src/index.ts',
          evidenceLine: 1,
          evidenceSnippet: 'export const x = 1;',
          confidence: 0.9,
        },
      ]);
      const view = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
      candidateId = view.json().candidates[0].id;
    });

    it('accepts a candidate', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/conventions/${candidateId}`,
        payload: { status: 'accepted' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('accepted');
    });

    it('edits the rule and its evidence', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/conventions/${candidateId}`,
        payload: { rule: 'Always name repositories <Entity>Repository', evidence_line: 2 },
      });
      expect(res.json()).toMatchObject({
        rule: 'Always name repositories <Entity>Repository',
        evidence_line: 2,
      });
    });

    it('422s an empty rule and a zero line', async () => {
      const empty = await app.inject({
        method: 'PATCH',
        url: `/conventions/${candidateId}`,
        payload: { rule: '' },
      });
      expect(empty.statusCode).toBe(422);
      const zero = await app.inject({
        method: 'PATCH',
        url: `/conventions/${candidateId}`,
        payload: { evidence_line: 0 },
      });
      expect(zero.statusCode).toBe(422);
    });

    it('404s a candidate that does not exist', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/conventions/11111111-1111-1111-1111-111111111111',
        payload: { status: 'rejected' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('the skill draft and its creation', () => {
    it('drafts from the accepted candidates', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/repos/${repoId}/conventions/skill-draft`,
      });
      expect(res.statusCode).toBe(200);
      const draft = res.json();
      expect(draft.type).toBe('convention');
      expect(draft.body).toContain('Always name repositories');
      expect(draft.token_estimate).toBeGreaterThan(0);
    });

    it('creates an extracted skill, links the agent, and bumps its version', async () => {
      const agent = (await app.inject({ method: 'GET', url: '/agents' })).json()[0];

      const res = await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/skill`,
        payload: {
          name: 'payments-api-conventions',
          description: '1 house convention extracted from payments-api',
          type: 'convention',
          body: '# payments-api-conventions\n\nAlways name repositories <Entity>Repository.',
          agent_id: agent.id,
        },
      });
      expect(res.statusCode).toBe(201);
      const skill = res.json();
      expect(skill.source).toBe('extracted');
      expect(skill.evidence_files).toEqual(['src/index.ts']);

      const linked = await app.inject({ method: 'GET', url: `/agents/${agent.id}/skills` });
      expect(JSON.stringify(linked.json())).toContain(skill.id);

      const after = await app.inject({ method: 'GET', url: `/agents/${agent.id}` });
      expect(after.json().version).toBeGreaterThan(agent.version);
    });

    it('409s the draft once nothing is accepted', async () => {
      const view = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
      for (const c of view.json().candidates) {
        await app.inject({
          method: 'PATCH',
          url: `/conventions/${c.id}`,
          payload: { status: 'rejected' },
        });
      }
      const res = await app.inject({
        method: 'GET',
        url: `/repos/${repoId}/conventions/skill-draft`,
      });
      expect(res.statusCode).toBe(409);
    });
  });

  /**
   * Everything above runs against the seeded repo, whose `clone_path` is null —
   * so the scan fails before a single LLM call. This block gives the repo a real
   * directory, which is the only case that exercises the whole chain: settings →
   * `container.llm` → ConventionsModel → verify → finishScan. Kept last, because
   * a scan replaces every candidate the earlier cases created.
   */
  describe('a scan against a repo that is actually on disk', () => {
    let clone: string;

    beforeAll(async () => {
      clone = await mkdtemp(join(tmpdir(), 'conv-it-'));
      await writeFile(join(clone, 'tsconfig.json'), '{ "strict": true }', 'utf8');
      await pg.handle.db
        .update(t.repos)
        .set({ clonePath: clone })
        .where(eq(t.repos.id, repoId));
      // The 409 case above left the scan `queued`; clear it so this one is allowed.
      await app.container.conventionsRepo.failScan(repoId, 'reset by test');
    });

    afterAll(async () => {
      await rm(clone, { recursive: true, force: true });
    });

    it('runs both LLM steps and records the model it used', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
      });
      expect(res.statusCode).toBe(202);
      await app.container.jobs.onIdle();

      const scan = (
        await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
      ).json().scan;
      expect(scan.status).toBe('done');
      // No index rows, so the pool is empty and only the config is sampled — but
      // extraction still ran, against the injected openrouter mock.
      expect(scan.sample_count).toBe(1);
      expect(scan.provider).toBe('openrouter');
      expect(scan.model).toBe('deepseek/deepseek-v4-flash');
      // The fixture cites src/index.ts, which was never sampled: the gate drops it
      // rather than storing a citation nothing backs.
      expect(scan.candidate_count).toBe(0);
      expect(scan.dropped.unknown_path).toBe(1);
    });
  });
});
