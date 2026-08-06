/**
 * The service's whole view of the outside world, declared STRUCTURALLY rather
 * than imported from `modules/reviews/repository.ts` — importing another
 * module's repository is a `no-cross-module-internals` violation, and
 * `db/rows.ts` is closed to the core ring too (mirrors `modules/intent/domain.ts`).
 * `ReviewRepository`'s row shapes satisfy these interfaces, so the container
 * wires them with no cast.
 */

export interface PullHead {
  id: string;
  headSha: string;
}

export interface PrFileRow {
  path: string;
  additions: number;
  deletions: number;
  /**
   * The stored unified-diff hunk text, when GitHub returned one — nullable in
   * `pr_files` today (Task 6: read for the one-file summary call; every other
   * consumer of this row ignores it). `undefined` is also accepted so the
   * pre-Task-6 hermetic test literal in `smart-diff-routes.it.test.ts`, which
   * predates this field, still satisfies the interface unchanged.
   */
  patch?: string | null;
}

export interface FindingLite {
  id: string;
  file: string;
  startLine: number;
  severity: string;
  dismissedAt: Date | null;
}

/** The service's view of the cross-aggregate reads it needs from `reviewRepo`. */
export interface SmartDiffStorePort {
  getPull(workspaceId: string, prId: string): Promise<PullHead | undefined>;
  getPrFiles(prId: string): Promise<PrFileRow[]>;
  findingsForPull(prId: string): Promise<FindingLite[]>;
}

export interface PrFileSummaryRow {
  path: string;
  headSha: string;
  summary: string;
  provider: string;
  model: string;
  createdAt: Date;
}

/** `upsertSummary`'s input — everything the row needs except `prId` (the caller's key) and `createdAt` (repository-assigned on every write, replace-wholesale). */
export interface UpsertSummaryInput {
  path: string;
  headSha: string;
  summary: string;
  provider: string;
  model: string;
}

/**
 * The service's view of `smartDiffRepo` — a port, not the concrete class, so
 * a test can stub it without a database (mirrors `IntentStorePort`). Widened
 * in Task 6 (GET-path `summariesForPr` was the whole port; POST needs to
 * write one row and read the workspace's model choice) rather than replaced,
 * per Task 4's review: one port over one table, same as before.
 */
export interface SmartDiffSummaryPort {
  summariesForPr(prId: string): Promise<PrFileSummaryRow[]>;
  /** onConflictDoUpdate on (prId, path) — replaces the row wholesale, `createdAt` included. */
  upsertSummary(prId: string, rec: UpsertSummaryInput): Promise<void>;
  /** The workspace's Settings choice for `file_summary`, or undefined when unset. */
  featureModelChoice(workspaceId: string): Promise<{ provider: string; model: string } | undefined>;
}

/** The service's view of the one structured call — bound provider/model plus the call itself (mirrors `IntentModelPort`). */
export interface FileSummaryModelPort {
  readonly provider: string;
  readonly model: string;
  summarize(path: string, patch: string): Promise<{ summary: string }>;
}
