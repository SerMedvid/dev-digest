import type {
  BlastRadiusResponse,
  BlastSummaryResponse,
  PriorPrsResponse,
} from '@devdigest/shared';
import { AppError, ConflictError, NotFoundError } from '../../platform/errors.js';
import {
  BLAST_REASON,
  MAX_OVERLAP_FILES_PER_PR,
  MAX_PRIOR_PRS,
  MAX_SUMMARY_CHARS,
  PRIOR_PR_STATUSES,
} from './constants.js';
import { degradedWire, toPriorPrWire, toWire } from './helpers.js';
import type { BlastPullHead, BlastServiceDeps } from './ports.js';

/**
 * Blast radius: which symbols a PR changed, who calls them, and which HTTP
 * endpoints / crons sit downstream — read ENTIRELY from the persisted index.
 * No AST rebuild, no import-graph rebuild, and no model call on this path.
 *
 * The one thing this service must never do is answer "nothing found" when the
 * truth is "we could not look". That distinction lives in `status`/`reason`,
 * derived in `helpers.toWire`.
 */
export class BlastService {
  /**
   * In-process guard against two derivations for one PR at once. Like
   * `SmartDiffService.inFlight` it does not survive a restart — the cost of
   * that is one duplicate call, so it needs no table.
   */
  private readonly inFlight = new Set<string>();

  constructor(private deps: BlastServiceDeps) {}

  async get(workspaceId: string, prId: string): Promise<BlastRadiusResponse> {
    const pull = await this.requirePull(workspaceId, prId);
    const wire = await this.computeMap(pull);

    // Only a summary written against the pull's CURRENT head describes the map
    // we just computed; an older one describes code that no longer exists.
    const cached = await this.deps.summaries.get(prId);
    if (cached && cached.headSha === pull.headSha) {
      return { ...wire, summary: cached.summary };
    }
    return wire;
  }

  /**
   * Explain the map in one paragraph. A user action, so — unlike a read —
   * every failure throws: a silent success would tell the user the button
   * worked when it didn't. Nothing is persisted on a failed call.
   */
  async summarize(workspaceId: string, prId: string): Promise<BlastSummaryResponse> {
    const pull = await this.requirePull(workspaceId, prId);

    // A row at the CURRENT head describes the map we would recompute, so it is
    // served with zero model calls. One at an older head is not served at all.
    const cached = await this.deps.summaries.get(prId);
    if (cached && cached.headSha === pull.headSha) {
      return { summary: cached.summary, head_sha: pull.headSha };
    }

    const map = await this.computeMap(pull);
    // Explaining a map that says "no data" is an invitation to hallucinate:
    // the arrays are empty because we are blind, and a model asked to describe
    // them will describe something. Refuse BEFORE spending the call.
    if (map.status === 'degraded') {
      throw new AppError(
        'blast_degraded',
        'Blast map is degraded — nothing to explain',
        422,
        { reason: map.reason },
      );
    }

    if (this.inFlight.has(prId)) {
      throw new ConflictError('A blast summary is already being derived for this pull request');
    }
    this.inFlight.add(prId);
    try {
      const model = await this.deps.model(workspaceId);
      // The model explains the map the user is looking at, minus the summary
      // slot it is about to fill.
      const { summary: _omit, ...mapWithoutSummary } = map;
      const mapJson = JSON.stringify(mapWithoutSummary);

      const out = await model.explain(mapJson);
      const summary = out.summary.slice(0, MAX_SUMMARY_CHARS);

      await this.deps.summaries.put({
        prId,
        headSha: pull.headSha,
        summary,
        provider: model.provider,
        model: model.model,
      });

      this.deps.log?.info?.(
        {
          prId,
          provider: model.provider,
          model: model.model,
          chars_in: mapJson.length,
          chars_out: summary.length,
        },
        'blast: map summary derived',
      );

      return { summary, head_sha: pull.headSha };
    } finally {
      this.inFlight.delete(prId);
    }
  }

  /**
   * Which merged or closed PRs have already been in these files.
   *
   * Nothing here touches the code index, so this answers just as well on a
   * `degraded` map as on a healthy one — which is why the card renders it in
   * both. `uncomparable_prs` is read even when the list short-circuits: an
   * empty list is only honest alongside the count of what could not be looked
   * at (`pr_files` is populated by `GET /pulls/:id`, so a PR nobody opened has
   * no rows here).
   */
  async priorPrs(workspaceId: string, prId: string): Promise<PriorPrsResponse> {
    const pull = await this.requirePull(workspaceId, prId);

    const uncomparable = await this.deps.store.countPrsWithoutFiles({
      workspaceId,
      repoId: pull.repoId,
      excludePrId: pull.id,
    });

    const paths = await this.deps.store.getPrFilePaths(pull.id);
    // No stored paths, no question to ask — and `path IN ()` is not valid SQL.
    if (paths.length === 0) return { prs: [], uncomparable_prs: uncomparable };

    const rows = await this.deps.store.priorPrs({
      workspaceId,
      repoId: pull.repoId,
      excludePrId: pull.id,
      paths,
      statuses: PRIOR_PR_STATUSES,
      limit: MAX_PRIOR_PRS,
    });

    return {
      prs: rows.map((r) => toPriorPrWire(r, MAX_OVERLAP_FILES_PER_PR)),
      uncomparable_prs: uncomparable,
    };
  }

  /** 404 — a PR in another workspace is indistinguishable from one that does not exist. */
  protected async requirePull(workspaceId: string, prId: string): Promise<BlastPullHead> {
    const pull = await this.deps.store.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }

  /** The map with no summary attached — shared by the GET path and Task 6's POST. */
  protected async computeMap(pull: BlastPullHead): Promise<BlastRadiusResponse> {
    const files = await this.deps.store.getPrFilePaths(pull.id);
    // Short-circuit BEFORE touching repo-intel: with no changed files there is
    // no question to ask, and asking anyway would report a repo-wide answer.
    if (files.length === 0) return degradedWire(pull.headSha, BLAST_REASON.noFiles);

    const result = await this.deps.intel.blastRadius(pull.repoId, files);
    const state = await this.deps.intel.indexState(pull.repoId);
    return toWire(result, state, pull.headSha, null);
  }
}
