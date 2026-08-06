import { Severity, type FindingMark, type PrFileSummaryRecord, type SmartDiff } from '@devdigest/shared';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
import { MAX_SUMMARY_CHARS } from './constants.js';
import { groupFiles, splitSuggestion, type FileStat } from './helpers.js';
import type { FileSummaryModelPort, SmartDiffStorePort, SmartDiffSummaryPort } from './domain.js';

/** Mirrors `review.repo.ts`'s `KNOWN_SEVERITIES`: an unrecognised value is a
 *  live possibility (a stored `text` column, not a DB-level enum), and this
 *  guard drops the mark rather than letting an unvalidated string reach the
 *  wire under `FindingMark['severity']`'s type. */
const KNOWN_SEVERITIES = new Set<string>(Severity.options);

/** The narrow half of the platform logger — never the platform object itself. */
export interface Logger {
  warn(obj: unknown, msg?: string): void;
  /** Optional: the pre-Task-6 hermetic degradation test supplies `warn` only. */
  info?(obj: unknown, msg?: string): void;
}

export interface SmartDiffServiceDeps {
  store: SmartDiffStorePort;
  repo: SmartDiffSummaryPort;
  /** Resolves the workspace's model choice (or the registry default) into a bound caller — same shape as `IntentServiceDeps.model`. */
  model: (workspaceId: string) => Promise<FileSummaryModelPort>;
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
  /**
   * In-process guard against two derivations for one (prId, path) at once.
   * Like `IntentService.inFlight` and `RunBus`'s cancel set, it does not
   * survive a restart — the cost of that is one duplicate call, so it needs
   * no table.
   */
  private readonly inFlight = new Set<string>();

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
      if (!KNOWN_SEVERITIES.has(f.severity)) continue;
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

  /**
   * Derive (or serve cached) an on-demand summary of one changed file. A user
   * action, so — unlike `get()`'s findings degradation — every failure
   * throws: a silent success would tell the user the button worked when it
   * didn't. Nothing is persisted on a failed call.
   */
  async summarize(workspaceId: string, prId: string, path: string): Promise<PrFileSummaryRecord> {
    const pull = await this.deps.store.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // `path` must be material the workspace already imported, checked BEFORE
    // any model call — without this the endpoint would summarise an
    // arbitrary caller-supplied string on the model's dime.
    const files = await this.deps.store.getPrFiles(prId);
    const file = files.find((f) => f.path === path);
    if (!file) throw new NotFoundError('File not part of this pull request');

    // A file with no stored patch has nothing to summarise — GitHub omits
    // `patch` for large and binary files, and a fresh install's seed leaves it
    // null on most rows (§4's degradation table). Refusing BEFORE any model
    // call, exactly like the check above, is the only way to stop a
    // structured-output call from inventing a plausible-sounding sentence for
    // a diff it was never shown, then persisting it as if it were genuine.
    if (!file.patch) throw new NotFoundError('This file has no stored diff to summarize');

    // A row keyed to the pull's CURRENT head is safe to serve with no model
    // call — one describing a different commit would not be (mirrors `get()`'s
    // summaryByPath filter).
    const existing = await this.deps.repo.summariesForPr(prId);
    const cached = existing.find((s) => s.path === path);
    if (cached && cached.headSha === pull.headSha) {
      return {
        pr_id: prId,
        path: cached.path,
        head_sha: cached.headSha,
        summary: cached.summary,
        provider: cached.provider,
        model: cached.model,
        created_at: cached.createdAt.toISOString(),
      };
    }

    const key = `${prId}:${path}`;
    if (this.inFlight.has(key)) {
      throw new ConflictError('A summary is already being derived for this file');
    }
    this.inFlight.add(key);
    try {
      const model = await this.deps.model(workspaceId);
      const patch = file.patch ?? '';

      const out = await model.summarize(path, patch);
      const summary = out.summary.slice(0, MAX_SUMMARY_CHARS);

      const createdAt = await this.deps.repo.upsertSummary(prId, {
        path,
        headSha: pull.headSha,
        summary,
        provider: model.provider,
        model: model.model,
      });

      this.deps.log?.info?.(
        {
          prId,
          path,
          provider: model.provider,
          model: model.model,
          chars_in: patch.length,
          chars_out: summary.length,
        },
        'smart-diff: file summary derived',
      );

      return {
        pr_id: prId,
        path,
        head_sha: pull.headSha,
        summary,
        provider: model.provider,
        model: model.model,
        created_at: createdAt.toISOString(),
      };
    } finally {
      this.inFlight.delete(key);
    }
  }
}
