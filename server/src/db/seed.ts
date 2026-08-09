import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { SEED_AGENT_SKILLS, SEED_SKILLS } from './seed-skills.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

// ---- PR #482's full nine-file diff (Smart Diff seed, design §8) ----
//
// `src/config.ts` and `src/api/users.ts` carry the seeded findings below, so
// they get real unified-diff `patch` text whose hunk header places the cited
// line at the finding's `startLine`/`endLine` (read off the findings block
// itself, not restated here) — otherwise there is no rendered line for a
// finding badge to scroll to. The other seven rows keep `patch: null`, which
// is the honest, common case (see the module's degradation table).

/**
 * Puts the Stripe key add-line at new-file line 12, matching the CRITICAL finding.
 * The token is deliberately NOT Stripe-shaped: a realistic `sk_live_` + 24-or-more
 * alphanumerics body is what GitHub push protection matches on, and it rejects
 * every push of the branch carrying it. Keep the value on one line — the hunk
 * header above and the finding's `Line 12` citation both depend on the count.
 */
const CONFIG_TS_PATCH =
  '@@ -10,2 +10,6 @@\n' +
  "   port: process.env.PORT || 3000,\n" +
  "   host: process.env.HOST || 'localhost',\n" +
  "+  stripeSecretKey: 'sk_live_EXAMPLE_NOT_A_REAL_KEY',\n" +
  '+  rateLimitWindowMs: 60_000,\n' +
  '+  rateLimitMax: 100,\n' +
  "+  retryAfterHeader: 'Retry-After',";

/** Spans new-file lines 45-52, matching the WARNING finding's start/end. */
const USERS_TS_PATCH =
  '@@ -44,4 +44,9 @@\n' +
  ' export async function listUsersWithOrders(ids: string[]) {\n' +
  '-  const rows = await db.query.users.findMany({ where: inArray(users.id, ids) });\n' +
  '-  return rows;\n' +
  '+  const result: UserWithOrders[] = [];\n' +
  '+  for (const id of ids) {\n' +
  '+    const user = await db.query.users.findFirst({ where: eq(users.id, id) });\n' +
  '+    const orders = await db.query.orders.findMany({ where: eq(orders.userId, id) });\n' +
  '+    result.push({ ...user, orders });\n' +
  '+  }\n' +
  '+  return result;\n' +
  ' }';

/**
 * The design §8 table verbatim. Sums to +247 -38 across 9 files — exactly
 * what the `pull_requests` row already claims and what `total_lines: 285` in
 * `server/test/contracts.test.ts` asserts.
 */
const SMART_DIFF_SEED_FILES: ReadonlyArray<{
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}> = [
  { path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0, patch: null },
  { path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6, patch: null },
  { path: 'src/api/users.ts', additions: 7, deletions: 2, patch: USERS_TS_PATCH },
  { path: 'src/api/public/index.ts', additions: 12, deletions: 2, patch: null },
  { path: 'src/server.ts', additions: 8, deletions: 1, patch: null },
  { path: 'src/config.ts', additions: 4, deletions: 0, patch: CONFIG_TS_PATCH },
  { path: 'package.json', additions: 3, deletions: 1, patch: null },
  { path: 'package-lock.json', additions: 92, deletions: 24, patch: null },
  { path: 'README.md', additions: 6, deletions: 2, patch: null },
];

// ---- Blast radius index slice for PR #482 (design §8) ----
//
// The seeded demo repo has `clone_path: null` and no index, so without these
// rows the Blast card could only ever show `degraded` on a fresh install — the
// acceptance demo ("a change to a shared helper shows ≥2 real callers and an
// HTTP endpoint") has to work with no clone and no model key.
//
// Consistent with the nine `pr_files` above: `src/middleware/ratelimit.ts` is
// the changed file, and its callers are files that PR touches — except
// `src/api/public/health.ts`, which is deliberately NOT in the diff. Callers
// living outside the PR is the entire point of a blast map.
//
// The version is restated rather than imported: `seed.ts` imports no module
// code today, and `repo-intel/constants.ts`'s INDEXER_VERSION is the value
// this must match (a mismatch forces a reindex, which a seeded repo with no
// clone can never complete).
const BLAST_SEED_INDEXER_VERSION = 2; // = repo-intel/constants.ts INDEXER_VERSION

