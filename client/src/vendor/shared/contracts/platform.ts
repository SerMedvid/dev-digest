import { z } from 'zod';
import { Provider } from './knowledge.js';
import { Severity } from './findings.js';

/**
 * Platform / scaffolding DTOs owned by F1:
 *  - settings (GET/PUT /settings, POST /settings/test-connection)
 *  - repos (POST/GET /repos, refresh, delete)
 *  - pulls (GET /repos/:id/pulls, GET /pulls/:id)
 *  - context (Project Context folder)
 */

// ---- Feature → model selection ----
/** System LLM features whose model is selectable in Settings (per-workspace). */
export const FeatureModelId = z.enum([
  'onboarding',
  'review_intent',
  'risk_brief',
  'conformance',
  'conventions',
  'file_summary',
  'blast_summary',
]);
export type FeatureModelId = z.infer<typeof FeatureModelId>;

/** A chosen provider + model for one feature. */
export const FeatureModelChoice = z.object({
  provider: Provider,
  model: z.string().min(1),
});
export type FeatureModelChoice = z.infer<typeof FeatureModelChoice>;

/**
 * Registry of the selectable features: stable id, display label, and the
 * built-in default used when the workspace hasn't overridden the choice. The
 * defaults MIRROR each module's constants, so behaviour is unchanged until a
 * model is explicitly picked.
 */
