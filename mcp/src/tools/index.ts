import type { z } from 'zod';
import type { ApiClient } from '../api.js';
import type { ToolResult } from '../errors.js';
import { getConventionsTool } from './get-conventions.js';
import { getFindingsTool } from './get-findings.js';
import { listAgentsTool } from './list-agents.js';

export interface ToolDeps {
  api: ApiClient;
  waitSeconds: number;
  pollIntervalMs: number;
}

export interface ToolAnnotations {
  title: string;
  readOnlyHint?: boolean;
  idempotentHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * A tool as this package models it. `handler` takes plain args and deps, so
 * every tool is testable without constructing an MCP server.
 */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  annotations: ToolAnnotations;
  handler(args: Record<string, unknown>, deps: ToolDeps): Promise<ToolResult>;
}

export const ALL_TOOLS: ToolDef[] = [listAgentsTool, getFindingsTool, getConventionsTool];
