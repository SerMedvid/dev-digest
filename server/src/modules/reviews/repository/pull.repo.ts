import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Intent, IntentConfidence } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

export interface IntentUpsert {
  intent: Intent;
  /** The head commit this intent was derived against. */
  headSha: string;
  confidence: IntentConfidence;
  sources: string[];
  missingContext: string[];
  provider: string;
  model: string;
}

export interface StoredIntent extends Intent {
  headSha: string;
  confidence: IntentConfidence;
  sources: string[];
  missingContext: string[];
  provider: string;
  model: string;
  createdAt: Date;
}

export async function upsertIntent(db: Db, prId: string, rec: IntentUpsert): Promise<void> {
  const values = {
    intent: rec.intent.intent,
    inScope: rec.intent.in_scope,
    outOfScope: rec.intent.out_of_scope,
    headSha: rec.headSha,
    confidence: rec.confidence,
    sources: rec.sources,
    missingContext: rec.missingContext,
    provider: rec.provider,
    model: rec.model,
    // Re-derivation replaces the record wholesale, timestamp included: the row
    // describes one derivation, not the first one ever made for this PR.
    createdAt: new Date(),
  };
  await db
    .insert(t.prIntent)
    .values({ prId, ...values })
    .onConflictDoUpdate({ target: t.prIntent.prId, set: values });
}

export async function getIntent(db: Db, prId: string): Promise<StoredIntent | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    headSha: row.headSha,
    confidence: row.confidence as IntentConfidence,
    sources: row.sources,
    missingContext: row.missingContext,
    provider: row.provider,
    model: row.model,
    createdAt: row.createdAt,
  };
}
