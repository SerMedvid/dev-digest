/**
 * Structural shapes of the DevDigest API responses — only the fields this
 * package reads. Declared here rather than imported from `@devdigest/shared`
 * so this package stays standalone (that module exists in two physically
 * drifted copies; see the root CLAUDE.md).
 */

export type Severity = 'CRITICAL' | 'WARNING' | 'SUGGESTION';
export type FindingCategory = 'bug' | 'security' | 'perf' | 'style' | 'test';
export type RunStatus = 'running' | 'done' | 'failed' | 'cancelled';
export type ConventionStatus = 'pending' | 'accepted' | 'rejected';

export interface RepoRef {
  id: string;
  owner: string;
  name: string;
  full_name: string;
}

/** `id` is nullish for a PR listed from GitHub but not yet imported locally. */
export interface PullRef {
  id: string | null | undefined;
  number: number;
  title: string;
}

export interface AgentRef {
  id: string;
  name: string;
  description: string;
  provider: string;
  model: string;
  enabled: boolean;
}

export interface StartedRun {
  run_id: string;
  agent_id: string;
  agent_name: string;
}

export interface RunRef {
  run_id: string;
  agent_id: string | null;
  agent_name: string | null;
  status: string | null;
  error: string | null;
  score: number | null;
  findings_count: number | null;
}

export interface FindingRef {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  rationale: string;
  suggestion: string | null;
  confidence: number;
  dismissed_at: string | null;
}

export interface ReviewRef {
  id: string;
  agent_id: string | null;
  run_id: string | null;
  agent_name?: string | null;
  verdict: string | null;
  summary: string | null;
  score: number | null;
  findings: FindingRef[];
}

export interface ConventionRef {
  id: string;
  category: string;
  rule: string;
  evidence_path: string;
  evidence_line: number;
  confidence: number;
  status: ConventionStatus;
}

export interface ConventionsRef {
  scan: { status: string } | null;
  candidates: ConventionRef[];
}
