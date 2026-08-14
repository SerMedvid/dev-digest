import { and, eq, inArray, ne, notExists, sql } from 'drizzle-orm';
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

/** The `pr_intent.linked_issue` payload — `@devdigest/shared`'s `IssueMeta`. */
export interface LinkedIssue {
  number: number;
  title: string;
  body?: string | null;
  state: string;
}

export interface IntentUpsert {
  intent: Intent;
  /** The head commit this intent was derived against. */
  headSha: string;
  confidence: IntentConfidence;
  sources: string[];
  missingContext: string[];
  /** The first issue the PR body linked, or null when it linked none (L05). */
  linkedIssue: LinkedIssue | null;
  provider: string;
  model: string;
}

export interface StoredIntent extends Intent {
  headSha: string;
  confidence: IntentConfidence;
  sources: string[];
  missingContext: string[];
  linkedIssue: LinkedIssue | null;
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
    // In `values` so re-derivation replaces it wholesale, `null` included: an
    // issue unlinked since the last derivation must not survive as a stale
    // reference the brief would then render.
    linkedIssue: rec.linkedIssue,
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
    linkedIssue: row.linkedIssue ?? null,
    provider: row.provider,
    model: row.model,
    createdAt: row.createdAt,
  };
}

// ---- prior PRs touching the same files -------------------------------------

/**
 * One earlier PR that shares at least one changed path with the PR in view.
 * `overlapFiles` is EVERY shared path — the cap is a presentation decision and
 * belongs to the module that owns the wire shape, not to this query.
 */
export interface PriorPrRow {
  number: number;
  title: string;
  author: string;
  status: string;
  updatedAt: Date | null;
  overlapCount: number;
  overlapFiles: string[];
}

/**
 * PRs in the same repo whose files intersect `paths`, most overlap first.
 *
 * One grouped join rather than a query per PR. Grouping by the primary key is
 * what lets the other `pull_requests` columns be selected without listing each
 * in GROUP BY (Postgres functional dependency).
 */
export async function getPriorPrsTouching(
  db: Db,
  args: {
    workspaceId: string;
    repoId: string;
    excludePrId: string;
    paths: string[];
    statuses: readonly string[];
    limit: number;
  },
): Promise<PriorPrRow[]> {
  // `path IN ()` is not valid SQL, and with no paths there is no question.
  if (args.paths.length === 0) return [];

  return db
    .select({
      number: t.pullRequests.number,
      title: t.pullRequests.title,
      author: t.pullRequests.author,
      status: t.pullRequests.status,
      updatedAt: t.pullRequests.updatedAt,
      overlapCount: sql<number>`count(distinct ${t.prFiles.path})::int`,
      overlapFiles: sql<string[]>`array_agg(distinct ${t.prFiles.path})`,
    })
    .from(t.prFiles)
    .innerJoin(t.pullRequests, eq(t.prFiles.prId, t.pullRequests.id))
    .where(
      and(
        eq(t.pullRequests.workspaceId, args.workspaceId),
        eq(t.pullRequests.repoId, args.repoId),
        ne(t.pullRequests.id, args.excludePrId),
        inArray(t.pullRequests.status, [...args.statuses]),
        inArray(t.prFiles.path, args.paths),
      ),
    )
    .groupBy(t.pullRequests.id)
    .orderBy(
      sql`count(distinct ${t.prFiles.path}) desc`,
      sql`${t.pullRequests.updatedAt} desc nulls last`,
    )
    .limit(args.limit);
}

/**
 * Same-repo PRs with NO `pr_files` rows. `GET /pulls/:id` is what populates
 * that table, so these are the PRs nobody has opened — they cannot be compared,
 * and the caller reports them rather than letting an empty list read as
 * "nothing has touched these files".
 */
export async function countPrsWithoutFiles(
  db: Db,
  args: { workspaceId: string; repoId: string; excludePrId: string },
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.pullRequests)
    .where(
      and(
        eq(t.pullRequests.workspaceId, args.workspaceId),
        eq(t.pullRequests.repoId, args.repoId),
        ne(t.pullRequests.id, args.excludePrId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(t.prFiles)
            .where(eq(t.prFiles.prId, t.pullRequests.id)),
        ),
      ),
    );
  return row?.n ?? 0;
}
