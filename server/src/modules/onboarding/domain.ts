import type { OnboardingSectionValue } from '@devdigest/shared';

/**
 * Internal types for the onboarding module. Rows and model output are mapped to
 * these at the boundary; nothing outside the module sees them.
 */

/**
 * What lives in `onboarding.json`. The table has no status column, so the
 * envelope carries it — this is deliberate and avoids a migration for a table
 * that already existed as scaffolding.
 */
export interface TourEnvelope {
  status: 'running' | 'ready' | 'failed';
  /** Set only when status is 'failed'. */
  error?: string;
  /** Index state this tour was written against — drives the stale badge. */
  indexSha: string;
  indexedFiles: number;
  sections: OnboardingSectionValue[];
}

export interface StoredTour {
  envelope: TourEnvelope;
  /** The last SUCCESSFUL generation. `running`/`failed` never advance it. */
  generatedAt: Date;
}

export interface TourRepoRef {
  id: string;
  name: string;
  clonePath: string | null;
}

export interface RankedFile {
  path: string;
  percentile: number | null;
}

/**
 * The deterministic half of the tour — see `facts.ts`. Every path and command
 * the user will see originates here, never in the model's output.
 */
export interface FactsSkeleton {
  criticalPaths: RankedFile[];
  readingPath: RankedFile[];
  /** Dependency walks: context for the architecture diagram, never an ordering. */
  chains: string[][];
  commands: string[];
  repoMap: string;
  indexedFiles: number;
  indexSha: string;
}

/** Prose the model returns. Every path in it must already exist in the facts. */
export interface Narrative {
  architecture: { body: string; diagram: string | null };
  criticalPathNotes: { path: string; note: string }[];
  readingPathNotes: { path: string; note: string }[];
  commandComments: { index: number; comment: string }[];
  firstTasks: { title: string; body: string; path: string }[];
}
