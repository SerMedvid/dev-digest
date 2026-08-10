import { z } from 'zod';
import { ok, toToolResult } from '../errors.js';
import { projectBlastRadius } from '../project.js';
import { resolvePull, resolveRepo } from '../resolve.js';
import type { ToolDef } from './index.js';

/**
 * The argument schema was declared FINAL while the handler was a stub, and it
 * is unchanged here — callers written against it keep working.
 */
const Args = z.object({
  repo: z.string().describe('Repository slug, "owner/name" — for example "acme/payments-api".'),
  pr: z.number().int().positive().describe('Pull request number as it appears on GitHub, e.g. 482.'),
});

export const blastRadiusTool: ToolDef = {
  name: 'devdigest_get_blast_radius',
  description:
    'Map the blast radius of a pull request: the symbols it changed, the files that call them ' +
    '(with file:line), and the HTTP endpoints and scheduled jobs downstream — including ones ' +
    'reached indirectly, through a file that imports a changed file. Use it to judge what a ' +
    'change can affect beyond the files it touches. The result is read from a prebuilt index, ' +
    'so check "status": "ok" means the map is complete, "partial" means the index itself is ' +
    'incomplete so callers may be missing, and "degraded" means the index could not be ' +
    'read at all — empty arrays then mean "unknown", never "nothing calls this".',
  inputSchema: Args.shape,
  annotations: {
    title: "Map a pull request's blast radius",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(rawArgs, deps) {
    try {
      const args = Args.parse(rawArgs);
      const repo = await resolveRepo(deps.api, args.repo);
      const pull = await resolvePull(deps.api, repo, args.pr);

      const res = await deps.api.getBlastRadius(pull.id);

      // A degraded map is a SUCCESSFUL read of an unusable index, so it is
      // returned as a result carrying its status — not raised as an error, and
      // never flattened into an empty-looking success.
      return ok({
        repo: repo.full_name,
        pr: pull.number,
        ...(projectBlastRadius(res) as unknown as Record<string, unknown>),
      });
    } catch (err) {
      return toToolResult(err);
    }
  },
};
