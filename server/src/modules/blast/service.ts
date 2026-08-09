import type { BlastRadiusResponse } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { BLAST_REASON } from './constants.js';
import { degradedWire, toWire } from './helpers.js';
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

  async summarize(_workspaceId: string, _prId: string): Promise<never> {
    throw new Error('not implemented');
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
