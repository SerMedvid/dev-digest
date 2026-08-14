import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  vector,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';
import { agents } from './agents';
import { skills } from './skills';

// ============================================================ Context & codebase

/**
 * `symbols.name` and `references.to_symbol` are btree-indexed
 * (`symbols_repo_name_idx`, `references_repo_decl_symbol_idx`). Postgres rejects
 * any index row larger than ~2704 bytes, so a pathological multi-KB "name" from
 * a bad parse (e.g. a whole expression captured as an identifier) crashes the
 * indexer with `index row size … exceeds btree version 4 maximum`. Real
 * identifiers are short, so clamp these values well under the limit before
 * insert. 255 chars ≤ ~1 KB even for 4-byte code points — comfortably safe.
 */
export const MAX_INDEXED_NAME_LEN = 255;
export const clampIndexedName = (s: string): string =>
  s.length > MAX_INDEXED_NAME_LEN ? s.slice(0, MAX_INDEXED_NAME_LEN) : s;

export const codeChunks = pgTable(
  'code_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    source: text('source', { enum: ['code', 'docs', 'spec'] }).notNull().default('code'),
  },
  (t) => ({ repoIdx: index('code_chunks_repo_idx').on(t.repoId) }),
);

/**
 * `symbols` — declared identifiers (functions/classes/methods/etc.) per repo.
 *
 * T2 extension: added `endLine`, `exported`, `signature`,
 * `contentHash`. The new columns are nullable / defaulted so existing inserts
 * (blast/service.ts `persistSymbols`) keep typechecking; the T2 indexer
 * pipeline will backfill them on the next `refreshIndex`.
 *
 * `line` carries the `start_line` semantics — kept as-is so existing
 * rows survive the migration. The composite UNIQUE prevents duplicate
 * (repo, path, name, kind, line) tuples once the indexer takes over.
 */
export const symbols = pgTable(
  'symbols',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    line: integer('line'), // = start_line
    endLine: integer('end_line'), // [T2] NEW
    exported: boolean('exported').notNull().default(false), // [T2] NEW
    signature: text('signature'), // [T2] NEW
    contentHash: text('content_hash'), // [T2] NEW (nullable — backfilled by indexer)
  },
  (t) => ({
    lookupIdx: index('symbols_repo_path_idx').on(t.repoId, t.path),
    nameIdx: index('symbols_repo_name_idx').on(t.repoId, t.name),
    uq: uniqueIndex('symbols_repo_path_name_kind_line_uq').on(
      t.repoId,
      t.path,
      t.name,
      t.kind,
      t.line,
    ),
  }),
);

/**
 * `references` — call-sites / usages of symbols.
 *
 * T2 extension: added `declFile` (NULL = unresolved → feeds the
 * Phantom-gate) and `contentHash`. The legacy columns are untouched, so
 * blast/service.ts `persistReferences` keeps working.
 */
export const references = pgTable(
  'references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    fromPath: text('from_path').notNull(), // = ref_file
    toSymbol: text('to_symbol').notNull(), // = symbol_name
    line: integer('line').notNull(), // = ref_line
    declFile: text('decl_file'), // [T2] NEW — NULL = unresolved (Phantom-gate)
    contentHash: text('content_hash'), // [T2] NEW
  },
  (t) => ({
    byDecl: index('references_repo_decl_symbol_idx').on(
      t.repoId,
      t.declFile,
      t.toSymbol,
    ),
    byFile: index('references_repo_from_idx').on(t.repoId, t.fromPath),
  }),
);

/**
 * `context_attachments` — which repo documents (specs/docs/insights) an agent or
 * a skill pulls into its review prompt. **Paths only**: the document text lives
 * in the repository clone and is read per run, never copied here.
 *
 * Two nullable owner FKs rather than one polymorphic `owner_id` + `owner_kind`,
 * because an attachment must disappear when *its* owner does, and only a real
 * FK can carry `ON DELETE CASCADE`. A polymorphic id column cannot reference two
 * parents, so it would leave orphan rows behind every agent and skill deletion.
 * `owner_kind` is kept as the discriminator the repository and the wire contract
 * read; exactly one of `agent_id` / `skill_id` is ever set.
 *
 * The two unique indexes are **partial** (`WHERE agent_id IS NOT NULL` /
 * `WHERE skill_id IS NOT NULL`) and that is load-bearing, not an optimisation:
 * Postgres treats NULLs as distinct in a unique index unless it is declared
 * `NULLS NOT DISTINCT`, so a plain unique index on `(skill_id, repo_id, path)`
 * would let a skill-owned row (`agent_id` NULL) duplicate freely and would never
 * match `onConflictDoUpdate`. `settings_ws_user_key_uq` in `schema/core.ts` has
 * exactly that defect with its nullable `user_id` — don't repeat it.
 */
export const contextAttachments = pgTable(
  'context_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['agent', 'skill'] }).notNull(),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    /** Repo-relative POSIX path. No content column — and there must not be one. */
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
    createdAt: now(),
  },
  (t) => ({
    agentUq: uniqueIndex('context_attachments_agent_uq')
      .on(t.agentId, t.repoId, t.path)
      .where(sql`${t.agentId} IS NOT NULL`),
    skillUq: uniqueIndex('context_attachments_skill_uq')
      .on(t.skillId, t.repoId, t.path)
      .where(sql`${t.skillId} IS NOT NULL`),
    repoIdx: index('context_attachments_repo_idx').on(t.repoId),
    oneOwner: check(
      'context_attachments_one_owner',
      sql`(${t.agentId} IS NOT NULL) <> (${t.skillId} IS NOT NULL)`,
    ),
  }),
);

export const onboarding = pgTable('onboarding', {
  repoId: uuid('repo_id')
    .primaryKey()
    .references(() => repos.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
});
