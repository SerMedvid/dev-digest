import type { IntentConfidence } from '@devdigest/shared';
import type {
  DerivedIntent,
  IntentDoc,
  IntentPullRef,
  IntentRepoRef,
  IntentStoreRecord,
  IntentStoreUpsert,
  IssueMetaShape,
} from './domain.js';

/**
 * The service's whole view of the outside world. It takes this bundle, never
 * `Container`: taking the composition root drags Octokit, Drizzle and every LLM
 * SDK into the type graph of a supposedly pure use-case layer.
 */
export interface IntentRepoPort {
  getPull(workspaceId: string, prId: string): Promise<IntentPullRef | undefined>;
  getRepo(repoId: string): Promise<IntentRepoRef | undefined>;
  /** The workspace's Settings choice for `review_intent`, or undefined when unset. */
  featureModelChoice(workspaceId: string): Promise<{ provider: string; model: string } | undefined>;
}

/** `pr_intent` lives in the reviews aggregate; this is the slice we use. */
export interface IntentStorePort {
  get(prId: string): Promise<IntentStoreRecord | undefined>;
  put(prId: string, rec: IntentStoreUpsert): Promise<void>;
}

export interface DocsPort {
  read(clonePath: string, relPaths: string[]): Promise<{ found: IntentDoc[]; missing: string[] }>;
}

export interface IssuePort {
  /** Best-effort: returns the bodies it got and a note for each it did not. */
  fetch(
    repo: { owner: string; name: string },
    numbers: number[],
  ): Promise<{
    found: IntentDoc[];
    missing: string[];
    /**
     * The FIRST issue that resolved, as metadata, or null when none did.
     * Persisted on `pr_intent.linked_issue` for the brief to read without a
     * network call of its own (L05). Separate from `found` because the brief
     * renders title and body apart, while `found[].content` fuses them.
     */
    linked: IssueMetaShape | null;
  }>;
}

export interface IntentModelPort {
  readonly provider: string;
  readonly model: string;
  classify(input: {
    sources: IntentDoc[];
    hunkDigest: string;
    missingContext: string[];
    sessionId?: string;
  }): Promise<{
    intent: DerivedIntent['intent'];
    tokensIn: number;
    tokensOut: number;
    costUsd: number | null;
  }>;
}

export interface DiffPort {
  /** Hunk-header digest for a PR's diff, or undefined when no diff is available. */
  hunkDigest(workspaceId: string, prId: string): Promise<string | undefined>;
}

/** The narrow half of the platform logger — never the platform object itself. */
export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

export interface IntentServiceDeps {
  repo: IntentRepoPort;
  store: IntentStorePort;
  docs: DocsPort;
  issues: IssuePort;
  diff: DiffPort;
  /** Model resolution is per-workspace, so the composition root supplies it lazily. */
  model: (workspaceId: string) => Promise<IntentModelPort>;
  tokenCount: (text: string) => number;
  logger?: Logger;
}

export type { IntentConfidence };