const BLAST_DECL_FILE = 'src/middleware/ratelimit.ts';

const BLAST_SEED_SYMBOLS: ReadonlyArray<{
  path: string;
  name: string;
  kind: string;
  line: number;
  endLine: number;
}> = [
  { path: BLAST_DECL_FILE, name: 'rateLimit', kind: 'function', line: 12, endLine: 38 },
  { path: BLAST_DECL_FILE, name: 'bucketKey', kind: 'function', line: 41, endLine: 52 },
  // Caller-side symbols, so the map names the enclosing function at each call
  // site instead of falling back to the file's basename.
  { path: 'src/api/public/index.ts', name: 'publicRouter', kind: 'function', line: 10, endLine: 40 },
  { path: 'src/api/public/webhooks.ts', name: 'handleWebhook', kind: 'function', line: 30, endLine: 60 },
  { path: 'src/api/public/health.ts', name: 'healthRoute', kind: 'function', line: 5, endLine: 20 },
  { path: 'src/server.ts', name: 'boot', kind: 'function', line: 70, endLine: 120 },
];

const BLAST_SEED_REFERENCES: ReadonlyArray<{
  fromPath: string;
  toSymbol: string;
  line: number;
}> = [
  { fromPath: 'src/api/public/index.ts', toSymbol: 'rateLimit', line: 23 },
  { fromPath: 'src/api/public/webhooks.ts', toSymbol: 'rateLimit', line: 45 },
  { fromPath: 'src/api/public/health.ts', toSymbol: 'rateLimit', line: 11 },
  { fromPath: 'src/server.ts', toSymbol: 'rateLimit', line: 88 },
  { fromPath: 'src/api/public/index.ts', toSymbol: 'bucketKey', line: 27 },
  { fromPath: 'src/server.ts', toSymbol: 'bucketKey', line: 91 },
];

const BLAST_SEED_EDGES: ReadonlyArray<{ fromFile: string; toFile: string }> = [
  { fromFile: 'src/api/public/index.ts', toFile: BLAST_DECL_FILE },
  { fromFile: 'src/api/public/webhooks.ts', toFile: BLAST_DECL_FILE },
  { fromFile: 'src/api/public/health.ts', toFile: BLAST_DECL_FILE },
  // Depth-2 hop: server.ts reaches the middleware only through index.ts, so
  // the reverse BFS is what attributes its cron.
  { fromFile: 'src/server.ts', toFile: 'src/api/public/index.ts' },
];

/** Distinct ranks so caller ordering is deterministic on every seed. */
const BLAST_SEED_RANKS: ReadonlyArray<{ filePath: string; rank: number; percentile: number }> = [
  { filePath: 'src/api/public/index.ts', rank: 0.92, percentile: 92 },
  { filePath: 'src/api/public/webhooks.ts', rank: 0.71, percentile: 71 },
  { filePath: 'src/server.ts', rank: 0.55, percentile: 55 },
  { filePath: BLAST_DECL_FILE, rank: 0.5, percentile: 50 },
  { filePath: 'src/api/public/health.ts', rank: 0.31, percentile: 31 },
];

