import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrFileSummaryRow, SmartDiffSummaryPort } from './domain.js';

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
      })
      .from(t.prFileSummary)
      .where(eq(t.prFileSummary.prId, prId));
  }
}
