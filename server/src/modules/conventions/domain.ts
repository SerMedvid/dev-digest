/**
 * Conventions domain types. Imports nothing — `helpers.ts` and `repository.ts`
 * both import downward from here, which is what keeps `no-circular` quiet on a
 * brand-new module (see the onion-architecture skill).
 */

export const CONVENTION_CATEGORIES = [
  'naming',
  'structure',
  'error-handling',
  'api-shape',
  'testing',
  'imports',
  'typing',
  'tooling',
] as const;
export type ConventionCategoryValue = (typeof CONVENTION_CATEGORIES)[number];

export type ConventionStatusValue = 'pending' | 'accepted' | 'rejected';
export type ScanStatusValue = 'queued' | 'running' | 'done' | 'failed';

/** Why a model-produced candidate never reached the user. */
export const DROP_REASONS = [
  'unknown_path',
  'missing_file',
  'line_out_of_range',
  'snippet_not_found',
  'low_confidence',
  'duplicate',
  'over_quota',
] as const;
export type DropReason = (typeof DROP_REASONS)[number];
export type DropCounts = Partial<Record<DropReason, number>>;

/** A candidate exactly as the model produced it — unverified. */
export interface RawCandidate {
  category: ConventionCategoryValue;
  rule: string;
  evidencePath: string;
  evidenceLine: number;
  evidenceSnippet: string;
  confidence: number;
}

/** A stored candidate: verified evidence plus the user's decision. */
export interface ConventionRecord extends RawCandidate {
  id: string;
  status: ConventionStatusValue;
}

export interface ScanRecord {
  status: ScanStatusValue;
  poolCount: number;
  sampleCount: number;
  candidateCount: number;
  dropped: DropCounts;
  provider: string | null;
  model: string | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** One file we read from the clone and showed the model. */
export interface SampleFile {
  path: string;
  content: string;
  kind: 'config' | 'code';
}

/** Repo fields the extractor needs. Deliberately not a Drizzle row type. */
export interface ScanRepoRef {
  id: string;
  name: string;
  clonePath: string | null;
}
