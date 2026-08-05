import { and, eq } from 'drizzle-orm';
import { FeatureModelChoice } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { IntentPullRef, IntentRepoRef } from './domain.js';
import type { IntentRepoPort } from './ports.js';

/**
 * Intent data-access. Reads `pull_requests`, `repos` and `settings` — all
 * cross-table reads inside one repository, which is allowed; importing another
 * module's `repository.ts` would not be.
 *
 * `pr_intent` is deliberately NOT here: it belongs to the reviews aggregate
 * (`container.reviewRepo`), and two repositories owning one table is how the
 * two drift apart.
 */
export class IntentRepository implements IntentRepoPort {
  constructor(private db: Db) {}

  async getPull(workspaceId: string, prId: string): Promise<IntentPullRef | undefined> {
    const [row] = await this.db
      .select({
        id: t.pullRequests.id,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        body: t.pullRequests.body,
        headSha: t.pullRequests.headSha,
        repoId: t.pullRequests.repoId,
      })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  async getRepo(repoId: string): Promise<IntentRepoRef | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row;
  }

  /**
   * The workspace's Settings choice for `review_intent`, or undefined when
   * unset. Read here rather than through `modules/settings/feature-models.ts`:
   * that is another module's internals, and it takes `Container`, so routing
   * through it would close an import cycle the `no-circular` gate rejects.
   */
  async featureModelChoice(
    workspaceId: string,
  ): Promise<{ provider: string; model: string } | undefined> {
    const rows = await this.db
      .select({ value: t.settings.value })
      .from(t.settings)
      .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')));
    const featureModels = rows[0]?.value as Record<string, unknown> | undefined;
    const parsed = FeatureModelChoice.safeParse(featureModels?.['review_intent']);
    return parsed.success ? parsed.data : undefined;
  }
}
