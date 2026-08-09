import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ALL_TOOLS } from '../src/tools/index.js';
import { listAgentsTool } from '../src/tools/list-agents.js';
import { getFindingsTool } from '../src/tools/get-findings.js';
import { getConventionsTool } from '../src/tools/get-conventions.js';
import { runAgentOnPrTool } from '../src/tools/run-agent-on-pr.js';
import { blastRadiusTool } from '../src/tools/get-blast-radius.js';
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

describe('devdigest_get_findings', () => {
  const reviews = [
    {
      id: 'rev1',
      agent_id: 'agent-1',
      run_id: 'run-1',
      agent_name: 'Security Reviewer',
      verdict: 'request_changes',
      summary: 'One issue.',
      score: 62,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL' as const,
          category: 'security',
          title: 'SQL injection',
          file: 'src/db.ts',
          start_line: 42,
          end_line: 42,
          rationale: 'User input is concatenated.',
          suggestion: 'Parameterise.',
          confidence: 0.95,
          dismissed_at: null,
        },
      ],
    },
  ];

  it('returns a compact verdict for an existing PR', async () => {
    const api = makeFakeApi({ reviews });
    const result = await getFindingsTool.handler(
      { repo: 'acme/payments-api', pr: 482 },
      deps(api),
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      repo: 'acme/payments-api',
      pr: 482,
      verdict: 'request_changes',
      counts: { CRITICAL: 1, WARNING: 0, SUGGESTION: 0 },
      total: 1,
      shown: 1,
    });
    expect(result.structuredContent?.findings).toEqual([
      { severity: 'CRITICAL', category: 'security', title: 'SQL injection', file: 'src/db.ts', lines: '42' },
    ]);
  });

  it('tells the caller to run a review when the PR has none', async () => {
    const result = await getFindingsTool.handler(
      { repo: 'acme/payments-api', pr: 482 },
      deps(makeFakeApi({ reviews: [] })),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('devdigest_run_agent_on_pr');
  });

  it('reports an unknown repo without calling the reviews endpoint', async () => {
    const api = makeFakeApi();
    const result = await getFindingsTool.handler({ repo: 'acme/nope', pr: 1 }, deps(api));
    expect(result.isError).toBe(true);
    expect(api.calls).not.toContain('listReviews:pr-1');
  });

  it('returns just that reviewer when the agent filter matches', async () => {
    const result = await getFindingsTool.handler(
      { repo: 'acme/payments-api', pr: 482, agent: 'security reviewer' },
      deps(makeFakeApi({ reviews })),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ total: 1, agents: ['Security Reviewer'] });
  });

  // Without this guard the filter silently produces {verdict:"no_reviews",
  // total:0} — a successful-looking result the model reads as "never reviewed".
  it('names the actual reviewers when the agent filter matches nothing', async () => {
    const result = await getFindingsTool.handler(
      { repo: 'acme/payments-api', pr: 482, agent: 'Performance Reviewer' },
      deps(makeFakeApi({ reviews })),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Performance Reviewer');
    expect(result.content[0]!.text).toContain('Security Reviewer');
    expect(result.content[0]!.text).toContain('Next:');
  });

  // Seeded/imported reviews carry agent_name: null, so they cannot be filtered
  // by agent at all. Saying "no such reviewer" there would be a lie.
  it('explains that an unattributed review cannot be filtered by agent', async () => {
    const unattributed = [{ ...reviews[0]!, agent_id: null, run_id: null, agent_name: null }];
    const result = await getFindingsTool.handler(
      { repo: 'acme/payments-api', pr: 482, agent: 'Security Reviewer' },
      deps(makeFakeApi({ reviews: unattributed })),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('not attributed');
    expect(result.content[0]!.text).toContain('Next:');
  });

  it('is marked read-only', () => {
    expect(getFindingsTool.annotations.readOnlyHint).toBe(true);
  });
});