export interface FeatureModelDef {
  id: FeatureModelId;
  label: string;
  description: string;
  defaultProvider: Provider;
  defaultModel: string;
}
export const FEATURE_MODELS: FeatureModelDef[] = [
  {
    id: 'onboarding',
    label: 'Onboarding Tour',
    description: 'Writes the per-repo onboarding tour.',
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
  {
    id: 'review_intent',
    label: 'PR Review · Intent',
    description: 'Derives a PR’s intent and scope before review.',
    // Flash-class: one bounded call per PR over titles, docs and hunk headers.
    // Must advertise `structured_outputs` in OpenRouter's /api/v1/models —
    // `strict: true` is a strong hint there, not a guarantee.
    defaultProvider: 'openrouter',
    defaultModel: 'google/gemini-2.5-flash-lite',
  },
  {
    id: 'risk_brief',
    label: 'Risk Brief',
    description: 'Assesses merge risks for a pull request.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'conformance',
    label: 'Conformance',
    description: 'Checks a PR against the project spec.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'conventions',
    label: 'Conventions',
    description: 'Extracts coding conventions from the repo.',
    // Two cheap calls over a bounded sample — the same model onboarding uses.
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
  {
    id: 'file_summary',
    label: 'PR Review · File summary',
    description: 'Summarises one changed file on demand.',
    // Flash-class: one bounded call per file, triggered on demand from the
    // Files-changed view — same reasoning as review_intent.
    defaultProvider: 'openrouter',
    defaultModel: 'google/gemini-2.5-flash-lite',
  },
  {
    id: 'blast_summary',
    label: 'PR Review · Blast summary',
    description: 'Explains the blast-radius map in one paragraph, on demand.',
    // Flash-class: one bounded call per PR head over the computed map, and only
    // when the user clicks Explain — same reasoning as review_intent.
    defaultProvider: 'openrouter',
    defaultModel: 'google/gemini-2.5-flash-lite',
  },
];

// ---- Project context: root segments ----
/**
 * One configured project-context root — a single repo-relative directory name
 * (`specs`, `docs`, `insights`, …). It carries no path separator and is never
 * `.` or `..`, so a traversal attempt is rejected at the settings write
 * boundary instead of being left for the walker to defend against.
 *
 * Declared above `Settings` because `SettingsKnown.context_roots` consumes it;
 * the rest of the project-context contracts live further down the file.
 */
export const ContextRootSegment = z
  .string()
  .min(1)
  .refine((s) => !s.includes('/') && !s.includes('\\'), {
    message: 'a context root must be a single path segment (no "/" or "\\")',
  })
  .refine((s) => s !== '.' && s !== '..', {
    message: 'a context root may not be "." or ".."',
  });
export type ContextRootSegment = z.infer<typeof ContextRootSegment>;

// ---- Settings ----
/**
 * Non-secret prefs/config. Secrets (API keys) are NOT stored here — they go
 * through SecretsProvider (.env in MVP). Settings is a flat key/value bag,
 * surfaced as a typed object for the well-known keys.
 */
export const SettingsKnown = z.object({
  polling_interval_min: z.number().int().min(1).default(5),
  theme: z.enum(['dark', 'light']).default('dark'),
  density: z.enum(['regular', 'compact']).default('regular'),
  sync_to_folder: z.boolean().default(true),
  automatic_reviews: z.boolean().default(false),
  /** Per-feature model overrides (provider+model), keyed by FeatureModelId. */
  feature_models: z.record(FeatureModelId, FeatureModelChoice).default({}),
  /**
   * Repo-relative directories scanned for project-context documents. Typed (not
   * left to `Settings.passthrough()`) so a separator or `..` is a 422 on write.
   */
  context_roots: z.array(ContextRootSegment).default(['specs', 'docs', 'insights']),
});
export type SettingsKnown = z.infer<typeof SettingsKnown>;

/** Full settings payload: well-known keys + arbitrary extras. */
export const Settings = SettingsKnown.passthrough();
export type Settings = z.infer<typeof Settings>;

export const SettingsUpdate = Settings.partial();
export type SettingsUpdate = z.infer<typeof SettingsUpdate>;

// ---- Connection test ----
export const ConnTestProvider = z.enum(['openai', 'anthropic', 'openrouter', 'github']);
export type ConnTestProvider = z.infer<typeof ConnTestProvider>;

export const ConnTestRequest = z.object({
  provider: ConnTestProvider,
  /** Optional API key/PAT to persist and then test (BYO key from the UI). */
  key: z.string().min(1).optional(),
});
export type ConnTestRequest = z.infer<typeof ConnTestRequest>;

export const ConnTestResult = z.object({
  provider: ConnTestProvider,
  ok: z.boolean(),
  message: z.string(),
  detail: z.unknown().optional(),
});
export type ConnTestResult = z.infer<typeof ConnTestResult>;

// ---- Secrets status (which provider keys are configured; never the values) ----
/** Boolean per provider: true ⇒ a key/PAT is stored. The value is never exposed. */
export const SecretsStatus = z.object({
  openai: z.boolean(),
  anthropic: z.boolean(),
  openrouter: z.boolean(),
  github: z.boolean(),
});
export type SecretsStatus = z.infer<typeof SecretsStatus>;

// ---- Repos ----
export const RepoInput = z.object({
  url: z.string().url(),
});
export type RepoInput = z.infer<typeof RepoInput>;

export const Repo = z.object({
  id: z.string(),
  workspace_id: z.string(),
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
  default_branch: z.string(),
  clone_path: z.string().nullable(),
  last_polled_at: z.string().nullable(),
  created_by: z.string().nullable(),
});
export type Repo = z.infer<typeof Repo>;

// ---- Pull requests ----
export const PrStatus = z.enum(['needs_review', 'reviewed', 'stale', 'open', 'closed', 'merged']);
export type PrStatus = z.infer<typeof PrStatus>;

/**
 * Per-severity roll-up of a PR's NON-DISMISSED findings, across every review of
 * that PR. Populated by the pulls LIST endpoint only.
 */
export const PrFindingsBySeverity = z.object({
  CRITICAL: z.number().int(),
  WARNING: z.number().int(),
  SUGGESTION: z.number().int(),
});
export type PrFindingsBySeverity = z.infer<typeof PrFindingsBySeverity>;

/**
 * A slim finding for the list's breakdown card — a capped SAMPLE, not the full
 * set (`PrFindingsBySeverity` stays authoritative for totals). `rationale_snippet`
 * is truncated server-side so full rationales never leave the DB on this route.
 */
export const PrFindingPreview = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  confidence: z.number(),
  rationale_snippet: z.string(),
});
export type PrFindingPreview = z.infer<typeof PrFindingPreview>;

export const PrMeta = z.object({
  id: z.string().nullish(),
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  branch: z.string(),
  base: z.string(),
  head_sha: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  files_count: z.number().int(),
  status: PrStatus,
  opened_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  // Latest-review score (list endpoint only; null/absent until reviewed).
  score: z.number().int().nullish(),
  // Total USD spent on this PR = SUM of its runs' costs (list endpoint only).
  // Null when the PR has no runs, or none of them could be priced.
  cost_usd: z.number().nullish(),
  // Per-severity counts of non-dismissed findings (list endpoint only).
  // Null when the PR has none, or when the roll-up failed — never zeros.
  findings_by_severity: PrFindingsBySeverity.nullish(),
  // A capped sample of those findings, most severe first (list endpoint only).
  // Null alongside `findings_by_severity` — never an empty array.
  findings_preview: z.array(PrFindingPreview).nullish(),
});
export type PrMeta = z.infer<typeof PrMeta>;

