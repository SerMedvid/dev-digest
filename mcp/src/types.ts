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

/**
 * Blast radius — a structural mirror of the server's `BlastRadiusResponse`
 * (`contracts/blast.ts`). Declared here rather than imported: `mcp/` resolves
 * no `@devdigest/shared` alias, and the tool only ever reads these fields.
 */
export interface BlastCallerRef {
  file: string;
  line: number;
  /** The ENCLOSING symbol at the call site, not the one being called. */
  symbol: string;
  rank: number;
}

export interface BlastSymbolRef {
  name: string;
  kind: string;
  file: string;
  line: number | null;
  callers: BlastCallerRef[];
  endpoints: string[];
  crons: string[];
}

export interface BlastRadiusRef {
  /** `partial`/`degraded` mean the map is incomplete — never launder them. */
  status: 'ok' | 'partial' | 'degraded';
  reason: string | null;
  head_sha: string;
  changed_symbols: BlastSymbolRef[];
  endpoints: string[];
  crons: string[];
  summary: string | null;
}

/**
 * Working-tree review — a structural mirror of `POST /reviews/adhoc`'s body.
 * Only the fields the CLI renders; the server also returns token counts and
 * cost, which the CLI does not print.
 */
export interface AdhocFinding {
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  title: string;
  file: string;
  start_line: number;
  end_line: number;
}

export interface AdhocReviewRef {
  review: {
    verdict: string;
    summary: string;
    score: number;
    findings: AdhocFinding[];
  };
  blockers: number;
  /** Reasons the grounding gate dropped a finding — surfaced, never hidden. */
  dropped: string[];
  scope_dropped: string[];
  agent: { name: string; ci_fail_on: string };
  model: string;
}
