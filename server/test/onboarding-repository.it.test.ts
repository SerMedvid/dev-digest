import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { OnboardingRepository } from '../src/modules/onboarding/repository.js';
import type { TourEnvelope } from '../src/modules/onboarding/domain.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[onboarding-repository] Docker not available — skipping integration tests.');
}

/**
 * The `onboarding` table carries no status column — the envelope in `json` does
 * (see the plan's global constraints). These tests pin the two consequences of
 * that: `generated_at` means "last SUCCESSFUL generation", and a regeneration
 * keeps the previous sections readable while it runs.
 */
d('OnboardingRepository', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

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

  const ready = (body: string): TourEnvelope => ({
    status: 'ready',
    indexSha: 'sha-1',
    indexedFiles: 10,
    sections: [
      {
        id: 'architecture',
        title: 'Architecture overview',
        body,
        diagram: null,
        files: [],
        commands: [],
        tasks: [],
      },
    ],
  });

  it('returns undefined before anything is generated', async () => {
    const repo = new OnboardingRepository(pg.handle.db);
    expect(await repo.getEnvelope(repoId)).toBeUndefined();
  });

  it('resolves the repo inside its workspace and not outside it', async () => {
    const repo = new OnboardingRepository(pg.handle.db);
    expect(await repo.getRepo(workspaceId, repoId)).toMatchObject({ id: repoId });
    expect(
      await repo.getRepo('00000000-0000-0000-0000-000000000000', repoId),
    ).toBeUndefined();
  });

  it('round-trips a ready envelope and stamps generatedAt', async () => {
    const repo = new OnboardingRepository(pg.handle.db);
    await repo.saveReady(repoId, ready('first'));
    const stored = await repo.getEnvelope(repoId);
    expect(stored?.envelope.status).toBe('ready');
    expect(stored?.envelope.sections[0]?.body).toBe('first');
    expect(stored?.generatedAt).toBeInstanceOf(Date);
  });

  it('markRunning keeps the previous sections so the page does not blank out', async () => {
    const repo = new OnboardingRepository(pg.handle.db);
    await repo.saveReady(repoId, ready('first'));
    const before = await repo.getEnvelope(repoId);
    await repo.markRunning(repoId, before!.envelope.sections);
    const during = await repo.getEnvelope(repoId);
    expect(during?.envelope.status).toBe('running');
    expect(during?.envelope.sections[0]?.body).toBe('first');
    expect(during?.generatedAt).toEqual(before?.generatedAt);
  });

  it('saveFailed records the message and does not bump generatedAt', async () => {
    const repo = new OnboardingRepository(pg.handle.db);
    await repo.saveReady(repoId, ready('first'));
    const before = await repo.getEnvelope(repoId);
    await repo.saveFailed(repoId, 'model exploded', before!.envelope.sections);
    const after = await repo.getEnvelope(repoId);
    expect(after?.envelope.status).toBe('failed');
    expect(after?.envelope.error).toBe('model exploded');
    expect(after?.generatedAt).toEqual(before?.generatedAt);
  });

  it('a second successful generation advances generatedAt', async () => {
    const repo = new OnboardingRepository(pg.handle.db);
    await repo.saveReady(repoId, ready('first'));
    const first = await repo.getEnvelope(repoId);
    await new Promise((r) => setTimeout(r, 10));
    await repo.saveReady(repoId, ready('second'));
    const second = await repo.getEnvelope(repoId);
    expect(second!.generatedAt.getTime()).toBeGreaterThan(first!.generatedAt.getTime());
    expect(second?.envelope.sections[0]?.body).toBe('second');
  });

  it('featureModelChoice is undefined when the workspace has chosen nothing', async () => {
    const repo = new OnboardingRepository(pg.handle.db);
    expect(await repo.featureModelChoice(workspaceId)).toBeUndefined();
  });
});
