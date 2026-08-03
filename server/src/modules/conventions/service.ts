import type { ConventionSkillDraft, ConventionsView, SkillType } from '@devdigest/shared';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
import { MAX_SELECTED, MIN_SELECTED, POOL_SIZE } from './constants.js';
import type { RawCandidate, SampleFile } from './domain.js';
import { toCandidateDto, toScanDto } from './helpers.js';
import type {
  CandidatePatch,
  ConventionsModelPort,
  ConventionsServiceDeps,
} from './ports.js';
import { buildSkillBody, buildSkillDescription, buildSkillName } from './skill-body.js';
import { verifyCandidates } from './verify.js';

/**
 * Conventions use-cases. Takes ports, never `Container` — see the
 * onion-architecture skill's law 2.
 *
 * `runScan` is the job body. It owns one invariant above all others: every
 * terminal path writes a scan status. A scan left `running` shows the user a
 * spinner forever, which is worse than an error.
 */

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
  agentId?: string;
}

export class ConventionsService {
  constructor(private deps: ConventionsServiceDeps) {}

  async view(workspaceId: string, repoId: string): Promise<ConventionsView> {
    await this.mustGetRepo(workspaceId, repoId);
    const [scan, candidates] = await Promise.all([
      this.deps.repo.getScan(repoId),
      this.deps.repo.listCandidates(repoId),
    ]);
    return {
      scan: scan ? toScanDto(scan) : null,
      candidates: candidates.map(toCandidateDto),
    };
  }

  /** Validates and queues. The caller enqueues the job. */
  async requestScan(workspaceId: string, repoId: string): Promise<void> {
    await this.mustGetRepo(workspaceId, repoId);
    const scan = await this.deps.repo.getScan(repoId);
    if (scan && (scan.status === 'queued' || scan.status === 'running')) {
      throw new ConflictError('A conventions scan for this repo is already in progress');
    }
    await this.deps.repo.queueScan(repoId);
  }

  /**
   * The worker body. Never throws: a failure is a `failed` scan row with a
   * readable error, because nothing is waiting on the promise to report it.
   */
  async runScan(workspaceId: string, repoId: string): Promise<void> {
    let model: ConventionsModelPort | undefined;
    try {
      const repo = await this.mustGetRepo(workspaceId, repoId);
      if (!repo.clonePath) {
        await this.deps.repo.failScan(repoId, 'This repo has no clone on disk yet');
        return;
      }
      model = await this.deps.model(workspaceId);
      await this.deps.repo.markRunning(repoId, model.provider, model.model);

      const pool = await this.deps.repoIntel.getTopFilesByRank(repoId, POOL_SIZE);
      const selected = await this.selectFiles(model, pool);

      const [configs, code] = await Promise.all([
        this.deps.sampler.configSamples(repo.clonePath),
        this.deps.sampler.readSamples(repo.clonePath, selected),
      ]);
      const files = [...configs, ...code];

      const raw = files.length === 0 ? [] : await model.extract({ files });
      const { kept, dropped } = verifyCandidates({ candidates: raw, shown: shownLines(files) });

      await this.deps.repo.replaceCandidates(workspaceId, repoId, kept);
      await this.deps.repo.finishScan(repoId, {
        poolCount: pool.length,
        sampleCount: files.length,
        candidateCount: kept.length,
        dropped,
        provider: model.provider,
        model: model.model,
      });
    } catch (err) {
      await this.deps.repo.failScan(repoId, (err as Error).message).catch(() => {});
    }
  }

  async patchCandidate(workspaceId: string, id: string, patch: CandidatePatch) {
    const record = await this.deps.repo.patchCandidate(workspaceId, id, patch);
    if (!record) throw new NotFoundError('Convention not found');
    return toCandidateDto(record);
  }

  async skillDraft(workspaceId: string, repoId: string): Promise<ConventionSkillDraft> {
    const repo = await this.mustGetRepo(workspaceId, repoId);
    const accepted = await this.mustHaveAccepted(repoId);
    const body = buildSkillBody({ repoName: repo.name, candidates: accepted });
    return {
      name: buildSkillName(repo.name),
      description: buildSkillDescription(accepted.length, repo.name),
      type: 'convention',
      body,
      token_estimate: this.deps.tokenCount(body),
    };
  }

  /**
   * The body is the client's, edits included — the server does not re-derive it.
   * But `evidence_files` comes from the accepted candidates, and a repo with
   * none cannot produce an extracted skill: that provenance is the only thing
   * backing the decision to render extracted bodies as trusted prompt text.
   */
  async createSkill(
    workspaceId: string,
    repoId: string,
    input: CreateSkillInput,
  ): Promise<{ id: string }> {
    await this.mustGetRepo(workspaceId, repoId);
    const accepted = await this.mustHaveAccepted(repoId);
    const evidenceFiles = [...new Set(accepted.map((c) => c.evidencePath))];

    const skill = await this.deps.skills.createExtracted(workspaceId, {
      name: input.name,
      description: input.description,
      type: input.type,
      body: input.body,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      evidenceFiles,
    });
    if (input.agentId) {
      await this.deps.skills.linkToAgent(workspaceId, input.agentId, skill.id);
    }
    return skill;
  }

  /**
   * Step 1, with its fallback. The model may only choose from the pool, so an
   * invented path is dropped; too few survivors are topped up by rank. A
   * selection call that fails is logged and replaced by the code-only choice —
   * one failed optimisation must not break the feature.
   */
  private async selectFiles(model: ConventionsModelPort, pool: string[]): Promise<string[]> {
    if (pool.length === 0) return [];
    const fallback = pool.slice(0, MAX_SELECTED);
    let chosen: string[];
    try {
      chosen = await model.selectFiles({ pool });
    } catch (err) {
      this.deps.logger?.warn(
        { err: (err as Error).message },
        'conventions: file selection failed, falling back to rank order',
      );
      return fallback;
    }

    const allowed = new Set(pool);
    const valid = [...new Set(chosen.filter((p) => allowed.has(p)))].slice(0, MAX_SELECTED);
    if (valid.length >= MIN_SELECTED) return valid;

    this.deps.logger?.info(
      { chosen: chosen.length, valid: valid.length },
      'conventions: topping up the file selection from rank order',
    );
    const topped = [...valid];
    for (const path of pool) {
      if (topped.length >= MAX_SELECTED) break;
      if (!topped.includes(path)) topped.push(path);
    }
    return topped;
  }

  private async mustGetRepo(workspaceId: string, repoId: string) {
    const repo = await this.deps.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  private async mustHaveAccepted(repoId: string) {
    const accepted = await this.deps.repo.listAccepted(repoId);
    if (accepted.length === 0) {
      throw new ConflictError('Accept at least one convention before creating a skill');
    }
    return accepted;
  }
}

/** path → lines, for exactly the files the model was shown. */
function shownLines(files: SampleFile[]): Map<string, string[]> {
  return new Map(files.map((f) => [f.path, f.content.split('\n')]));
}

/** Re-exported so routes.ts can name the patch shape without reaching into ports. */
export type { CandidatePatch, RawCandidate };
