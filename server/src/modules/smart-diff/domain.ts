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
}

/**
 * The service's view of `smartDiffRepo` — a port, not the concrete class, so
 * a test can stub it without a database (mirrors `IntentStorePort`).
 */
export interface SmartDiffSummaryPort {
  summariesForPr(prId: string): Promise<PrFileSummaryRow[]>;
}