const BLAST_SEED_FACTS: ReadonlyArray<{
  filePath: string;
  endpoints: string[];
  crons: string[];
}> = [
  { filePath: 'src/api/public/index.ts', endpoints: ['GET /api/public/items'], crons: [] },
  { filePath: 'src/api/public/webhooks.ts', endpoints: ['POST /api/public/webhooks'], crons: [] },
  { filePath: 'src/api/public/health.ts', endpoints: ['GET /api/public/health'], crons: [] },
  { filePath: 'src/server.ts', endpoints: [], crons: ['job:reset-rate-buckets'] },
];

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, the four built-in agents (General + Security +
 * Performance + Test Quality), all on the default openrouter/deepseek-v4-flash
 * provider+model, and the built-in skills with their agent links.
 *
 * Course lessons populate the other tables (conventions, memory, eval, …) once
 * their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- pr_files: the full nine-file diff (Smart Diff seed, design §8) ----
  // Outside the `if (!pr)` block on purpose, same reasoning as the derived
  // intent block below (server/specs/intent.md §6): a DB seeded before this
  // row set existed already has PR #482, and would otherwise keep the four
  // files it was created with forever.
  //
  // `pr_files` has no unique index on `(pr_id, path)`, so
  // `onConflictDoNothing`/`onConflictDoUpdate` cannot dedupe it — replacing
  // the full set when fewer than all nine rows exist is what keeps a repeat
  // `seed()` call idempotent instead of accumulating duplicates.
  const existingPrFiles = await db
    .select({ id: t.prFiles.id })
    .from(t.prFiles)
    .where(eq(t.prFiles.prId, pr!.id));
  if (existingPrFiles.length < SMART_DIFF_SEED_FILES.length) {
    await db.delete(t.prFiles).where(eq(t.prFiles.prId, pr!.id));
    await db
      .insert(t.prFiles)
      .values(SMART_DIFF_SEED_FILES.map((f) => ({ prId: pr!.id, ...f })));
  }

  // ---- blast radius index slice (L04, design §8) ----
  // Outside the `if (!pr)` block for the same reason `pr_files` is: a DB
  // seeded before this slice existed already has PR #482 and the repo, and
  // would otherwise never acquire an index.
  //
  // The whole slice is replaced when the symbol count is short, rather than
  // upserted row by row: `references` has no unique key to conflict on, and a
  // partially-written slice (say, symbols but no ranks) produces a map with
  // callers that silently lose their ordering. All-or-nothing keeps the six
  // tables consistent with each other.
  const existingBlastSymbols = await db
    .select({ id: t.symbols.id })
    .from(t.symbols)
    .where(eq(t.symbols.repoId, repoId));
  if (existingBlastSymbols.length < BLAST_SEED_SYMBOLS.length) {
    await db.delete(t.symbols).where(eq(t.symbols.repoId, repoId));
    await db.delete(t.references).where(eq(t.references.repoId, repoId));
    await db.delete(t.fileEdges).where(eq(t.fileEdges.repoId, repoId));
    await db.delete(t.fileRank).where(eq(t.fileRank.repoId, repoId));
    await db.delete(t.fileFacts).where(eq(t.fileFacts.repoId, repoId));
    await db.delete(t.repoIndexState).where(eq(t.repoIndexState.repoId, repoId));

    await db.insert(t.repoIndexState).values({
      repoId,
      // Read off the seeded PR rather than restated, so the card can never
      // render as `index_stale` on a fresh install.
      lastIndexedSha: pr!.headSha,
      indexerVersion: BLAST_SEED_INDEXER_VERSION,
      status: 'full',
      filesIndexed: BLAST_SEED_RANKS.length,
      filesSkipped: 0,
    });
    await db
      .insert(t.symbols)
      .values(BLAST_SEED_SYMBOLS.map((s) => ({ repoId, exported: true, ...s })));
    await db
      .insert(t.references)
      .values(BLAST_SEED_REFERENCES.map((r) => ({ repoId, declFile: BLAST_DECL_FILE, ...r })));
    await db.insert(t.fileEdges).values(BLAST_SEED_EDGES.map((e) => ({ repoId, ...e })));
    await db
      .insert(t.fileRank)
      .values(BLAST_SEED_RANKS.map((r) => ({ repoId, pagerank: r.rank, hotness: 0, ...r })));
    await db.insert(t.fileFacts).values(BLAST_SEED_FACTS.map((f) => ({ repoId, ...f })));
  }

  // ---- derived intent for the demo PR (L03) ----
  // Outside the `if (!pr)` block on purpose: a DB seeded before the intent layer
  // existed already has PR #482, and would otherwise never acquire a card.
  //
  // `head_sha` is read off the seeded row rather than restated, so the card can
  // never render as stale on a fresh install. `low` confidence with an empty
  // missing-context list is the honest state for a seeded row: nothing was
  // fetched, so the only sources are the title, the description and the changed
  // files. `provider`/`model` say `seed` for the same reason — no model ran.
  await db
    .insert(t.prIntent)
    .values({
      prId: pr!.id,
      intent:
        'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      inScope: [
        'Add middleware for rate limiting',
        'Apply to /api/public/* routes',
        'Return 429 with Retry-After header',
      ],
      outOfScope: [
        'Authentication changes',
        'Adding new endpoints',
        'Logging / observability for the limiter',
      ],
      headSha: pr!.headSha,
      confidence: 'low',
      sources: ['title', 'description', 'hunk_headers'],
      missingContext: [],
      provider: 'seed',
      model: 'seed',
    })
    .onConflictDoNothing();

  // ---- built-in agents (the four starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  // This block must stay ahead of the skills block below: the link pass resolves
  // its agent by name, so an agent seeded after it would get no skills until the
  // next run.
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description:
        'Judges the tests in a diff. Its checks are linked skills — edit them in the Skills library.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- built-in skills + their agent links ----
  // Bodies live in ./seed-skills.ts. Idempotent by (workspace, name), like the
  // agents above.
  for (const s of SEED_SKILLS) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (existing) continue;

    const [row] = await db
      .insert(t.skills)
      .values({
        workspaceId,
        name: s.name,
        description: s.description,
        type: s.type,
        source: 'manual',
        body: s.body,
        enabled: true,
        version: 1,
      })
      .returning();
    // A skill at v1 must have its v1 snapshot: SkillsRepository.insert
    // guarantees this for user-created skills, and the Versions tab reads
    // skill_versions — without this a seeded skill shows an empty history.
    await db
      .insert(t.skillVersions)
      .values({ skillId: row!.id, version: 1, summary: null, body: row!.body })
      .onConflictDoNothing();
  }

  // Links are plain rows on purpose. Going through AgentsRepository.setSkills
  // would bump the agent to v2 and write an agent_versions snapshot, while the
  // other seeded agents sit at v1 with no snapshots at all — this seed does not
  // do agent versioning.
  const wantedLinks = new Set<string>();
  for (const [agentName, skillNames] of Object.entries(SEED_AGENT_SKILLS)) {
    const [agent] = await db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, agentName)));
    if (!agent) continue;

    for (const [order, skillName] of skillNames.entries()) {
      const [skill] = await db
        .select({ id: t.skills.id })
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, skillName)));
      if (!skill) continue;
      wantedLinks.add(`${agent.id}:${skill.id}`);
      await db
        .insert(t.agentSkills)
        .values({ agentId: agent.id, skillId: skill.id, order })
        .onConflictDoNothing();
    }
  }

  // Drop built-in links this seed no longer wants, so retargeting
  // SEED_AGENT_SKILLS takes effect on an existing database instead of leaving
  // the previous wiring in place beside the new one.
  //
  // Scoped to built-in agent × built-in skill pairs: a link involving a skill
  // or an agent the user created is never considered, so hand-made wiring
  // survives a re-seed. The one thing this does claim is that the seed owns
  // the links BETWEEN its own agents and its own skills — attaching a built-in
  // skill to a built-in agent by hand will not survive `pnpm db:seed`.
  const builtinAgents = await db
    .select({ id: t.agents.id })
    .from(t.agents)
    .where(
      and(
        eq(t.agents.workspaceId, workspaceId),
        inArray(
          t.agents.name,
          seedAgents.map((a) => a.name),
        ),
      ),
    );
  const builtinSkills = await db
    .select({ id: t.skills.id })
    .from(t.skills)
    .where(
      and(
        eq(t.skills.workspaceId, workspaceId),
        inArray(
          t.skills.name,
          SEED_SKILLS.map((s) => s.name),
        ),
      ),
    );

  if (builtinAgents.length > 0 && builtinSkills.length > 0) {
    const existing = await db
      .select({ agentId: t.agentSkills.agentId, skillId: t.agentSkills.skillId })
      .from(t.agentSkills)
      .where(
        and(
          inArray(
            t.agentSkills.agentId,
            builtinAgents.map((a) => a.id),
          ),
          inArray(
            t.agentSkills.skillId,
            builtinSkills.map((s) => s.id),
          ),
        ),
      );
    for (const link of existing) {
      if (wantedLinks.has(`${link.agentId}:${link.skillId}`)) continue;
      await db
        .delete(t.agentSkills)
        .where(
          and(
            eq(t.agentSkills.agentId, link.agentId),
            eq(t.agentSkills.skillId, link.skillId),
          ),
        );
    }
  }

  return { workspaceId, userId };
}

// CLI entrypoint. pathToFileURL (not a `file://` template) — on Windows argv[1]
// is a backslashed drive path, so the naive form never matches and the script
// would exit 0 without seeding.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