export const PrFile = z.object({
  path: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  patch: z.string().nullish(),
});
export type PrFile = z.infer<typeof PrFile>;

export const PrCommit = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string(),
  committed_at: z.string().nullish(),
});
export type PrCommit = z.infer<typeof PrCommit>;

export const IssueMeta = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullish(),
  state: z.string(),
});
export type IssueMeta = z.infer<typeof IssueMeta>;

export const PrDetail = PrMeta.extend({
  body: z.string().nullish(),
  files: z.array(PrFile),
  commits: z.array(PrCommit),
  linked_issue: IssueMeta.nullish(),
});
export type PrDetail = z.infer<typeof PrDetail>;

// ---- PR review (inline) comments ----
/**
 * A GitHub PR review comment anchored to a diff line. Mirrors the fields the
 * "Files changed" tab needs to render threads inline; `line` is the position in
 * the current diff (null when GitHub can no longer anchor it → `is_outdated`).
 */
export const PrReviewComment = z.object({
  id: z.number().int(),
  path: z.string(),
  line: z.number().int().nullable(),
  original_line: z.number().int().nullable(),
  side: z.enum(['LEFT', 'RIGHT']),
  body: z.string(),
  user: z.string(),
  created_at: z.string(),
  html_url: z.string(),
  in_reply_to_id: z.number().int().nullable(),
  /** GitHub couldn't anchor it to the current diff (line == null). */
  is_outdated: z.boolean(),
});
export type PrReviewComment = z.infer<typeof PrReviewComment>;

/** Body for POST /pulls/:id/comments (create one inline comment / reply). */
export const PrCommentInput = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  side: z.enum(['LEFT', 'RIGHT']).optional(),
  body: z.string().min(1),
  /** Reply to an existing review comment thread (its comment id). */
  in_reply_to: z.number().int().optional(),
});
export type PrCommentInput = z.infer<typeof PrCommentInput>;

// ---- Project Context ----
export const SpecFile = z.object({
  path: z.string(),
  content: z.string().nullish(),
  size: z.number().int().nullish(),
  updated_at: z.string().nullish(),
});
export type SpecFile = z.infer<typeof SpecFile>;

export const IndexStatus = z.object({
  status: z.enum(['idle', 'cloning', 'parsing', 'embedding', 'done', 'error']),
  pct: z.number().min(0).max(100),
  message: z.string().nullish(),
  chunks_indexed: z.number().int().nullish(),
});
export type IndexStatus = z.infer<typeof IndexStatus>;

// ---- Project context ----
/**
 * Project-context documents: the markdown-ish files discovered under the
 * configured `context_roots` of a repository clone, and the per-agent/per-skill
 * attachments that decide which of them a review run reads.
 *
 * `ContextRootSegment` is declared further up, next to `SettingsKnown`.
 */

/** One discovered document. `path` is repo-relative POSIX; `root` is the matched root segment. */
export const ContextDoc = z.object({
  path: z.string().min(1),
  root: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  token_estimate: z.number().int().nonnegative(),
  /** How many agents currently read this document (direct + inherited). */
  used_by_agents: z.number().int().nonnegative(),
});
export type ContextDoc = z.infer<typeof ContextDoc>;

/**
 * The discovery result for one repository. `no_clone` means the repo row has no
 * `clone_path` or the directory is gone — an empty list and HTTP 200, never a 5xx.
 * `omitted` counts documents dropped by the per-list cap.
 */
export const ContextDocList = z.object({
  status: z.enum(['ok', 'no_clone']),
  roots: z.array(z.string()),
  docs: z.array(ContextDoc),
  omitted: z.number().int().nonnegative(),
  scanned_at: z.string(),
});
export type ContextDocList = z.infer<typeof ContextDocList>;

