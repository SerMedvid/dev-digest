import { z } from 'zod';
import { ToolError, ok, toToolResult } from '../errors.js';
import { projectFindings } from '../project.js';
import { resolveAgent, resolvePull, resolveRepo } from '../resolve.js';
import { waitForRun } from '../wait.js';
import type { ToolDef } from './index.js';

const Args = z.object({
  repo: z.string().describe('Repository slug, "owner/name" — for example "acme/payments-api".'),
  pr: z.number().int().positive().describe('Pull request number as it appears on GitHub, e.g. 482.'),
  agent: z
    .string()
    .describe('Reviewer agent name exactly as devdigest_list_agents returns it, e.g. "Security Reviewer".'),
  wait_seconds: z
    .number()
    .int()
    .positive()
    .max(600)
    .optional()
    .describe('How long to wait for the review before handing back a run id. Defaults to 120.'),
  limit: z.number().int().positive().max(100).default(20).describe('Maximum findings to return.'),
  format: z
    .enum(['concise', 'detailed'])
    .default('concise')
    .describe('"concise" returns severity, category, title, file and lines. "detailed" adds rationale, suggestion and confidence.'),
});

export const runAgentOnPrTool: ToolDef = {
  name: 'devdigest_run_agent_on_pr',
  description:
    'Run a DevDigest reviewer agent on a pull request and return its findings. This performs the ' +
    'whole job in one call: it starts the review, waits for it to finish, and returns the verdict, ' +
    'score and findings — you do not need to poll. Reviews cost money and take one to five minutes, ' +
    'so call this only when a fresh review is actually wanted; to read a review that already ran, ' +
    'use devdigest_get_findings. If the review is still going when the wait budget runs out, this ' +
    'returns the run id and tells you when to call devdigest_get_findings instead.',
  inputSchema: Args.shape,
  annotations: {
    title: 'Run a DevDigest review on a pull request',
    readOnlyHint: false,
    idempotentHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  async handler(rawArgs, deps) {
    try {
      const args = Args.parse(rawArgs);

      // Step 1 — resolve. Everything that can be wrong is caught before we
      // spend a model call.
      const repo = await resolveRepo(deps.api, args.repo);
      const pull = await resolvePull(deps.api, repo, args.pr);
      const agent = await resolveAgent(deps.api, args.agent);

      // Step 2 — start. The API returns run ids immediately and executes the
      // review in the background.
      const started = await deps.api.startReview(pull.id, agent.id);
      const run = started[0];
      if (!run) {
        throw new ToolError(
          `DevDigest accepted the request but started no run for "${agent.name}" on ${repo.full_name}#${pull.number}.`,
          'Check that the agent is enabled with devdigest_list_agents, then retry.',
        );
      }

      // Step 3 — wait, within a budget.
      const budgetMs = (args.wait_seconds ?? deps.waitSeconds) * 1000;
      const waited = await waitForRun(deps.api, pull.id, run.run_id, {
        budgetMs,
        pollIntervalMs: deps.pollIntervalMs,
      });

      if (waited.outcome === 'failed') {
        throw new ToolError(
          `The review by "${agent.name}" on ${repo.full_name}#${pull.number} failed: ${waited.run?.error ?? 'no reason reported'}.`,
          'Most failures are a missing or exhausted provider API key — check Settings → Providers in the DevDigest studio, then retry.',
        );
      }

      if (waited.outcome === 'cancelled') {
        throw new ToolError(
          `The review by "${agent.name}" on ${repo.full_name}#${pull.number} was cancelled.`,
          'Retry devdigest_run_agent_on_pr if the cancellation was not intentional.',
        );
      }

      if (waited.outcome === 'vanished') {
        throw new ToolError(
          `DevDigest lost track of run ${run.run_id} for ${repo.full_name}#${pull.number}.`,
          'Retry devdigest_run_agent_on_pr; if it keeps happening, check the terminal running the DevDigest API.',
        );
      }

      if (waited.outcome === 'timeout') {
        return ok({
          repo: repo.full_name,
          pr: pull.number,
          agent: agent.name,
          run_id: run.run_id,
          status: 'running',
          next: `The review is still running after ${budgetMs / 1000}s. Call devdigest_get_findings with repo "${repo.full_name}" and pr ${pull.number} in about 60 seconds to collect the result.`,
        });
      }

      // Step 4 — collect, scoped to this agent's review.
      const reviews = await deps.api.listReviews(pull.id);
      const projection = projectFindings(reviews, {
        format: args.format,
        limit: args.limit,
        agentName: agent.name,
      });

      return ok({
        repo: repo.full_name,
        pr: pull.number,
        title: pull.title,
        agent: agent.name,
        run_id: run.run_id,
        status: 'done',
        ...projection,
      });
    } catch (err) {
      return toToolResult(err);
    }
  },
};
