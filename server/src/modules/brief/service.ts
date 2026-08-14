import { Brief, type PrBriefRecord } from '@devdigest/shared';
import { AppError, ConflictError, NotFoundError } from '../../platform/errors.js';
import { BRIEF_REASON } from './constants.js';
import {
  buildAllowed,
  estTokens,
  groundBrief,
  renderInputs,
  type GroundDrop,
  type GroundedBrief,
} from './helpers.js';
import type {
  BriefBlastMap,
  BriefIntentRef,
  BriefPullRef,
  BriefReviewRef,
  BriefRow,
  BriefServiceDeps,
} from './ports.js';
import { buildBriefPrompt, promptChars } from './prompt.js';

/**
 * The PR Why + Risk Brief: seven inputs composed into one grounded artefact,
 * cached per `head_sha`.
 *
 * Two entry points with deliberately different behaviour:
 *   - `read` never calls a model. A row written at an older head is not served
 *     at all, because the file list, the blast map and the findings it
 *     described belong to code that no longer exists.
 *   - `generate` always generates. It is wired to an explicit refresh control,
 *     and a button that silently served a cached row would read as broken.
 *     This differs from `POST /pulls/:id/blast/summary`, which does serve its
 *     cache, and the difference is intentional.
 *
 * Every composition failure among the five optional sources degrades to an
 * omitted section with a note in `sources` — none of them fails the call. The
 * model call itself is the exception: it is a user action, and a silent success
 * would tell the user the button worked when it didn't.
 */
export class BriefService {
  /**
   * In-process guard against two generations for one PR at once. Like
   * `BlastService.inFlight` it does not survive a restart — the cost of that is
   * one duplicate generation, so it needs no table.
   */
  private readonly inFlight = new Set<string>();

  constructor(private deps: BriefServiceDeps) {}

  /** The cached record for the PR's CURRENT head, or undefined. No model call. */
  async read(workspaceId: string, prId: string): Promise<PrBriefRecord | undefined> {
    const pull = await this.requirePull(workspaceId, prId);
    const row = await this.deps.briefs.get(prId);
    // A row at an older head describes code that no longer exists. Not served,
    // not repaired, not silently regenerated — the user clicks.
    if (!row || row.headSha !== pull.headSha) return undefined;

    const parsed = Brief.safeParse(row.brief);
    if (!parsed.success) {
      // A stored brief that no longer parses is a contract change we did not
      // migrate. Report the empty state rather than a 500: the regenerate
      // control is right there, and it will write a row in the current shape.
      this.deps.log?.warn(
        { prId, issues: parsed.error.issues.length },
        'brief: stored row failed contract validation',
      );
      return undefined;
    }

    const latest = await this.deps.store.latestReview(prId);
    return this.toWire(prId, parsed.data, row, (latest?.reviewId ?? null) !== row.reviewId);
  }

  /**
   * Compose, call, ground, persist. Always generates.
   *
   * Both refusals below precede the model resolution, exactly as
   * `BlastService.summarize` refuses a degraded map before spending the call.
   */
  async generate(workspaceId: string, prId: string): Promise<PrBriefRecord> {
    const pull = await this.requirePull(workspaceId, prId);

    const files = await this.deps.store.getPrFiles(prId);
    // With no changed files there is no question to ask, and asking anyway
    // would produce a repo-wide answer dressed as a statement about this PR.
    if (files.length === 0) {
      throw new AppError(
        BRIEF_REASON.noFiles,
        'This pull request has no changed files to brief on',
        422,
      );
    }

    if (this.inFlight.has(prId)) {
      throw new ConflictError('A brief is already being generated for this pull request');
    }
    this.inFlight.add(prId);
    try {
      const repo = await this.deps.store.getRepo(pull.repoId);
      if (!repo) throw new NotFoundError('Repository not found');

      const notes: string[] = [];
      const [intent, blast, review, docs] = await Promise.all([
        this.loadIntent(prId, notes),
        this.loadBlast(workspaceId, prId, notes),
        this.loadReview(prId, notes),
        this.loadDocs(repo, pull.body, notes),
      ]);

      const rendered = renderInputs({ pull, files, intent, blast, review, docs: docs.found });
      const messages = buildBriefPrompt(rendered.sections);
      // Measured over exactly the characters that are sent — the same array the
      // model port receives, never a re-assembled copy.
      const promptText = messages.map((m) => m.content).join('');
      const chars = promptChars(messages);
      const estTokensIn = estTokens(promptText);
      const sources = [...rendered.sources, ...notes, ...docs.missing];

      const model = await this.deps.model(workspaceId);
      const out = await model.generate(messages);

      const specPaths = docs.found.map((d) =>
        d.label.startsWith('doc:') ? d.label.slice(4) : d.label,
      );
      const { brief, dropped } = groundBrief(
        out,
        buildAllowed({ files, blast, specPaths, findings: review?.findings ?? [] }),
      );

      // The GROUNDED brief is what is persisted. Storing the raw output and
      // grounding on read would put an ungrounded artefact one bug away from
      // the user, and would re-derive the allowed sets from inputs that have
      // since moved.
      await this.deps.briefs.put({
        prId,
        headSha: pull.headSha,
        brief,
        reviewId: review?.reviewId ?? null,
        sources,
        estTokensIn,
        provider: model.provider,
        model: model.model,
      });

      this.log(prId, model, promptText, chars, estTokensIn, sources, dropped);

      // Read back rather than reconstruct. The row is the record: rebuilding it
      // here means the `created_at` the caller receives is a second `new Date()`
      // that never matches the stored one, so a POST response and the GET that
      // follows it disagree about the same generation. One SELECT on an
      // explicit user action is cheap; the two disagreeing is not.
      const stored = await this.deps.briefs.get(prId);
      if (!stored) throw new AppError('brief_not_persisted', 'The brief could not be stored', 500);
      // Just generated against the PR's latest review — fresh by construction.
      return this.toWire(prId, brief, stored, false);
    } finally {
      this.inFlight.delete(prId);
    }
  }

