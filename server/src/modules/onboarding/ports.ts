import type { FeatureModelChoice, OnboardingSectionValue } from '@devdigest/shared';
import type { FactsSkeleton, Narrative, StoredTour, TourEnvelope, TourRepoRef } from './domain.js';

/**
 * The service's whole view of the outside world. It takes this bundle, never
 * `Container`: taking the composition root drags Octokit, Drizzle and every LLM
 * SDK into the type graph of a supposedly pure use-case layer (onion law 2).
 */

export interface OnboardingRepoPort {
  getRepo(workspaceId: string, repoId: string): Promise<TourRepoRef | undefined>;
  getEnvelope(repoId: string): Promise<StoredTour | undefined>;
  /** Flip to running, preserving `previous` so the screen keeps rendering. */
  markRunning(repoId: string, previous: OnboardingSectionValue[]): Promise<void>;
  /** The only write that bumps `generated_at`. */
  saveReady(repoId: string, envelope: TourEnvelope): Promise<void>;
  saveFailed(repoId: string, error: string, previous: OnboardingSectionValue[]): Promise<void>;
  featureModelChoice(workspaceId: string): Promise<FeatureModelChoice | undefined>;
}

/**
 * The slice of the repo-intel facade this feature reads. Narrowed on purpose:
 * the facade's own return types carry degradation fields this module does not
 * branch on — an unindexed repo simply yields empty collections.
 */
export interface RepoIntelPort {
  getIndexState(repoId: string): Promise<{ lastIndexedSha: string; filesIndexed: number }>;
  getTopFilesByRank(repoId: string, n: number): Promise<string[]>;
  getFileRank(repoId: string, paths: string[]): Promise<{ path: string; percentile: number }[]>;
  getRepoMap(repoId: string, tokenBudget?: number): Promise<{ text: string }>;
  getCriticalPaths(repoId: string): Promise<string[][]>;
}

/** Reads from the checkout. Kept narrow so tests pass a plain object. */
export interface ClonePort {
  /** Returns undefined when the file is absent or unreadable. */
  readFile(clonePath: string, relPath: string): Promise<string | undefined>;
  exists(clonePath: string, relPath: string): Promise<boolean>;
}

export interface OnboardingModelPort {
  readonly provider: string;
  readonly model: string;
  /** Exactly one structured call. */
  write(facts: FactsSkeleton, language: string): Promise<Narrative>;
}

/** The narrow half of the platform logger — never the platform object itself. */
export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

export interface OnboardingServiceDeps {
  repo: OnboardingRepoPort;
  repoIntel: RepoIntelPort;
  clone: ClonePort;
  /** Model resolution is per-workspace, so the composition root supplies it lazily. */
  model: (workspaceId: string) => Promise<OnboardingModelPort>;
  logger?: Logger;
}
