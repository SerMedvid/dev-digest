import { and, eq } from 'drizzle-orm';
import { FeatureModelChoice } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { BlastSummaryPort, BlastSummaryRow } from './ports.js';

/**
 * The ONLY file touching `blast_summary`. `pull_requests` / `pr_files` are read
 * through `container.reviewRepo` instead — they belong to the reviews
 * aggregate, and two repositories owning one table is how the two drift apart
 * (mirrors `smart-diff/repository.ts`).
 */
export class BlastRepository implements BlastSummaryPort {
  constructor(private db: Db) {}

  async get(prId: string): Promise<BlastSummaryRow | undefined> {
    const [row] = await this.db
      .select({ headSha: t.blastSummary.headSha, summary: t.blastSummary.summary })
      .from(t.blastSummary)
      .where(eq(t.blastSummary.prId, prId));
    return row;
  }

  /**
   * Replaces the PR's row wholesale, `createdAt` included: the summary
   * describes the map at ONE head, so a re-derivation is a new summary rather
   * than an edit of the first one ever made.
   */
  async put(row: {
    prId: string;
    headSha: string;
    summary: string;
    provider: string;
    model: string;
  }): Promise<void> {
    const values = {
      headSha: row.headSha,
      summary: row.summary,
      provider: row.provider,
      model: row.model,
      createdAt: new Date(),
    };
    await this.db
      .insert(t.blastSummary)
      .values({ prId: row.prId, ...values })
      .onConflictDoUpdate({ target: t.blastSummary.prId, set: values });
  }

  /**
   * The workspace's Settings choice for `blast_summary`, or undefined when
   * unset. Read here rather than through `modules/settings/`, deliberately —
   * that module takes `Container`, so routing through it would close an import
   * cycle the `no-circular` gate rejects (INSIGHTS 2026-08-03).
   */
  async featureModelChoice(
    workspaceId: string,
  ): Promise<{ provider: string; model: string } | undefined> {
    const rows = await this.db
      .select({ value: t.settings.value })
      .from(t.settings)
      .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')));
    const featureModels = rows[0]?.value as Record<string, unknown> | undefined;
    const parsed = FeatureModelChoice.safeParse(featureModels?.['blast_summary']);
    return parsed.success ? parsed.data : undefined;
  }
}