/** One document's text, capped; `truncated` ⇒ the byte cap was hit. */
export const ContextDocContent = z.object({
  path: z.string().min(1),
  content: z.string(),
  size_bytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type ContextDocContent = z.infer<typeof ContextDocContent>;

/**
 * One row of an agent's effective attachment set. `direct` rows are attached to
 * the agent itself, `inherited` ones come from a skill (`skill_id`/`skill_name`
 * name it; both null for a direct row). `missing` ⇒ attached but not on disk.
 *
 * `beyond_read_cap` ⇒ the row is stored and effective, but sorts past the
 * per-run document cap, so **the run will not read it** and its tokens are not
 * in the view's `token_estimate` — the editors mark it rather than letting it
 * look like every other attached row. The server always sets the field; it is
 * optional on the wire so a reader that predates it treats an absent value as
 * `false`, which is what it meant before the flag existed.
 */
export const ContextAttachmentRow = z.object({
  path: z.string().min(1),
  root: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  token_estimate: z.number().int().nonnegative(),
  repo_id: z.string(),
  source: z.enum(['direct', 'inherited']),
  skill_id: z.string().nullable(),
  skill_name: z.string().nullable(),
  missing: z.boolean(),
  beyond_read_cap: z.boolean().optional(),
});
export type ContextAttachmentRow = z.infer<typeof ContextAttachmentRow>;

/**
 * The attachment view behind the agent editor's Context tab: how many documents
 * are attached directly, how many the agent effectively reads after dedupe, and
 * how many were discovered in the clone.
 *
 * `token_estimate` counts only the rows the run will actually read — the ones
 * without `beyond_read_cap` — because a footer that states tokens no run bills
 * is a footer that disagrees with the trace.
 *
 * `version` is this owner-and-repository's **concurrency token**: opaque,
 * compared for equality only, never parsed or ordered. Echo it back as
 * `ContextAttachmentsUpdate.expected_version` and the replace is rejected with
 * 409 if the stored state moved in between — which is the difference between a
 * lost update and a conflict the user is told about. Every response carries it;
 * it is optional on the wire only so a reader written before it existed still
 * validates.
 */
export const ContextAttachmentsView = z.object({
  direct_count: z.number().int().nonnegative(),
  effective_count: z.number().int().nonnegative(),
  discovered_count: z.number().int().nonnegative(),
  token_estimate: z.number().int().nonnegative(),
  version: z.string().min(1).optional(),
  rows: z.array(ContextAttachmentRow),
});
export type ContextAttachmentsView = z.infer<typeof ContextAttachmentsView>;

/**
 * Body for replacing the attachment set of one agent/skill for one repository.
 *
 * Both bounds are the server's caps restated as literals, the way every other
 * contract here does it (this file is a copy of the server's, so it cannot
 * import `modules/project-context/constants.ts`): 1024 is `MAX_PATH_CHARS`, 500
 * is `MAX_LIST_DOCS`. A client cannot attach more documents than discovery will
 * ever show it, and without the array bound the replace is a multi-row insert at
 * 7 bind parameters per row — past ~9,360 paths that exceeds Postgres'
 * 65,535-parameter ceiling, so an oversized body 500s instead of 422ing.
 *
 * `expected_version` is the optimistic-concurrency token: the
 * `ContextAttachmentsView.version` the client believed it was replacing. The
 * write compares it under the same row lock it already takes and answers 409
 * when it no longer matches, instead of applying a body computed from a
 * snapshot the state has moved past. It is **optional**: a caller that omits it
 * gets the previous last-writer-wins behaviour, which is what keeps this a
 * compatible addition. Bounded because it is client-supplied and only ever
 * compared for equality.
 */
export const ContextAttachmentsUpdate = z.object({
  repo_id: z.string().uuid(),
  paths: z.array(z.string().min(1).max(1024)).max(500),
  expected_version: z.string().min(1).max(64).optional(),
});
export type ContextAttachmentsUpdate = z.infer<typeof ContextAttachmentsUpdate>;

/**
 * The serialisation preview: `block` is exactly what `assemblePrompt` emits for
 * the `specs` slot, and `unread` lists the documents that were skipped, each
 * with its reason.
 */
export const ContextPreview = z.object({
  block: z.string(),
  unread: z.array(z.string()),
});
export type ContextPreview = z.infer<typeof ContextPreview>;

// ---- Run request (review trigger; owned by A2, contract lives here) ----
export const RunRequest = z.object({
  agentId: z.string().optional(),
  all: z.boolean().optional(),
});
export type RunRequest = z.infer<typeof RunRequest>;

// ---- Structured API error envelope (returned by the API; UX taxonomy is FE) ----
export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
