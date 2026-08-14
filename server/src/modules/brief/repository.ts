import { and, eq } from 'drizzle-orm';
import { FeatureModelChoice } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { BriefRepoPort, BriefRow } from './ports.js';

/**
 * The ONLY file touching `pr_brief`. The pull row, `pr_files`, `pr_intent` and
 * the reviews that feed a brief are read through `container.reviewRepo`
 * instead — they belong to the reviews aggregate, and two repositories owning
 * one table is how the two drift apart (mirrors `blast/repository.ts`).
 */
export class BriefRepository implements BriefRepoPort {
  constructor(private db: Db) {}

  async get(prId: string): Promise<BriefRow | undefined> {
    const [row] = await this.db
      .select({
        headSha: t.prBrief.headSha,
        brief: t.prBrief.json,
        reviewId: t.prBrief.reviewId,
        sources: t.prBrief.sources,
        estTokensIn: t.prBrief.estTokensIn,
        provider: t.prBrief.provider,
        model: t.prBrief.model,
        createdAt: t.prBrief.createdAt,
      })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId));
    return row;
  }

  /**
   * Replaces the PR's row wholesale, `createdAt` included: the row describes
   * ONE generation at ONE head, so a regeneration is a new brief rather than an
   * edit of the first one ever made for this PR.
   */
  async put(row: {
    prId: string;
    headSha: string;
    brief: unknown;
    reviewId: string | null;
    sources: string[];
    estTokensIn: number;
    provider: string;
    model: string;
  }): Promise<void> {
    const values = {
      json: row.brief,
      headSha: row.headSha,
      reviewId: row.reviewId,
      sources: row.sources,
      estTokensIn: row.estTokensIn,
      provider: row.provider,
      model: row.model,
      createdAt: new Date(),
    };
    await this.db
      .insert(t.prBrief)
      .values({ prId: row.prId, ...values })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: values });
  }

  /**
   * The workspace's Settings choice for `risk_brief`, or undefined when unset.
   * Read here rather than through `modules/settings/`, deliberately — that
   * module takes `Container`, so routing through it would close an import cycle
   * the `no-circular` gate rejects (INSIGHTS 2026-08-03). Same shape as
   * `BlastRepository.featureModelChoice`, for the same reason.
   */
  async featureModelChoice(
    workspaceId: string,
  ): Promise<{ provider: string; model: string } | undefined> {
    const rows = await this.db
      .select({ value: t.settings.value })
      .from(t.settings)
      .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')));
    const featureModels = rows[0]?.value as Record<string, unknown> | undefined;
    const parsed = FeatureModelChoice.safeParse(featureModels?.['risk_brief']);
    return parsed.success ? parsed.data : undefined;
  }
}
