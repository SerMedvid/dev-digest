import { z } from 'zod';
import { ToolError, ok, toToolResult } from '../errors.js';
import { projectConventions } from '../project.js';
import { resolveRepo } from '../resolve.js';
import type { ToolDef } from './index.js';

/**
 * Mirrors the server's ConventionCategory enum
 * (server/src/vendor/shared/contracts/knowledge.ts). Keep the two in step: a
 * category missing here is rejected as a bad argument, and a category listed
 * here that the server never emits returns a confusing empty result instead.
 */
const CATEGORIES = [
  'naming',
  'structure',
  'error-handling',
  'api-shape',
  'testing',
  'imports',
  'typing',
  'tooling',
] as const;

const Args = z.object({
  repo: z.string().describe('Repository slug, "owner/name" — for example "acme/payments-api".'),
  category: z
    .enum(CATEGORIES)
    .optional()
    .describe('Optional filter for one kind of convention.'),
  status: z
    .enum(['accepted', 'pending', 'rejected', 'all'])
    .default('accepted')
    .describe('Which candidates to return. Defaults to "accepted" — the rules a human confirmed.'),
  limit: z.number().int().positive().max(100).default(30).describe('Maximum conventions to return.'),
});

export const getConventionsTool: ToolDef = {
  name: 'devdigest_get_conventions',
  description:
    'Read the coding conventions DevDigest extracted from a repository — the house rules a change ' +
    'should follow (naming, structure, error handling, testing, imports, typing, tooling). Use this ' +
    'before writing or reviewing code in that repository so your suggestions match how the codebase ' +
    'already works. Returns confirmed ("accepted") rules by default.',
  inputSchema: Args.shape,
  annotations: {
    title: "Read a repository's extracted conventions",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(rawArgs, deps) {
    try {
      const args = Args.parse(rawArgs);
      const repo = await resolveRepo(deps.api, args.repo);
      const view = await deps.api.getConventions(repo.id);

      if (view.scan === null) {
        throw new ToolError(
          `Conventions have never been extracted for ${repo.full_name}.`,
          'Run the extraction in the DevDigest studio (the repo → Conventions → Extract), then retry.',
        );
      }

      const projection = projectConventions(view, {
        limit: args.limit,
        status: args.status === 'all' ? 'all' : args.status,
        ...(args.category ? { category: args.category } : {}),
      });

      if (projection.total === 0) {
        const pending = view.candidates.filter((c) => c.status === 'pending').length;
        throw new ToolError(
          `No ${args.status === 'all' ? '' : `${args.status} `}conventions match for ${repo.full_name} (scan status: ${projection.scan_status}).`,
          pending > 0
            ? `${pending} candidate(s) are still pending review. Accept them in the DevDigest studio (the repo → Conventions), or call this tool again with status "pending" to read them as-is.`
            : 'Re-run the extraction in the DevDigest studio (the repo → Conventions → Extract), or widen the filters (drop category, or use status "all").',
        );
      }

      return ok({ repo: repo.full_name, ...projection });
    } catch (err) {
      return toToolResult(err);
    }
  },
};
