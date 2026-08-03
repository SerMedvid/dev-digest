import type { SkillType } from '@devdigest/shared';
import type {
  ConventionRecord,
  ConventionStatusValue,
  DropCounts,
  RawCandidate,
  SampleFile,
  ScanRecord,
  ScanRepoRef,
} from './domain.js';

/**
 * The service's whole view of the outside world. It takes this bundle, never
 * `Container`: taking the composition root drags Octokit, Drizzle and every LLM
 * SDK into the type graph of a supposedly pure use-case layer.
 */

export interface ScanStats {
  poolCount: number;
  sampleCount: number;
  candidateCount: number;
  dropped: DropCounts;
  provider: string;
  model: string;
}

export interface CandidatePatch {
  status?: ConventionStatusValue;
  rule?: string;
  evidencePath?: string;
  evidenceLine?: number;
  evidenceSnippet?: string;
}

export interface ConventionsRepoPort {
  getRepo(workspaceId: string, repoId: string): Promise<ScanRepoRef | undefined>;
  getScan(repoId: string): Promise<ScanRecord | undefined>;
  /** Upsert to `queued`, clearing the previous run's statistics. */
  queueScan(repoId: string): Promise<void>;
  markRunning(repoId: string, provider: string, model: string): Promise<void>;
  finishScan(repoId: string, stats: ScanStats): Promise<void>;
  failScan(repoId: string, error: string): Promise<void>;
  /** Delete every candidate for the repo and insert these, in one transaction. */
  replaceCandidates(
    workspaceId: string,
    repoId: string,
    candidates: RawCandidate[],
  ): Promise<void>;
  listCandidates(repoId: string): Promise<ConventionRecord[]>;
  listAccepted(repoId: string): Promise<ConventionRecord[]>;
  patchCandidate(
    workspaceId: string,
    id: string,
    patch: CandidatePatch,
  ): Promise<ConventionRecord | undefined>;
}

export interface SamplerPort {
  configSamples(clonePath: string): Promise<SampleFile[]>;
  readSamples(clonePath: string, paths: string[]): Promise<SampleFile[]>;
}

export interface RepoIntelPort {
  getTopFilesByRank(repoId: string, n: number): Promise<string[]>;
}

export interface ConventionsModelPort {
  readonly provider: string;
  readonly model: string;
  selectFiles(input: { pool: string[] }): Promise<string[]>;
  extract(input: { files: SampleFile[] }): Promise<RawCandidate[]>;
}

export interface SkillsPort {
  createExtracted(
    workspaceId: string,
    input: {
      name: string;
      description: string;
      type: SkillType;
      body: string;
      enabled?: boolean;
      evidenceFiles: string[];
    },
  ): Promise<{ id: string }>;
  /**
   * Throws when the agent is not in this workspace. Separate from `linkToAgent`
   * and called *before* the skill is created: the link is the last step, so a
   * check inside it would reject the request only after a skill had already
   * been written, leaving one orphaned behind every failed attempt.
   */
  assertAgent(workspaceId: string, agentId: string): Promise<void>;
  /** Appends the skill to the agent's ordered list and bumps its version. */
  linkToAgent(agentId: string, skillId: string): Promise<void>;
}

/** The narrow half of the platform logger — never the platform object itself. */
export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

export interface ConventionsServiceDeps {
  repo: ConventionsRepoPort;
  sampler: SamplerPort;
  repoIntel: RepoIntelPort;
  /** Model resolution is per-workspace, so the composition root supplies it lazily. */
  model: (workspaceId: string) => Promise<ConventionsModelPort>;
  skills: SkillsPort;
  tokenCount: (text: string) => number;
  logger?: Logger;
}
