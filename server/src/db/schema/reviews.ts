import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  index,
  jsonb,
  timestamp,
  doublePrecision,
  boolean,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id'),
    /** The agent_run that produced this review (links the timeline run ↔ review). */
    runId: uuid('run_id'),
    kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
    verdict: text('verdict'),
    summary: text('summary'),
    score: integer('score'),
    model: text('model'),
    createdAt: now(),
  },
  // The PR list joins findings → reviews by pr_id on every render.
  (t) => ({ prIdx: index('reviews_pr_id_idx').on(t.prId) }),
);

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    severity: text('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    suggestion: text('suggestion'),
    confidence: doublePrecision('confidence').notNull(),
    kind: text('kind').notNull().default('finding'),
    /** Set by the reviewer model when an intent was in the prompt (L03). */
    outOfScope: boolean('out_of_scope').notNull().default(false),
    trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  // Same join, other side.
  (t) => ({ reviewIdx: index('findings_review_id_idx').on(t.reviewId) }),
);

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Head commit the intent was derived against — stale means re-derive. */
  headSha: text('head_sha').notNull().default(''),
  /** 'high' | 'medium' | 'low', computed from the sources that arrived. */
  confidence: text('confidence').notNull().default('low'),
  sources: jsonb('sources').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  missingContext: jsonb('missing_context').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /**
   * The first issue the PR body linked, as an `IssueMeta` (number/title/body/
   * state), or null. Nullable with no default, unlike every column above: null
   * is the honest value for "this PR links no issue", and a default would make
   * an absent issue indistinguishable from a column added before the feature.
   * Replaced wholesale on re-derivation — see `upsertIntent` (L05).
   */
  linkedIssue: jsonb('linked_issue').$type<{
    number: number;
    title: string;
    body?: string | null;
    state: string;
  }>(),
  provider: text('provider').notNull().default(''),
  model: text('model').notNull().default(''),
  createdAt: now(),
});

/**
 * The composed PR Why + Risk Brief. One row per PR — a regeneration replaces it
 * wholesale, `created_at` included, because the row describes THIS generation.
 *
 * `head_sha` is the cache key: a row written at an older head is never served,
 * because the file list, the blast map and the findings it described belong to
 * code that no longer exists.
 *
 * `review_id` is NOT part of the key. It records which review's findings fed
 * the brief; when the PR's latest review is no longer that one the response
 * carries `stale: true` and the cached row is still served, because a brief one
 * review out of date beats an empty card. Every column below is additive with a
 * default so `ADD COLUMN` was safe on the already-populated table.
 */
export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  /** The `Brief` — the five fields one structured call produced. */
  json: jsonb('json').notNull(),
  /** Head commit the brief was composed against — the cache key. */
  headSha: text('head_sha').notNull().default(''),
  /** The review whose findings fed it; null when the PR had none. A marker, not a key. */
  reviewId: uuid('review_id'),
  /** Source labels, carrying every cap that bit (`files (60 of 214)`). */
  sources: jsonb('sources').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  estTokensIn: integer('est_tokens_in').notNull().default(0),
  provider: text('provider').notNull().default(''),
  model: text('model').notNull().default(''),
  createdAt: now(),
});

/**
 * On-demand LLM summary of one changed file within a PR, keyed on (pr_id, path).
 *
 * Can't live as a column on `pr_files`: `GET /pulls/:id`
 * (server/src/modules/pulls/routes.ts) deletes and re-inserts every `pr_files`
 * row on each request to refresh from GitHub, so anything stored there is
 * destroyed by the next page load. This table is separate and keyed by
 * `head_sha` so a summary survives that churn and is only recomputed when the
 * file's content at HEAD has actually changed.
 */
export const prFileSummary = pgTable(
  'pr_file_summary',
  {
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    /** Head commit this summary was derived against — the cache key. */
    headSha: text('head_sha').notNull(),
    summary: text('summary').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    createdAt: now(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.prId, t.path] }) }),
);

/**
 * On-demand LLM explanation of a PR's blast-radius map. One row per PR — the
 * summary describes the map at ONE head, not a history, so a new head replaces
 * the row wholesale rather than accumulating.
 *
 * `head_sha` is the freshness key: a row from an older head is never served
 * (the map it described no longer exists) and the next explicit Explain click
 * replaces it. That is also why this is a table rather than a column on
 * `pr_files` — see `prFileSummary` above for the same reasoning.
 */
export const blastSummary = pgTable('blast_summary', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  /** Head commit the explained map was computed against — the cache key. */
  headSha: text('head_sha').notNull(),
  summary: text('summary').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  createdAt: now(),
});
