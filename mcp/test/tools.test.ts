import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ALL_TOOLS } from '../src/tools/index.js';
import { listAgentsTool } from '../src/tools/list-agents.js';
import { makeFakeApi } from './helpers/fake-api.js';
import type { ToolDeps } from '../src/tools/index.js';

function deps(api = makeFakeApi()): ToolDeps {
  return { api, waitSeconds: 1, pollIntervalMs: 1 };
}

describe('tool registry', () => {
  it('namespaces every tool name with devdigest_', () => {
    for (const tool of ALL_TOOLS) expect(tool.name.startsWith('devdigest_')).toBe(true);
  });

  it('keeps every tool at six arguments or fewer, all flat scalars', () => {
    for (const tool of ALL_TOOLS) {
      const shape = z.object(tool.inputSchema).shape;
      const keys = Object.keys(shape);
      expect(keys.length, `${tool.name} argument count`).toBeLessThanOrEqual(6);
    }
  });

  it('gives every tool a non-trivial description', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.description.length, `${tool.name} description`).toBeGreaterThan(80);
    }
  });
});

describe('devdigest_list_agents', () => {
  it('returns the configured agents with the id the other tools accept', async () => {
    const result = await listAgentsTool.handler({}, deps());
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      agents: [
        {
          id: 'agent-1',
          name: 'Security Reviewer',
          description: 'Finds security defects',
          enabled: true,
          model: 'anthropic/claude-opus-5',
        },
      ],
    });
  });

  it('is marked read-only', () => {
    expect(listAgentsTool.annotations.readOnlyHint).toBe(true);
  });

  it('explains how to add an agent when none exist', async () => {
    const result = await listAgentsTool.handler({}, deps(makeFakeApi({ agents: [] })));
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Next:');
  });
});
