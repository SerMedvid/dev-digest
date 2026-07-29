import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Finding, PrFindingPreview } from '@devdigest/shared';
import { Severity } from '@devdigest/shared';
import type { FindingRow, PullRow } from '../../../db/rows.js';

export type ReviewRow = typeof t.reviews.$inferSelect;

// ---- reviews + findings ---------------------------------------------------

export async function insertReview(
  db: Db,
  values: {
    workspaceId: string;
    prId: string;
    agentId: string | null;
    runId: string | null;
    kind: 'summary' | 'review';
    verdict: string | null;
    summary: string | null;
    score: number | null;
    model: string | null;
  },
): Promise<ReviewRow> {
  const [row] = await db.insert(t.reviews).values(values).returning();
  return row!;
}

export async function insertFindings(
  db: Db,
  reviewId: string,
  findings: Finding[],
): Promise<FindingRow[]> {
  if (findings.length === 0) return [];
  const rows = await db
    .insert(t.findings)
    .values(
      findings.map((f) => ({
        reviewId,
        file: f.file,
        startLine: f.start_line,
        endLine: f.end_line,
        severity: f.severity,
        category: f.category,
        title: f.title,
        rationale: f.rationale,
        suggestion: f.suggestion ?? null,
        confidence: f.confidence,
        kind: f.kind ?? 'finding',
        trifectaComponents: f.trifecta_components ?? null,
      })),
    )
    .returning();
  return rows;
}

/** Reviews for a PR (newest first), each with its findings. */
export async function reviewsForPull(
  db: Db,
  prId: string,
): Promise<{ review: ReviewRow; findings: FindingRow[] }[]> {
  const reviews = await db
    .select()
    .from(t.reviews)
    .where(eq(t.reviews.prId, prId))
    .orderBy(desc(t.reviews.createdAt));
  if (reviews.length === 0) return [];
  const ids = reviews.map((r) => r.id);
  const findings = await db.select().from(t.findings).where(inArray(t.findings.reviewId, ids));
  return reviews.map((review) => ({
    review,
    findings: findings.filter((f) => f.reviewId === review.id),
  }));
}

// ---- PR-list findings roll-up ---------------------------------------------

/** How many findings the list's breakdown card samples per PR. */
const PREVIEW_LIMIT = 6;
/** Rationales are truncated in SQL — full ones never leave the DB on the list. */
const RATIONALE_SNIPPET_LEN = 280;

export interface PrFindingsSummary {
  counts: { CRITICAL: number; WARNING: number; SUGGESTION: number };
  preview: PrFindingPreview[];
}

const KNOWN_SEVERITIES = new Set<string>(Severity.options);

/**
 * Per-severity counts + a capped preview of every NON-DISMISSED finding on each
 * of `prIds`, in ONE query for the whole page (never one per PR). Counts and
 * preview come from the same rows: the query pre-orders by severity rank then
 * confidence, so "the first 6 per PR" is a plain JS truncation — no window
 * function. PRs with no non-dismissed findings are absent from the Map, which
 * is how the route renders `null` rather than zeros.
 *
 * `findings.severity` is a plain text column (the enum lives only at the
 * contract layer), so a row with an unrecognised severity is folded out of BOTH
 * the counts and the preview rather than miscounted or failing zod downstream.
 */
export async function findingsSummaryByPr(
  db: Db,
  workspaceId: string,
  prIds: string[],
): Promise<Map<string, PrFindingsSummary>> {
  const out = new Map<string, PrFindingsSummary>();
  if (prIds.length === 0) return out;

  const severityRank = sql`case ${t.findings.severity}
      when 'CRITICAL' then 0
      when 'WARNING' then 1
      when 'SUGGESTION' then 2
      else 3
    end`;

  const rows = await db
    .select({
      prId: t.reviews.prId,
      id: t.findings.id,
      severity: t.findings.severity,
      category: t.findings.category,
      title: t.findings.title,
      file: t.findings.file,
      startLine: t.findings.startLine,
      endLine: t.findings.endLine,
      confidence: t.findings.confidence,
      snippet: sql<string>`left(${t.findings.rationale}, ${RATIONALE_SNIPPET_LEN})`,
    })
    .from(t.findings)
    .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
    .where(
      and(
        // Workspace scoping is load-bearing, not decoration.
        eq(t.reviews.workspaceId, workspaceId),
        inArray(t.reviews.prId, prIds),
        isNull(t.findings.dismissedAt),
      ),
    )
    .orderBy(asc(t.reviews.prId), severityRank, desc(t.findings.confidence));

  for (const row of rows) {
    if (!KNOWN_SEVERITIES.has(row.severity)) continue;
    const severity = row.severity as PrFindingPreview['severity'];
    let summary = out.get(row.prId);
    if (!summary) {
      summary = { counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }, preview: [] };
      out.set(row.prId, summary);
    }
    summary.counts[severity] += 1;
    if (summary.preview.length < PREVIEW_LIMIT) {
      summary.preview.push({
        id: row.id,
        severity,
        category: row.category,
        title: row.title,
        file: row.file,
        start_line: row.startLine,
        end_line: row.endLine,
        confidence: Number(row.confidence),
        rationale_snippet: row.snippet ?? '',
      });
    }
  }
  return out;
}

export async function getReview(db: Db, reviewId: string): Promise<ReviewRow | undefined> {
  const [row] = await db.select().from(t.reviews).where(eq(t.reviews.id, reviewId));
  return row;
}

/** Delete a whole review (one agent's run) + its findings (cascade), scoped
 *  to the workspace. Returns false if not found in the workspace. */
export async function deleteReview(
  db: Db,
  workspaceId: string,
  reviewId: string,
): Promise<boolean> {
  const rows = await db
    .delete(t.reviews)
    .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.id, reviewId)))
    .returning({ id: t.reviews.id });
  return rows.length > 0;
}

// ---- finding actions ------------------------------------------------------

export async function getFinding(db: Db, findingId: string): Promise<FindingRow | undefined> {
  const [row] = await db.select().from(t.findings).where(eq(t.findings.id, findingId));
  return row;
}

/** Resolve workspace_id + pr_id for a finding (via review → pr). */
export async function findingContext(
  db: Db,
  findingId: string,
): Promise<{ finding: FindingRow; review: ReviewRow; pull: PullRow } | undefined> {
  const finding = await getFinding(db, findingId);
  if (!finding) return undefined;
  const review = await getReview(db, finding.reviewId);
  if (!review) return undefined;
  const [pull] = await db
    .select()
    .from(t.pullRequests)
    .where(eq(t.pullRequests.id, review.prId));
  if (!pull) return undefined;
  return { finding, review, pull };
}

export async function setFindingAccepted(
  db: Db,
  findingId: string,
  at: Date | null,
): Promise<FindingRow | undefined> {
  const [row] = await db
    .update(t.findings)
    .set({ acceptedAt: at, dismissedAt: null })
    .where(eq(t.findings.id, findingId))
    .returning();
  return row;
}

export async function setFindingDismissed(
  db: Db,
  findingId: string,
  at: Date | null,
): Promise<FindingRow | undefined> {
  const [row] = await db
    .update(t.findings)
    .set({ dismissedAt: at, acceptedAt: null })
    .where(eq(t.findings.id, findingId))
    .returning();
  return row;
}
