import { and, asc, eq } from 'drizzle-orm';
import { FeatureModelChoice } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  ConventionRecord,
  DropCounts,
  RawCandidate,
  ScanRecord,
  ScanRepoRef,
} from './domain.js';
import type { CandidatePatch, ConventionsRepoPort, ScanStats } from './ports.js';

/**
 * Conventions data-access: `conventions` + `convention_scans`. Reads `repos`
 * directly for the clone path and name — that is a cross-table read inside one
 * repository, which is allowed; importing `modules/repos/repository.ts` would
 * not be (onion law 4). Precedent: `SkillsRepository.usage()` joins `agents`.
 *
 * Rows never leave this file: everything maps to the `domain.ts` types.
 */
export class ConventionsRepository implements ConventionsRepoPort {
  constructor(private db: Db) {}

  async getRepo(workspaceId: string, repoId: string): Promise<ScanRepoRef | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, name: t.repos.name, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * The workspace's Settings choice for the `conventions` feature, or undefined
   * when unset. Read here rather than through `modules/settings/feature-models.ts`
   * for two reasons: that is another module's internals (onion law 4), and it
   * takes `Container`, so routing through it from the composition root would
   * close an import cycle the `no-circular` gate rejects.
   */
  async featureModelChoice(workspaceId: string): Promise<FeatureModelChoice | undefined> {
    const rows = await this.db
      .select({ key: t.settings.key, value: t.settings.value })
      .from(t.settings)
      .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')));
    const featureModels = rows[0]?.value as Record<string, unknown> | undefined;
    const parsed = FeatureModelChoice.safeParse(featureModels?.['conventions']);
    return parsed.success ? parsed.data : undefined;
  }

  async getScan(repoId: string): Promise<ScanRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(eq(t.conventionScans.repoId, repoId));
    if (!row) return undefined;
    return {
      status: row.status,
      poolCount: row.poolCount,
      sampleCount: row.sampleCount,
      candidateCount: row.candidateCount,
      dropped: row.dropped as DropCounts,
      provider: row.provider,
      model: row.model,
      error: row.error,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    };
  }

  /** Upsert to `queued`, wiping the previous run's statistics. */
  async queueScan(repoId: string): Promise<void> {
    const blank = {
      status: 'queued' as const,
      poolCount: 0,
      sampleCount: 0,
      candidateCount: 0,
      dropped: {},
      provider: null,
      model: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    };
    await this.db
      .insert(t.conventionScans)
      .values({ repoId, ...blank })
      .onConflictDoUpdate({ target: t.conventionScans.repoId, set: blank });
  }

  async markRunning(repoId: string, provider: string, model: string): Promise<void> {
    const set = {
      status: 'running' as const,
      provider,
      model,
      error: null,
      startedAt: new Date(),
      finishedAt: null,
    };
    await this.db
      .insert(t.conventionScans)
      .values({ repoId, ...set })
      .onConflictDoUpdate({ target: t.conventionScans.repoId, set });
  }

  /**
   * The candidates and the `done` status commit together. Two statements on one
   * connection is not the same as one transaction: a failure after the delete
   * and insert commit would leave this run's candidates sitting under a scan row
   * the worker then marks `failed`.
   */
  async completeScan(
    workspaceId: string,
    repoId: string,
    candidates: RawCandidate[],
    stats: ScanStats,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.conventions).where(eq(t.conventions.repoId, repoId));
      if (candidates.length > 0) {
        await tx.insert(t.conventions).values(toInsert(workspaceId, repoId, candidates));
      }
      await tx
        .update(t.conventionScans)
        .set({
          status: 'done',
          poolCount: stats.poolCount,
          sampleCount: stats.sampleCount,
          candidateCount: stats.candidateCount,
          dropped: stats.dropped as Record<string, number>,
          provider: stats.provider,
          model: stats.model,
          error: null,
          finishedAt: new Date(),
        })
        .where(eq(t.conventionScans.repoId, repoId));
    });
  }

  async failScan(repoId: string, error: string): Promise<void> {
    const set = { status: 'failed' as const, error, finishedAt: new Date() };
    await this.db
      .insert(t.conventionScans)
      .values({ repoId, ...set })
      .onConflictDoUpdate({ target: t.conventionScans.repoId, set });
  }

  /**
   * Replace-all on its own, without touching the scan row. A re-scan discards
   * the user's accept and reject decisions by design (see the design doc §5);
   * the UI confirms first. `completeScan` is what the worker uses — this is for
   * seeding candidates independently of a run.
   */
  async replaceCandidates(
    workspaceId: string,
    repoId: string,
    candidates: RawCandidate[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.conventions).where(eq(t.conventions.repoId, repoId));
      if (candidates.length === 0) return;
      await tx.insert(t.conventions).values(toInsert(workspaceId, repoId, candidates));
    });
  }

  async listCandidates(repoId: string): Promise<ConventionRecord[]> {
    const rows = await this.db
      .select()
      .from(t.conventions)
      .where(eq(t.conventions.repoId, repoId))
      .orderBy(asc(t.conventions.category), asc(t.conventions.createdAt));
    return rows.map(toRecord);
  }

  async listAccepted(repoId: string): Promise<ConventionRecord[]> {
    const rows = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.repoId, repoId), eq(t.conventions.status, 'accepted')))
      .orderBy(asc(t.conventions.category), asc(t.conventions.createdAt));
    return rows.map(toRecord);
  }

  async patchCandidate(
    workspaceId: string,
    id: string,
    patch: CandidatePatch,
  ): Promise<ConventionRecord | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.evidencePath !== undefined ? { evidencePath: patch.evidencePath } : {}),
        ...(patch.evidenceLine !== undefined ? { evidenceLine: patch.evidenceLine } : {}),
        ...(patch.evidenceSnippet !== undefined
          ? { evidenceSnippet: patch.evidenceSnippet }
          : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row ? toRecord(row) : undefined;
  }
}

/** Domain candidates → insertable rows. Every candidate starts undecided. */
function toInsert(workspaceId: string, repoId: string, candidates: RawCandidate[]) {
  return candidates.map((c) => ({
    workspaceId,
    repoId,
    category: c.category,
    rule: c.rule,
    evidencePath: c.evidencePath,
    evidenceLine: c.evidenceLine,
    evidenceSnippet: c.evidenceSnippet,
    confidence: c.confidence,
    status: 'pending' as const,
  }));
}

/** The one place a Drizzle row becomes a domain record. */
function toRecord(row: typeof t.conventions.$inferSelect): ConventionRecord {
  return {
    id: row.id,
    category: row.category,
    rule: row.rule,
    evidencePath: row.evidencePath,
    evidenceLine: row.evidenceLine,
    evidenceSnippet: row.evidenceSnippet,
    confidence: row.confidence,
    status: row.status,
  };
}
