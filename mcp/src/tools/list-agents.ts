import { ToolError, ok, toToolResult } from '../errors.js';
import type { ToolDef } from './index.js';

export const listAgentsTool: ToolDef = {
  name: 'devdigest_list_agents',
  description:
    'List the reviewer agents configured in DevDigest. Call this first when you do not know ' +
    'which reviewer to use, or when a review call reports an unknown agent — the `name` it ' +
    'returns is exactly what devdigest_run_agent_on_pr accepts. Returns one line per agent ' +
    'with its name, what it reviews, whether it is enabled, and the model it runs on.',
  inputSchema: {},
  annotations: {
    title: 'List DevDigest reviewer agents',
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(_args, deps) {
    try {
      const agents = await deps.api.listAgents();
      if (agents.length === 0) {
        throw new ToolError(
          'No reviewer agents are configured in DevDigest.',
          'Create one in the DevDigest studio (Agents → New agent), or run `pnpm --dir server db:seed` to load the four built-in agents.',
        );
      }
      return ok({
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          enabled: a.enabled,
          model: a.model,
        })),
      });
    } catch (err) {
      return toToolResult(err);
    }
  },
};
