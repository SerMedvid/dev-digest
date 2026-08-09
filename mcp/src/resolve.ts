import type { ApiClient } from './api.js';
import { ToolError } from './errors.js';
import type { AgentRef, RepoRef } from './types.js';

/** Cap the "available options" hints so an error never becomes a data dump. */
const HINT_LIMIT = 10;

function hint(values: string[]): string {
  const shown = values.slice(0, HINT_LIMIT).join(', ');
  return values.length > HINT_LIMIT ? `${shown}, … (${values.length} total)` : shown;
}

export async function resolveRepo(api: ApiClient, slug: string): Promise<RepoRef> {
  const repos = await api.listRepos();
  if (repos.length === 0) {
    throw new ToolError(
      'No repositories are imported into DevDigest.',
      'Import a repository in the DevDigest studio (Repos → Add repo), then retry.',
    );
  }
  const wanted = slug.trim().toLowerCase();
  const found = repos.find((r) => r.full_name.toLowerCase() === wanted);
  if (!found) {
    throw new ToolError(
      `Repository "${slug}" is not imported into DevDigest.`,
      `Use one of these exact slugs: ${hint(repos.map((r) => r.full_name))}. The format is owner/name.`,
    );
  }
  return found;
}

export async function resolvePull(
  api: ApiClient,
  repo: RepoRef,
  number: number,
): Promise<{ id: string; number: number; title: string }> {
  const pulls = await api.listPulls(repo.id);
  const found = pulls.find((p) => p.number === number);
  if (!found) {
    const numbers = pulls.map((p) => `#${p.number}`);
    throw new ToolError(
      `Pull request #${number} was not found in ${repo.full_name}.`,
      numbers.length > 0
        ? `Available pull requests: ${hint(numbers)}.`
        : `That repository has no pull requests in DevDigest. Open it in the studio to sync them, then retry.`,
    );
  }
  // `PrMeta.id` is nullish in the contract, not merely nullable: a PR listed
  // from GitHub but never persisted locally can arrive with the key absent.
  if (found.id == null) {
    throw new ToolError(
      `Pull request #${number} in ${repo.full_name} is not imported yet.`,
      'Open the pull request once in the DevDigest studio (Repos → the repo → Pull Requests) to import it, then retry.',
    );
  }
  return { id: found.id, number: found.number, title: found.title };
}

export async function resolveAgent(api: ApiClient, ref: string): Promise<AgentRef> {
  const agents = await api.listAgents();
  const wanted = ref.trim().toLowerCase();
  const found =
    agents.find((a) => a.name.toLowerCase() === wanted) ?? agents.find((a) => a.id === ref.trim());
  if (!found) {
    throw new ToolError(
      `Reviewer agent "${ref}" was not found.`,
      `Call devdigest_list_agents and use an exact name. Configured agents: ${hint(agents.map((a) => a.name))}.`,
    );
  }
  if (!found.enabled) {
    throw new ToolError(
      `Reviewer agent "${found.name}" is disabled, so it cannot run.`,
      'Enable it in the DevDigest studio (Agents → the agent → Enabled), or pick an enabled agent from devdigest_list_agents.',
    );
  }
  return found;
}
