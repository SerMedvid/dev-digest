import type { OnboardingViewValue } from '@devdigest/shared';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
import type { TourEnvelope, TourRepoRef } from './domain.js';
import { buildFacts } from './facts.js';
import { assembleSections } from './helpers.js';
import type { OnboardingServiceDeps } from './ports.js';

/** The tour's prose language. Not configurable yet — one knob, one lesson. */
const LANGUAGE = 'English';

/**
 * Onboarding use-cases. Takes ports, never `Container` — onion law 2.
 *
 * `runGenerate` is the job body and owns one invariant above all others: every
 * terminal path writes a status. A tour left `running` shows the user a spinner
 * forever, which is worse than an error.
 */
export class OnboardingService {
  constructor(private deps: OnboardingServiceDeps) {}

  async view(workspaceId: string, repoId: string): Promise<OnboardingViewValue> {
    await this.mustGetRepo(workspaceId, repoId);
    const [stored, indexState] = await Promise.all([
      this.deps.repo.getEnvelope(repoId),
      this.deps.repoIntel.getIndexState(repoId),
    ]);

    if (!stored) {
      return {
        status: 'empty',
        sections: [],
        generatedAt: null,
        stale: false,
        indexedFiles: indexState.filesIndexed,
        error: null,
        // An unindexed repo cannot be toured yet; that is a different empty.
        reason: indexState.filesIndexed === 0 ? 'not_indexed' : 'never_generated',
      };
    }

    const { envelope, generatedAt } = stored;
    return {
      status: envelope.status,
      sections: envelope.sections,
      // Always the last SUCCESSFUL generation — running/failed never bump it.
      generatedAt: generatedAt.toISOString(),
      // Derived, never stored: the index moved on since this tour was written.
      stale: envelope.status === 'ready' && envelope.indexSha !== indexState.lastIndexedSha,
      indexedFiles: envelope.indexedFiles || indexState.filesIndexed,
      error: envelope.error ?? null,
      reason: null,
    };
  }

  /**
   * Validates and reserves the slot, so the screen shows `running` the moment
   * the request returns rather than after the worker picks the job up. The
   * caller enqueues the job.
   */
  async requestGenerate(workspaceId: string, repoId: string): Promise<void> {
    await this.mustGetRepo(workspaceId, repoId);
    const stored = await this.deps.repo.getEnvelope(repoId);
    if (stored?.envelope.status === 'running') {
      throw new ConflictError('An onboarding tour for this repo is already being generated');
    }
    await this.deps.repo.markRunning(repoId, stored?.envelope.sections ?? []);
  }

  /**
   * The worker body. Never throws: a failure is a `failed` envelope with a
   * readable message, because nothing is waiting on the promise to report it.
   */
  async runGenerate(workspaceId: string, repoId: string): Promise<void> {
    const previous = (await this.deps.repo.getEnvelope(repoId))?.envelope.sections ?? [];
    try {
      const repo = await this.mustGetRepo(workspaceId, repoId);
      await this.deps.repo.markRunning(repoId, previous);

      if (!repo.clonePath) {
        await this.deps.repo.saveFailed(repoId, 'This repo has no clone on disk yet', previous);
        return;
      }

      const facts = await buildFacts(
        { repoIntel: this.deps.repoIntel, clone: this.deps.clone },
        repoId,
        repo.clonePath,
      );
      if (facts.indexedFiles === 0) {
        await this.deps.repo.saveFailed(
          repoId,
          'This repo is not indexed yet — run a resync first',
          previous,
        );
        return;
      }

      const model = await this.deps.model(workspaceId);
      const narrative = await model.write(facts, LANGUAGE);
      const envelope: TourEnvelope = {
        status: 'ready',
        indexSha: facts.indexSha,
        indexedFiles: facts.indexedFiles,
        sections: assembleSections(facts, narrative),
      };
      await this.deps.repo.saveReady(repoId, envelope);
      this.deps.logger?.info(
        { repoId, provider: model.provider, model: model.model, sections: envelope.sections.length },
        'onboarding tour generated',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger?.warn({ repoId, err: message }, 'onboarding generation failed');
      // `previous` is the last set of sections known good — keeping them beats
      // blanking the page just because a regeneration failed.
      await this.deps.repo.saveFailed(repoId, message, previous);
    }
  }

  private async mustGetRepo(workspaceId: string, repoId: string): Promise<TourRepoRef> {
    const repo = await this.deps.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }
}
