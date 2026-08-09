import { ApiHttpError, ApiUnavailableError } from './api.js';

/**
 * What a tool handler hands back. Deliberately a local shape rather than the
 * SDK's CallToolResult so handlers stay testable without importing the SDK.
 *
 * A `type` alias, not an `interface`, on purpose: the SDK's CallToolResult
 * carries an index signature (`[x: string]: unknown`), and TypeScript only
 * grants implicit index signatures to type aliases. As an interface this is
 * structurally identical but rejected at the registerTool() call site.
 */
export type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/**
 * A business failure. Always carries `next` — the concrete action that gets
 * the caller unstuck. A message without a next step is a dead end for the
 * model and is not allowed here.
 */
export class ToolError extends Error {
  override readonly name = 'ToolError';
  constructor(
    message: string,
    readonly next: string,
  ) {
    super(message);
  }
}

export function ok(data: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

export function fail(message: string, next: string): ToolResult {
  return {
    content: [{ type: 'text', text: `${message}\n\nNext: ${next}` }],
    isError: true,
  };
}

/**
 * Map any thrown value to an `isError: true` result. Business failures never
 * become JSON-RPC protocol errors — the model must be able to read the reason
 * and act on it.
 */
export function toToolResult(err: unknown): ToolResult {
  if (err instanceof ToolError) return fail(err.message, err.next);

  if (err instanceof ApiUnavailableError) {
    return fail(
      `The DevDigest API is not reachable at ${err.apiUrl}.`,
      'Start it with `pnpm --dir server dev`, then retry. If it runs on another port, set DEVDIGEST_API_URL.',
    );
  }

  if (err instanceof ApiHttpError) {
    if (err.status === 404) {
      return fail(
        `The DevDigest API returned "not found": ${err.message}`,
        'Confirm the repo and PR exist with devdigest_list_agents and the DevDigest studio, then retry.',
      );
    }
    return fail(
      `The DevDigest API failed (${err.status} ${err.code}): ${err.message}`,
      'Retry once. If it persists, check the API logs in the terminal running `pnpm --dir server dev`.',
    );
  }

  const message = err instanceof Error ? err.message : String(err);
  return fail(
    `Unexpected failure: ${message}`,
    'Retry once. If it persists, check the terminal running the DevDigest MCP server for details.',
  );
}
