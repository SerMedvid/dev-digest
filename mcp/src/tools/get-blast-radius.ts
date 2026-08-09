import { z } from 'zod';
import { fail } from '../errors.js';
import type { ToolDef } from './index.js';

/**
 * The argument schema is FINAL — the implementation will fill in the handler
 * without changing the contract, so callers written against it keep working.
 */
const Args = z.object({
  repo: z.string().describe('Repository slug, "owner/name" — for example "acme/payments-api".'),
  pr: z.number().int().positive().describe('Pull request number as it appears on GitHub, e.g. 482.'),
});

export const blastRadiusTool: ToolDef = {
  name: 'devdigest_get_blast_radius',
  description:
    'Map the blast radius of a pull request — which modules and callers the change can affect ' +
    'beyond the files it touches. NOT IMPLEMENTED YET: this tool always returns an error. Do not ' +
    'call it. To judge the impact of a change today, use devdigest_get_findings for what the ' +
    'reviewers flagged and devdigest_get_conventions for the rules the change should respect.',
  inputSchema: Args.shape,
  annotations: {
    title: "Map a pull request's blast radius (not implemented)",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(_rawArgs, _deps) {
    return fail(
      'devdigest_get_blast_radius is not implemented yet — DevDigest has no blast-radius analysis to return.',
      'Use devdigest_get_findings for what the reviewers flagged on this PR, and devdigest_get_conventions for the repository rules the change should follow.',
    );
  },
};
