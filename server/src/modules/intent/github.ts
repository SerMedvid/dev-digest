import type { GitHubClient } from '@devdigest/shared';
import { MAX_ERROR_CHARS, MAX_ISSUES, MAX_ISSUE_BYTES } from './constants.js';
import type { IntentDoc } from './domain.js';
import type { IssuePort } from './ports.js';

/**
 * A `missing` note ends up in the classifier prompt, so the provider's error
 * text is flattened and capped before it goes in: a GitHub client can put a
 * whole response body (which can echo request content back) into `.message`.
 */
function errorNote(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_ERROR_CHARS ? `${flat.slice(0, MAX_ERROR_CHARS)}…` : flat;
}

/**
 * Driven adapter for linked-issue bodies. Best-effort by construction: a token
 * we do not have, a 404, or a rate limit becomes a `missing` note, never a
 * thrown error and never a silent omission — the classifier is told the ticket
 * was unavailable so it does not describe one it never saw.
 */
export class GitHubIssueReader implements IssuePort {
  constructor(private gh: () => Promise<GitHubClient>) {}

  async fetch(
    repo: { owner: string; name: string },
    numbers: number[],
  ): Promise<{ found: IntentDoc[]; missing: string[] }> {
    if (numbers.length === 0) return { found: [], missing: [] };

    let client: GitHubClient;
    try {
      client = await this.gh();
    } catch (err) {
      const note = errorNote(err);
      return {
        found: [],
        missing: numbers.map((n) => `issue #${n} could not be fetched: ${note}`),
      };
    }

    const found: IntentDoc[] = [];
    const missing: string[] = [];
    for (const n of numbers.slice(0, MAX_ISSUES)) {
      try {
        const issue = await client.getIssue({ owner: repo.owner, name: repo.name }, n);
        const body = [issue.title, issue.body ?? ''].filter(Boolean).join('\n\n');
        found.push({ label: `issue#${n}`, content: body.slice(0, MAX_ISSUE_BYTES) });
      } catch (err) {
        missing.push(`issue #${n} could not be fetched: ${errorNote(err)}`);
      }
    }
    for (const n of numbers.slice(MAX_ISSUES)) {
      missing.push(`issue #${n} was not fetched: only ${MAX_ISSUES} linked issues are read per PR`);
    }
    return { found, missing };
  }
}
