import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HttpApiClient } from './api.js';
import { loadConfig } from './config.js';
import { ALL_TOOLS, type ToolDeps } from './tools/index.js';

/**
 * stdio transport uses STDOUT for JSON-RPC framing. Anything written there
 * that is not a protocol message corrupts the stream, so every diagnostic in
 * this package goes to stderr.
 */
function log(message: string): void {
  console.error(`[devdigest-mcp] ${message}`);
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const deps: ToolDeps = {
    api: new HttpApiClient(config.apiUrl),
    waitSeconds: config.waitSeconds,
    pollIntervalMs: config.pollIntervalMs,
  };

  const server = new McpServer({ name: 'devdigest', version: '0.0.0' });

  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      // The SDK validates args against inputSchema before we are called.
      async (args: Record<string, unknown>) => tool.handler(args ?? {}, deps),
    );
  }

  await server.connect(new StdioServerTransport());
  log(`ready — ${ALL_TOOLS.length} tools, API ${config.apiUrl}`);
}

main().catch((err: unknown) => {
  log(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