describe('devdigest_get_conventions', () => {
  const conventions = {
    scan: { status: 'done' },
    candidates: [
      { id: 'c1', category: 'testing', rule: 'Tests use vitest', evidence_path: 'a.ts', evidence_line: 1, confidence: 0.9, status: 'accepted' as const },
      { id: 'c2', category: 'imports', rule: 'No default exports', evidence_path: 'b.ts', evidence_line: 2, confidence: 0.6, status: 'pending' as const },
    ],
  };

  it('returns accepted conventions by default', async () => {
    const result = await getConventionsTool.handler(
      { repo: 'acme/payments-api' },
      deps(makeFakeApi({ conventions })),
    );
    expect(result.structuredContent).toMatchObject({
      repo: 'acme/payments-api',
      scan_status: 'done',
      conventions: [{ category: 'testing', rule: 'Tests use vitest' }],
      total: 1,
    });
  });

  it('tells the caller to run an extraction when the repo was never scanned', async () => {
    const result = await getConventionsTool.handler(
      { repo: 'acme/payments-api' },
      deps(makeFakeApi({ conventions: { scan: null, candidates: [] } })),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Conventions');
    expect(result.content[0]!.text).toContain('Next:');
  });

  it('explains an accepted-but-empty result rather than returning silence', async () => {
    const result = await getConventionsTool.handler(
      { repo: 'acme/payments-api' },
      deps(
        makeFakeApi({
          conventions: { scan: { status: 'done' }, candidates: [conventions.candidates[1]!] },
        }),
      ),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('pending');
  });

  // The server's ConventionCategory enum (shared/contracts/knowledge.ts) is the
  // contract. Accepting a category the server never emits would silently return
  // "no conventions match" instead of an argument error.
  it('accepts every category the server can emit', async () => {
    const serverCategories = [
      'naming',
      'structure',
      'error-handling',
      'api-shape',
      'testing',
      'imports',
      'typing',
      'tooling',
    ];
    const shape = z.object(getConventionsTool.inputSchema).shape;
    const category = shape.category as z.ZodTypeAny;
    for (const c of serverCategories) {
      expect(category.safeParse(c).success, `category "${c}"`).toBe(true);
    }
  });

  it('is marked read-only', () => {
    expect(getConventionsTool.annotations.readOnlyHint).toBe(true);
  });
});

describe('devdigest_run_agent_on_pr', () => {
  const finishedReview = [
    {
      id: 'rev1',
      agent_id: 'agent-1',
      run_id: 'run-1',
      agent_name: 'Security Reviewer',
      verdict: 'request_changes',
      summary: 'One issue.',
      score: 62,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL' as const,
          category: 'security',
          title: 'SQL injection',
          file: 'src/db.ts',
          start_line: 42,
          end_line: 42,
          rationale: 'User input is concatenated.',
          suggestion: 'Parameterise.',
          confidence: 0.95,
          dismissed_at: null,
        },
      ],
    },
  ];

  const doneRun = {
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'Security Reviewer',
    status: 'done',
    error: null,
    score: 62,
    findings_count: 1,
  };

  it('resolves, starts, waits and returns the findings in one call', async () => {
    const api = makeFakeApi({ runs: [[doneRun]], reviews: finishedReview });
    const result = await runAgentOnPrTool.handler(
      { repo: 'acme/payments-api', pr: 482, agent: 'Security Reviewer' },
      deps(api),
    );

    expect(api.calls).toContain('startReview:pr-1:agent-1');
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      repo: 'acme/payments-api',
      pr: 482,
      agent: 'Security Reviewer',
      status: 'done',
      verdict: 'request_changes',
      total: 1,
    });
  });

  it("returns only the requested agent's findings, not every reviewer's", async () => {
    const api = makeFakeApi({
      runs: [[doneRun]],
      reviews: [
        ...finishedReview,
        { ...finishedReview[0]!, id: 'rev2', run_id: 'run-9', agent_name: 'Test Quality' },
      ],
    });
    const result = await runAgentOnPrTool.handler(
      { repo: 'acme/payments-api', pr: 482, agent: 'Security Reviewer' },
      deps(api),
    );
    expect(result.structuredContent).toMatchObject({ total: 1, agents: ['Security Reviewer'] });
  });

  it('hands back a run_id and a next step when the budget runs out', async () => {
    const api = makeFakeApi({
      runs: [[{ ...doneRun, status: 'running', score: null, findings_count: null }]],
    });
    const result = await runAgentOnPrTool.handler(
      { repo: 'acme/payments-api', pr: 482, agent: 'Security Reviewer', wait_seconds: 1 },
      deps(api),
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ status: 'running', run_id: 'run-1' });
    expect(String(result.structuredContent?.next)).toContain('devdigest_get_findings');
  });

  it('surfaces the run error when the review fails', async () => {
    const api = makeFakeApi({
      runs: [[{ ...doneRun, status: 'failed', error: 'ANTHROPIC_API_KEY is not configured' }]],
    });
    const result = await runAgentOnPrTool.handler(
      { repo: 'acme/payments-api', pr: 482, agent: 'Security Reviewer' },
      deps(api),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('ANTHROPIC_API_KEY');
    expect(result.content[0]!.text).toContain('Next:');
  });

  it('does not start a review when the agent name is wrong', async () => {
    const api = makeFakeApi();
    const result = await runAgentOnPrTool.handler(
      { repo: 'acme/payments-api', pr: 482, agent: 'Secrity' },
      deps(api),
    );
    expect(result.isError).toBe(true);
    expect(api.calls.some((c) => c.startsWith('startReview'))).toBe(false);
    expect(result.content[0]!.text).toContain('devdigest_list_agents');
  });

  it('is the only tool that is not read-only', () => {
    expect(runAgentOnPrTool.annotations.readOnlyHint).toBe(false);
    expect(runAgentOnPrTool.annotations.idempotentHint).toBe(false);
  });
});

describe('devdigest_get_blast_radius', () => {
  it('reports that it is not implemented and points at what is', async () => {
    const result = await blastRadiusTool.handler(
      { repo: 'acme/payments-api', pr: 482 },
      deps(),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('not implemented');
    expect(result.content[0]!.text).toContain('devdigest_get_findings');
  });

  it('says so in its description too, so the model does not waste a call', () => {
    expect(blastRadiusTool.description.toLowerCase()).toContain('not implemented');
  });

  it('never touches the API', async () => {
    const api = makeFakeApi();
    await blastRadiusTool.handler({ repo: 'acme/payments-api', pr: 482 }, deps(api));
    expect(api.calls).toEqual([]);
  });
});