  /** 404 — a PR in another workspace is indistinguishable from one that does not exist. */
  private async requirePull(workspaceId: string, prId: string): Promise<BriefPullRef> {
    const pull = await this.deps.store.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }

  private async loadIntent(prId: string, notes: string[]): Promise<BriefIntentRef | undefined> {
    try {
      const intent = await this.deps.store.getIntent(prId);
      if (!intent) notes.push('intent (none derived)');
      return intent;
    } catch {
      notes.push('intent (unavailable)');
      return undefined;
    }
  }

  /**
   * Best-effort. Unlike the blast summary — where a degraded map is the only
   * input and explaining it would be an invitation to hallucinate — the map is
   * one input of seven here, so a degraded or failed one omits its section and
   * the brief is composed from the rest.
   */
  private async loadBlast(
    workspaceId: string,
    prId: string,
    notes: string[],
  ): Promise<BriefBlastMap | null> {
    try {
      const map = await this.deps.blast.map(workspaceId, prId);
      if (map.status === 'degraded') {
        notes.push(`blast (degraded: ${map.reason ?? 'no data'})`);
        return null;
      }
      return map;
    } catch (err) {
      notes.push('blast (unavailable)');
      this.deps.log?.warn({ prId, err: message(err) }, 'brief: blast map unavailable');
      return null;
    }
  }

  private async loadReview(prId: string, notes: string[]): Promise<BriefReviewRef | undefined> {
    try {
      const review = await this.deps.store.latestReview(prId);
      // No findings means `review_focus` comes out file-level, every line null
      // — which is the honest result, not a degradation to apologise for.
      if (!review) notes.push('findings (no review yet)');
      return review;
    } catch (err) {
      notes.push('findings (unavailable)');
      this.deps.log?.warn({ prId, err: message(err) }, 'brief: latest review unavailable');
      return undefined;
    }
  }

  private async loadDocs(
    repo: { owner: string; name: string; clonePath: string | null },
    body: string | null,
    notes: string[],
  ): Promise<{ found: { label: string; content: string }[]; missing: string[] }> {
    try {
      return await this.deps.docs.read(repo, body);
    } catch (err) {
      notes.push('specs (unavailable)');
      this.deps.log?.warn({ err: message(err) }, 'brief: referenced documents unavailable');
      return { found: [], missing: [] };
    }
  }

  /**
   * One line, on pino. There is no run on this path, so the composition facts
   * have nowhere else to go — and a grounding drop that nothing records is a
   * suppressed finding nobody can see.
   */
  private log(
    prId: string,
    model: { provider: string; model: string },
    promptText: string,
    chars: number,
    estTokensIn: number,
    sources: string[],
    dropped: GroundDrop[],
  ): void {
    const drops = { risk: 0, ref: 0, focus: 0, line: 0 };
    for (const d of dropped) drops[d.kind] += 1;
    this.deps.log?.info?.(
      {
        prId,
        provider: model.provider,
        model: model.model,
        chars_in: chars,
        est_tokens_in: estTokensIn,
        // The real tiktoken count, for observability only — never the gate.
        // Counting is not free on a 32 000-character string, so it is done once
        // here and only when the dep was supplied.
        ...(this.deps.tokenCount ? { tokens_in: this.deps.tokenCount(promptText) } : {}),
        sources,
        dropped: drops,
      },
      'brief: generated',
    );
    for (const d of dropped) {
      this.deps.log?.warn({ prId, kind: d.kind, value: d.value }, `brief: dropped — ${d.reason}`);
    }
  }

  private toWire(
    prId: string,
    brief: GroundedBrief,
    row: BriefRow,
    stale: boolean,
  ): PrBriefRecord {
    return {
      ...brief,
      pr_id: prId,
      head_sha: row.headSha,
      review_id: row.reviewId,
      stale,
      sources: row.sources,
      est_tokens_in: row.estTokensIn,
      provider: row.provider,
      model: row.model,
      created_at: row.createdAt.toISOString(),
    };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
