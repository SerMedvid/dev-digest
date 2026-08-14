import { and, eq, sql } from 'drizzle-orm';
import { FeatureModelChoice, type OnboardingSectionValue } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { StoredTour, TourEnvelope, TourRepoRef } from './domain.js';
import type { OnboardingRepoPort } from './ports.js';

/**
 * Onboarding data-access: the `onboarding` table only. Reads `repos` directly
 * for the clone path and name — a cross-table read inside one repository is
 * allowed; importing `modules/repos/repository.ts` would not be (onion law 4).
 * Precedent: `ConventionsRepository.getRepo`.
 *
 * `generated_at` is only ever advanced by `saveReady`. Everything else rewrites
 * `json` alone, which is what makes "last refreshed" mean the last SUCCESSFUL
 * generation rather than the last attempt.
 */
export class OnboardingRepository implements OnboardingRepoPort {
  constructor(private db: Db) {}

  async getRepo(workspaceId: string, repoId: string): Promise<TourRepoRef | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, name: t.repos.name, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * The workspace's Settings choice for the `onboarding` feature, or undefined
   * when unset. Read here rather than through `modules/settings/feature-models.ts`
   * for the same two reasons conventions gives: that is another module's
   * internals, and it takes `Container`, which would close an import cycle.
   */
  async featureModelChoice(workspaceId: string): Promise<FeatureModelChoice | undefined> {
    const rows = await this.db
      .select({ value: t.settings.value })
      .from(t.settings)
      .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')));
    const featureModels = rows[0]?.value as Record<string, unknown> | undefined;
    const parsed = FeatureModelChoice.safeParse(featureModels?.['onboarding']);
    return parsed.success ? parsed.data : undefined;
  }

  async getEnvelope(repoId: string): Promise<StoredTour | undefined> {
    const [row] = await this.db
      .select()
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    if (!row) return undefined;
    return { envelope: row.json as TourEnvelope, generatedAt: row.generatedAt };
  }

  async markRunning(repoId: string, previous: OnboardingSectionValue[]): Promise<void> {
    const existing = await this.getEnvelope(repoId);
    await this.write(repoId, {
      status: 'running',
      indexSha: existing?.envelope.indexSha ?? '',
      indexedFiles: existing?.envelope.indexedFiles ?? 0,
      sections: previous,
    });
  }

  async saveReady(repoId: string, envelope: TourEnvelope): Promise<void> {
    await this.db
      .insert(t.onboarding)
      .values({ repoId, json: envelope })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: { json: envelope, generatedAt: sql`now()` },
      });
  }

  async saveFailed(
    repoId: string,
    error: string,
    previous: OnboardingSectionValue[],
  ): Promise<void> {
    const existing = await this.getEnvelope(repoId);
    await this.write(repoId, {
      status: 'failed',
      error,
      indexSha: existing?.envelope.indexSha ?? '',
      indexedFiles: existing?.envelope.indexedFiles ?? 0,
      sections: previous,
    });
  }

  /** Upsert the envelope without touching `generated_at`. */
  private async write(repoId: string, envelope: TourEnvelope): Promise<void> {
    await this.db
      .insert(t.onboarding)
      .values({ repoId, json: envelope })
      .onConflictDoUpdate({ target: t.onboarding.repoId, set: { json: envelope } });
  }
}
