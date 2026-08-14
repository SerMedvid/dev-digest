import type { ChatMessage } from '@devdigest/shared';

/**
 * The brief service's whole view of the outside world.
 *
 * Every row shape below is declared **structurally** rather than imported from
 * `modules/reviews/`, `modules/blast/` or `modules/repo-intel/` — the same
 * reasoning as `blast/ports.ts`'s header. Importing another module's internals
 * is a `no-cross-module-internals` violation, and keeping the mirrors structural
 * means the container's closures stay assignable with no cast while this module
 * stays decoupled from those modules' own evolution.
 */

/** The pull fields the brief reads; `reviewRepo.getPull`'s row satisfies it. */
export interface BriefPullRef {
  id: string;
  number: number;
  title: string;
  body: string | null;
  headSha: string;
  repoId: string;
  author: string;
  headRef: string;
  baseRef: string;
}

/**
 * One changed file. There is deliberately **no `patch` field**: the rule is
 * "no diff hunk body reaches any prompt, at any cap", and the cheapest way to
 * hold it is to make a patch unrepresentable in the type the renderer sees.
 *
 * No per-file status either — `pr_files` does not store one, and added /
 * modified / removed cannot be inferred from the counts without guessing.
 */
export interface BriefFileRow {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * One finding, projected to what the brief renders. `rationale` and
 * `suggestion` are deliberately absent — they are the reviewer's prose, and
 * feeding a model's output back into another model's input is how a wrong
 * conclusion gets laundered into a confident one.
 */
export interface BriefFindingRow {
  file: string;
  startLine: number;
  endLine: number;
  severity: string;
  category: string;
  kind: string;
  title: string;
}

export interface BriefReviewRef {
  reviewId: string;
  findings: BriefFindingRow[];
}

/** The stored intent, plus the issue it linked. No network call on this path. */
export interface BriefIntentRef {
  intent: string;
  in_scope: string[];
  out_of_scope: string[];
  confidence: string;
  linkedIssue: { number: number; title: string; body?: string | null } | null;
}

/** Cross-aggregate reads, over `reviewRepo`. */
export interface BriefStorePort {
  getPull(workspaceId: string, prId: string): Promise<BriefPullRef | undefined>;
  getRepo(repoId: string): Promise<{ owner: string; name: string; clonePath: string | null } | undefined>;
  getPrFiles(prId: string): Promise<BriefFileRow[]>;
  getIntent(prId: string): Promise<BriefIntentRef | undefined>;
  /** The PR's most recent review and its findings; undefined when it has none. */
  latestReview(prId: string): Promise<BriefReviewRef | undefined>;
}

/** One row of `pr_brief`, as the service reads it. */
export interface BriefRow {
  headSha: string;
  /** The stored `Brief`. `unknown` here: parsing it is the service's job. */
  brief: unknown;
  reviewId: string | null;
  sources: string[];
  estTokensIn: number;
  provider: string;
  model: string;
  createdAt: Date;
}

/** The service's view of `briefRepo` — one port over one table. */
export interface BriefRepoPort {
  get(prId: string): Promise<BriefRow | undefined>;
  /** Replaces the PR's row wholesale — it describes THIS generation. */
  put(row: {
    prId: string;
    headSha: string;
    brief: unknown;
    reviewId: string | null;
    sources: string[];
    estTokensIn: number;
    provider: string;
    model: string;
  }): Promise<void>;
}

export interface BriefDocsPort {
  /**
   * The specification documents the PR body itself references, read from the
   * clone. Reuses the intent module's `docReferences` extractor and its
   * `CloneDocReader`, path confinement and symlink checks intact — both are
   * reached from the container, because `modules/brief/` importing
   * `modules/intent/` is a `no-cross-module-internals` violation.
   *
   * Takes the raw body rather than extracted paths for the same reason: the
   * extractor lives on the other side of that boundary. Refusals arrive as
   * `missing` notes; nothing here throws, and a repo with no clone on disk is a
   * normal degradation rather than an error.
   */
  read(
    repo: { owner: string; name: string; clonePath: string | null },
    body: string | null,
  ): Promise<{ found: { label: string; content: string }[]; missing: string[] }>;
}

/**
 * The blast map, as `BlastService.get` returns it — a structural mirror of
 * `BlastRadiusResponse`. `endpoints`/`crons` are the BFS-widened union; the
 * per-symbol arrays are a subset of it, and `buildAllowed` reads both so the
 * allowed set does not depend on which one the model happened to quote.
 */
export interface BriefBlastMap {
  status: string;
  reason: string | null;
  head_sha: string;
  changed_symbols: {
    name: string;
    kind: string;
    file: string;
    line: number | null;
    callers: { file: string; line: number; symbol: string; rank: number }[];
    endpoints: string[];
    crons: string[];
  }[];
  endpoints: string[];
  crons: string[];
  summary: string | null;
}

export interface BriefBlastPort {
  map(workspaceId: string, prId: string): Promise<BriefBlastMap>;
}

/**
 * One rendered input, ready for `wrapUntrusted` under its own source label.
 *
 * Declared here rather than in `helpers.ts` so that `prompt.ts` (which consumes
 * it) and `helpers.ts` (which produces it) both depend on this file and not on
 * each other — `ports.ts` imports nothing from the module, which is what keeps
 * the `no-circular` gate satisfied.
 */
export interface BriefSection {
  /** The `wrapUntrusted` source label, e.g. `files`, `issue#12`, `spec:docs/x.md`. */
  label: string;
  /** The trusted heading the section sits under in the user message. */
  heading: string;
  text: string;
}

/**
 * What the one structured call returns.
 *
 * A structural mirror of `prompt.ts`'s `BriefOutput`, declared here for the
 * same reason `BlastSummaryModelPort.explain` inlines its own return shape:
 * importing the zod module from `ports.ts` would close a cycle. `prompt.ts`
 * asserts the two agree, so they cannot drift silently.
 *
 * `line` is optional here and on the zod schema — a model that omits the key
 * entirely is a normal outcome, and `groundBrief` normalises it to `null`.
 */
export interface BriefOutputShape {
  what: string;
  why: string;
  risk_level: 'high' | 'medium' | 'low';
  risks: {
    title: string;
    explanation: string;
    severity: 'high' | 'medium' | 'low';
    refs: string[];
  }[];
  review_focus: { file: string; line?: number | null; reason: string }[];
}

/**
 * The one structured call — bound provider/model plus the call itself.
 *
 * It takes assembled messages rather than raw input text because the service
 * must report `est_tokens_in` over exactly the characters that are sent; see
 * `buildBriefPrompt`.
 */
export interface BriefModelPort {
  readonly provider: string;
  readonly model: string;
  generate(messages: ChatMessage[]): Promise<BriefOutputShape>;
}

/** The narrow half of the platform logger — never the platform object itself. */
export interface BriefLogger {
  warn(obj: unknown, msg?: string): void;
  info?(obj: unknown, msg?: string): void;
}

export interface BriefServiceDeps {
  store: BriefStorePort;
  briefs: BriefRepoPort;
  blast: BriefBlastPort;
  docs: BriefDocsPort;
  /** Model resolution is per-workspace, so the composition root supplies it lazily. */
  model: (workspaceId: string) => Promise<BriefModelPort>;
  /** tiktoken, for the log line only — never the gate. */
  tokenCount?: (text: string) => number;
  log?: BriefLogger;
}
