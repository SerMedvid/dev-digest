import { z } from 'zod';
import { ToolError, ok, toToolResult } from '../errors.js';
import { projectFindings } from '../project.js';
import { resolvePull, resolveRepo } from '../resolve.js';
import type { Severity } from '../types.js';
import type { ToolDef } from './index.js';

const Args = z.object({
  repo: z.string().describe('Repository slug, "owner/name" — for example "acme/payments-api".'),
  pr: z.number().int().positive().describe('Pull request number as it appears on GitHub, e.g. 482.'),
  agent: z
    .string()
    .optional()
    .describe('Optional reviewer name to filter by; omit to combine every reviewer that ran.'),
  severity: z
    .enum(['CRITICAL', 'WARNING', 'SUGGESTION'])
    .optional()
    .describe('Optional filter; use CRITICAL first when a PR has many findings.'),
  limit: z.number().int().positive().max(100).default(20).describe('Maximum findings to return.'),
  format: z
    .enum(['concise', 'detailed'])
    .default('concise')
    .describe('"concise" returns severity, category, title, file and lines. "detailed" adds rationale, suggestion and confidence — use it only for the findings you are about to act on.'),
});

export const getFindingsTool: ToolDef = {
  name: 'devdigest_get_findings',
  description:
    'Read the result of a review that has already run on a pull request: the overall verdict, ' +
    'the score, per-severity counts and the findings themselves. Use this to inspect a PR that ' +
    'was reviewed earlier, or after devdigest_run_agent_on_pr reported that its run was still ' +
    'in progress. It never starts a review — call devdigest_run_agent_on_pr for that. Dismissed ' +
    'findings are excluded.',
  inputSchema: Args.shape,
  annotations: {
    title: 'Read DevDigest findings for a pull request',
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(rawArgs, deps) {
    try {
      const args = Args.parse(rawArgs);
      const repo = await resolveRepo(deps.api, args.repo);
      const pull = await resolvePull(deps.api, repo, args.pr);

      const reviews = await deps.api.listReviews(pull.id);
      if (reviews.length === 0) {
        throw new ToolError(
          `Pull request #${args.pr} in ${repo.full_name} has not been reviewed yet.`,
          `Run a review first: devdigest_run_agent_on_pr with repo "${repo.full_name}", pr ${args.pr} and an agent from devdigest_list_agents.`,
        );
      }

      // An agent filter that matches nothing would otherwise project to
      // {verdict: "no_reviews", total: 0} — a successful-looking result the
      // model reads as "this PR was never reviewed". Name who did review instead.
      if (args.agent) {
        const wanted = args.agent.trim().toLowerCase();
        const matched = reviews.some((r) => (r.agent_name ?? '').toLowerCase() === wanted);
        if (!matched) {
          const reviewers = [
            ...new Set(reviews.map((r) => r.agent_name).filter((n): n is string => Boolean(n))),
          ];
          throw new ToolError(
            reviewers.length > 0
              ? `No review by "${args.agent}" exists on ${repo.full_name}#${args.pr}.`
              : `The review on ${repo.full_name}#${args.pr} is not attributed to a named agent, so it cannot be filtered by agent.`,
            reviewers.length > 0
              ? `That pull request was reviewed by: ${reviewers.join(', ')}. Retry with one of those names, drop the agent argument to combine every reviewer, or start a fresh review with devdigest_run_agent_on_pr.`
              : 'Drop the agent argument to read the review as it stands, or start an attributed review with devdigest_run_agent_on_pr.',
          );
        }
      }

      const projection = projectFindings(reviews, {
        format: args.format,
        limit: args.limit,
        ...(args.severity ? { severity: args.severity as Severity } : {}),
        ...(args.agent ? { agentName: args.agent } : {}),
      });

      return ok({
        repo: repo.full_name,
        pr: pull.number,
        title: pull.title,
        ...projection,
      });
    } catch (err) {
      return toToolResult(err);
    }
  },
};
