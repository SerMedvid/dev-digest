import type { IntentConfidence, PrIntentRecord } from '@devdigest/shared';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
import { MAX_BODY_BYTES } from './constants.js';
import type { IntentDoc } from './domain.js';
import { computeConfidence, crossRepoIssueRefs, docReferences, linkedIssueNumbers } from './helpers.js';
import type { IntentServiceDeps } from './ports.js';

/**
 * Derive a PR's intent from the evidence that exists, and say what that
 * evidence was.
 *
 * Two entry points with deliberately different failure behaviour:
 *   - `derive` is a user action, so it throws (404 unknown PR, 409 in flight).
 *   - `ensureFresh` runs inside a review, where a failed classification must
 *     degrade to "no intent section" rather than fail the review.
 */
export class IntentService {
  /** In-process guard against two derivations for one PR. Like RunBus's cancel
      set, it does not survive a restart — the cost of that is one duplicate
      classification, so it needs no table. */
  private readonly inFlight = new Set<string>();

  constructor(private deps: IntentServiceDeps) {}

  async get(workspaceId: string, prId: string): Promise<PrIntentRecord | undefined> {
    const pull = await this.deps.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const stored = await this.deps.store.get(prId);
    if (!stored) return undefined;
    return {
      intent: stored.intent,
      in_scope: stored.in_scope,
      out_of_scope: stored.out_of_scope,
      pr_id: prId,
      head_sha: stored.headSha,
      confidence: stored.confidence,
      sources: stored.sources,
      missing_context: stored.missingContext,
      provider: stored.provider,
      model: stored.model,
      created_at: stored.createdAt.toISOString(),
    };
  }

  /** The cached record when it matches `headSha`, else a fresh derivation.
      Returns undefined when derivation fails — never throws. */
  async ensureFresh(
    workspaceId: string,
    prId: string,
    headSha: string,
    opts: { onLog?: (msg: string, data?: unknown) => void } = {},
  ): Promise<PrIntentRecord | undefined> {
    try {
      const existing = await this.get(workspaceId, prId);
      if (existing && existing.head_sha === headSha) {
        opts.onLog?.('Reusing the stored PR intent (head unchanged)', {
          confidence: existing.confidence,
          sources: existing.sources,
          model: existing.model,
        });
        return existing;
      }
      return await this.derive(workspaceId, prId, opts);
    } catch (err) {
      // Best-effort, exactly like repo-intel enrichment: the review runs on.
      //
      // Nothing in this recovery path may throw — "never throws" is the whole
      // contract, and a handler that throws breaks it just as loudly as the
      // body would. `onLog` is run-executor's run-log writer in a review, which
      // is not obviously throw-free. Each sink is guarded on its own so a
      // failing one cannot suppress the other.
      const message = err instanceof Error ? err.message : String(err);
      try {
        this.deps.logger?.warn({ prId, err: message }, 'intent: derivation failed');
      } catch {
        /* a logging sink must never be the thing that fails a review */
      }
      try {
        opts.onLog?.(`Intent derivation failed: ${message}`);
      } catch {
        /* ditto */
      }
      return undefined;
    }
  }

  async derive(
    workspaceId: string,
    prId: string,
    opts: { onLog?: (msg: string, data?: unknown) => void } = {},
  ): Promise<PrIntentRecord> {
    const pull = await this.deps.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    if (this.inFlight.has(prId)) {
      throw new ConflictError('An intent derivation is already running for this pull request');
    }
    this.inFlight.add(prId);
    try {
      const repo = await this.deps.repo.getRepo(pull.repoId);
      if (!repo) throw new NotFoundError('Repository not found');

      const sources: IntentDoc[] = [{ label: 'title', content: pull.title }];
      const missingContext: string[] = [];

      const body = pull.body?.trim() ?? '';
      const hasBody = body.length > 0;
      if (hasBody) {
        sources.push({ label: 'description', content: body.slice(0, MAX_BODY_BYTES) });
      }

      // Linked issues. Cross-repo references are recorded, never fetched.
      const issueNumbers = linkedIssueNumbers(pull.body);
      // Skip the port call when the body links no issue. This saves no GitHub
      // call and no token — `GitHubIssueReader.fetch` already early-returns on
      // an empty list, before it ever resolves the client. What it does is pin
      // the rule at the service boundary: a PR that links no issue can never
      // acquire an `issue#` source or an issue-shaped missing-context note,
      // whatever a port implementation hands back for an empty request.
      const issues: { found: IntentDoc[]; missing: string[] } =
        issueNumbers.length > 0
          ? await this.deps.issues.fetch({ owner: repo.owner, name: repo.name }, issueNumbers)
          : { found: [], missing: [] };
      sources.push(...issues.found);
      missingContext.push(...issues.missing);
      for (const ref of crossRepoIssueRefs(pull.body)) {
        missingContext.push(`${ref} was not fetched: only issues in this repository are read`);
      }

      // Plan / spec documents, from the clone we already have.
      const docRefs = docReferences(pull.body, repo.owner, repo.name);
      if (docRefs.length > 0) {
        if (!repo.clonePath) {
          for (const rel of docRefs) {
            missingContext.push(`${rel} was not read: this repository has no clone on disk`);
          }
        } else {
          const docs = await this.deps.docs.read(repo.clonePath, docRefs);
          sources.push(...docs.found);
          missingContext.push(...docs.missing);
        }
      }

      // Files + hunk headers. Never bodies.
      const hunkDigest = (await this.deps.diff.hunkDigest(workspaceId, prId)) ?? '';
      if (!hunkDigest) missingContext.push('the PR diff could not be loaded');

      const model = await this.deps.model(workspaceId);
      const sourceLabels = [...sources.map((s) => s.label), 'hunk_headers'];
      const promptChars = sources.reduce((n, s) => n + s.content.length, 0) + hunkDigest.length;

      opts.onLog?.('Classifying PR intent', {
        provider: model.provider,
        model: model.model,
        sources: sourceLabels,
        missing_context: missingContext,
        chars_in: promptChars,
        est_tokens_in: this.deps.tokenCount(`${sources.map((s) => s.content).join('\n')}\n${hunkDigest}`),
      });

      const out = await model.classify({
        sources,
        hunkDigest,
        missingContext,
        sessionId: `${repo.owner}/${repo.name}#${pull.number}:intent`,
      });

      const confidence: IntentConfidence = computeConfidence({
        hasBody,
        hasIssue: issues.found.length > 0,
        hasDoc: sources.some((s) => s.label.startsWith('doc:')),
        missingContext,
      });

      await this.deps.store.put(prId, {
        intent: out.intent,
        headSha: pull.headSha,
        confidence,
        sources: sourceLabels,
        missingContext,
        provider: model.provider,
        model: model.model,
      });

      opts.onLog?.('PR intent derived', {
        confidence,
        in_scope: out.intent.in_scope.length,
        out_of_scope: out.intent.out_of_scope.length,
        tokens_in: out.tokensIn,
        tokens_out: out.tokensOut,
      });

      return {
        ...out.intent,
        pr_id: prId,
        head_sha: pull.headSha,
        confidence,
        sources: sourceLabels,
        missing_context: missingContext,
        provider: model.provider,
        model: model.model,
        created_at: new Date().toISOString(),
      };
    } finally {
      this.inFlight.delete(prId);
    }
  }
}
