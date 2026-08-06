import { and, eq } from 'drizzle-orm';
import { FeatureModelChoice } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrFileSummaryRow, SmartDiffSummaryPort, UpsertSummaryInput } from './domain.js';

/**
 * The ONLY file touching `pr_file_summary`. `pr_files`/`pull_requests`/
 * `findings` are read through `container.reviewRepo` instead — they belong to
 * the reviews aggregate, and two repositories owning one table is how the two
 * drift apart (see `modules/intent/repository.ts`'s note on `pr_intent`).
 */
export class SmartDiffRepository implements SmartDiffSummaryPort {
  constructor(private db: Db) {}

  async summariesForPr(prId: string): Promise<PrFileSummaryRow[]> {
    return this.db
      .select({
        path: t.prFileSummary.path,
        headSha: t.prFileSummary.headSha,
        summary: t.prFileSummary.summary,
        provider: t.prFileSummary.provider,
        model: t.prFileSummary.model,
        createdAt: t.prFileSummary.createdAt,
      })
      .from(t.prFileSummary)
      .where(eq(t.prFileSummary.prId, prId));
  }

  /**
   * Replaces the (prId, path) row wholesale, `createdAt` included: a
   * re-derivation describes one new derivation, not the first one ever made
   * for this file (mirrors `IntentRepository.upsertIntent`'s note). Returns
   * the persisted `createdAt` so the caller's response is a faithful read of
   * the row rather than a second, separately-computed `new Date()` that can
   * differ from it by milliseconds.
   */
  async upsertSummary(prId: string, rec: UpsertSummaryInput): Promise<Date> {
    const values = {
      headSha: rec.headSha,
      summary: rec.summary,
      provider: rec.provider,
      model: rec.model,
      createdAt: new Date(),
    };
    const [row] = await this.db
      .insert(t.prFileSummary)
      .values({ prId, path: rec.path, ...values })
      .onConflictDoUpdate({
        target: [t.prFileSummary.prId, t.prFileSummary.path],
        set: values,
      })
      .returning({ createdAt: t.prFileSummary.createdAt });
    return row!.createdAt;
  }

  /**
   * The workspace's Settings choice for `file_summary`, or undefined when
   * unset. Read here rather than through `modules/settings/`, deliberately —
   * same reasoning as `IntentRepository.featureModelChoice`: that module
   * takes `Container`, so routing through it would close an import cycle the
   * `no-circular` gate rejects.
   */
  async featureModelChoice(
    workspaceId: string,
  ): Promise<{ provider: string; model: string } | undefined> {
    const rows = await this.db
      .select({ value: t.settings.value })
      .from(t.settings)
      .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')));
    const featureModels = rows[0]?.value as Record<string, unknown> | undefined;
    const parsed = FeatureModelChoice.safeParse(featureModels?.['file_summary']);
    return parsed.success ? parsed.data : undefined;
  }
}
