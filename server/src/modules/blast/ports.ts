/**
 * The blast service's whole view of the outside world.
 *
 * The repo-intel shapes below are declared STRUCTURALLY rather than imported
 * from `modules/repo-intel/types.ts` — the smart-diff `domain.ts` precedent.
 * Importing another module's internals is a `no-cross-module-internals`
 * violation, and keeping the mirror structural means the container's closures
 * stay assignable with no cast while this module stays decoupled from
 * repo-intel's own evolution.
 */

/** Mirror of repo-intel's `BlastCallerRow`. */
export interface BlastCallerShape {
  file: string;
  /** The ENCLOSING symbol at the call site. */
  symbol: string;
  /** Which changed symbol this caller reaches — the grouping key. */
  viaSymbol: string;
  line: number;
  rank: number;
}

/** Mirror of repo-intel's `BlastChangedSymbol`. */
export interface BlastChangedSymbolShape {
  file: string;
  name: string;
  kind: string;
  line?: number | null;
}

/** Mirror of repo-intel's `BlastResult`. */
export interface BlastResultShape {
  changedSymbols: BlastChangedSymbolShape[];
  callers: BlastCallerShape[];
  impactedEndpoints: string[];
  impactedCrons: string[];
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  degraded?: boolean;
  /** repo-intel's `DegradedReason`, widened — this module only passes it on. */
  reason?: string;
}

/** Mirror of repo-intel's `IndexState`, narrowed to what status derivation reads. */
export interface IndexStateShape {
  /** repo-intel's `IndexStatus`: 'full' | 'partial' | 'degraded' | 'failed'. */
  status: string;
  lastIndexedSha: string;
}

/** The pull fields blast needs; `reviewRepo.getPull`'s row satisfies it. */
export interface BlastPullHead {
  id: string;
  repoId: string;
  headSha: string;
}

/**
 * One earlier PR that shares at least one changed path with the PR in view.
 * Structural, like the repo-intel mirrors above: the repository's row satisfies
 * it with no import, so no `$inferSelect` alias crosses into the core.
 *
 * `overlapFiles` is EVERY shared path; the service applies the cap, because how
 * many to show is a presentation decision and not the query's business.
 */
export interface PriorPrShape {
  number: number;
  title: string;
  author: string;
  status: string;
  updatedAt: Date | null;
  /** Untruncated count of shared paths — stays true after `overlapFiles` is cut. */
  overlapCount: number;
  overlapFiles: string[];
}

/** Cross-aggregate reads, over `reviewRepo`. */
export interface BlastStorePort {
  getPull(workspaceId: string, prId: string): Promise<BlastPullHead | undefined>;
  getPrFilePaths(prId: string): Promise<string[]>;
  /** Merged/closed PRs in the same repo whose files intersect `paths`. */
  priorPrs(args: {
    workspaceId: string;
    repoId: string;
    excludePrId: string;
    paths: string[];
    statuses: readonly string[];
    limit: number;
  }): Promise<PriorPrShape[]>;
  /** Same-repo PRs with no stored file rows — the uncomparable ones. */
  countPrsWithoutFiles(args: {
    workspaceId: string;
    repoId: string;
    excludePrId: string;
  }): Promise<number>;
}

/** The two repo-intel facade reads the map is built from. */
export interface BlastIntelPort {
  blastRadius(repoId: string, files: string[]): Promise<BlastResultShape>;
  indexState(repoId: string): Promise<IndexStateShape>;
}

/** One row of `blast_summary`, as the service reads it. */
export interface BlastSummaryRow {
  headSha: string;
  summary: string;
}

/** The service's view of `blastRepo` — one port over one table. */
export interface BlastSummaryPort {
  get(prId: string): Promise<BlastSummaryRow | undefined>;
  /** Replaces the PR's row wholesale — there is only ever one, at one head. */
  put(row: {
    prId: string;
    headSha: string;
    summary: string;
    provider: string;
    model: string;
  }): Promise<void>;
}

/** The one structured call — bound provider/model plus the call itself. */
export interface BlastSummaryModelPort {
  readonly provider: string;
  readonly model: string;
  explain(mapJson: string): Promise<{ summary: string }>;
}

/** The narrow half of the platform logger — never the platform object itself. */
export interface BlastLogger {
  warn(obj: unknown, msg?: string): void;
  info?(obj: unknown, msg?: string): void;
}

export interface BlastServiceDeps {
  store: BlastStorePort;
  intel: BlastIntelPort;
  summaries: BlastSummaryPort;
  /** Resolves the workspace's `blast_summary` choice (or the registry default). */
  model: (workspaceId: string) => Promise<BlastSummaryModelPort>;
  log?: BlastLogger;
}
