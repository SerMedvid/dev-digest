#!/usr/bin/env node
/**
 * CLI entrypoint. `mcp/` emits no JS — the MCP server runs under tsx too — so
 * this shim registers tsx's ESM loader and then imports the TypeScript entry.
 * The package manager's own bin shim makes it executable on every OS, so there
 * is no shebang-vs-Windows problem to solve here.
 */
import { register } from 'tsx/esm/api';

register();
await import('../src/cli/main.ts');
