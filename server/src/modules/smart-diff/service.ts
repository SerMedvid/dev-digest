import type { FindingMark, SmartDiff } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { groupFiles, splitSuggestion, type FileStat } from './helpers.js';
import type { SmartDiffStorePort, SmartDiffSummaryPort } from './domain.js';

/** The narrow half of the platform logger — never the platform object itself. */
export interface Logger {
  warn(obj: unknown, msg?: string): void;
}

export interface SmartDiffServiceDeps {
  store: SmartDiffStorePort;
  repo: SmartDiffSummaryPort;
  log?: Logger;
}

/**
 * Smart Diff: group a PR's changed files into `core` / `wiring` /
 * `boilerplate`, mark them with the PR's live findings, and propose a split
 * when the PR is too big to review as one. No model call on this path —
 * grouping and the split suggestion are Task 3's pure path/diff-stat rules;
 * marks come from persisted findings.
 *
 * Degradation is asymmetric on purpose: a missing pull is a 404 (thrown, not
 * degraded — `getPull`/`getPrFiles` are never wrapped), but a failure
 * *reading findings* degrades to an unmarked diff — grouping does not depend
 * on findings existing, so there is no reason to fail the whole response over
 * them (mirrors `pulls/routes.ts`'s cost/findings roll-up degradation).
 */
export class SmartDiffService {
  constructor(private deps: SmartDiffServiceDeps) {}

  async get(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.deps.store.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.deps.store.getPrFiles(prId);
    const filePaths = new Set(files.map((f) => f.path));

    let findings: Awaited<ReturnType<SmartDiffStorePort['findingsForPull']>> = [];
    try {
      findings = await this.deps.store.findingsForPull(prId);
    } catch (err) {
      this.deps.log?.warn(
        { err, prId },
        'smart-diff: findings fetch failed; serving marks-empty grouping',
      );
      findings = [];
    }

    // Every non-dismissed finding on the PR, across all agents and all runs —
    // this deliberately matches what the Findings tab shows, so one PR
    // reports one number in both places.
    const marksByPath = new Map<string, FindingMark[]>();
    for (const f of findings) {
      if (f.dismissedAt != null) continue;
      // A finding citing a file the diff does not contain cannot be
      // rendered, and inventing a group entry for it would put a file in the
      // diff that the diff does not contain.
      if (!filePaths.has(f.file)) continue;
      const mark: FindingMark = {
        line: f.startLine,
        severity: f.severity as FindingMark['severity'],
        finding_id: f.id,
      };
      const existing = marksByPath.get(f.file);
      if (existing) existing.push(mark);
      else marksByPath.set(f.file, [mark]);
    }

    // Only a summary keyed to the pull's CURRENT head is safe to serve — one
    // describing different code is worse than no summary.
    const summaries = await this.deps.repo.summariesForPr(prId);
    const summaryByPath = new Map<string, string>();
    for (const s of summaries) {
      if (s.headSha === pull.headSha) summaryByPath.set(s.path, s.summary);
    }

    const fileStats: FileStat[] = files.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
    }));

    return {
      groups: groupFiles(fileStats, marksByPath, summaryByPath),
      split_suggestion: splitSuggestion(fileStats),
    };
  }
}
