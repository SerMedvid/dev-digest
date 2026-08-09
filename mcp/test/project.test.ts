import { describe, it, expect } from 'vitest';
import { projectFindings, projectConventions } from '../src/project.js';
import type { FindingRef, ReviewRef } from '../src/types.js';

function finding(over: Partial<FindingRef> = {}): FindingRef {
  return {
    id: 'f1',
    severity: 'WARNING',
    category: 'bug',
    title: 'Unchecked null',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 10,
    rationale: 'The value can be null here.',
    suggestion: 'Add a guard.',
    confidence: 0.8,
    dismissed_at: null,
    ...over,
  };
}

function review(findings: FindingRef[], over: Partial<ReviewRef> = {}): ReviewRef {
  return {
    id: 'rev1',
    agent_id: 'agent-1',
    run_id: 'run-1',
    agent_name: 'Security Reviewer',
    verdict: 'request_changes',
    summary: 'Two issues.',
    score: 62,
    findings,
    ...over,
  };
}

describe('projectFindings', () => {
  it('keeps only the five concise fields and formats a single-line range', () => {
    const out = projectFindings([review([finding()])], { format: 'concise', limit: 20 });
    expect(out.findings[0]).toEqual({
      severity: 'WARNING',
      category: 'bug',
      title: 'Unchecked null',
      file: 'src/a.ts',
      lines: '10',
    });
  });

  it('formats a multi-line range as start-end and adds detail fields on request', () => {
    const out = projectFindings([review([finding({ start_line: 10, end_line: 24 })])], {
      format: 'detailed',
      limit: 20,
    });
    expect(out.findings[0]).toMatchObject({
      lines: '10-24',
      rationale: 'The value can be null here.',
      suggestion: 'Add a guard.',
      confidence: 0.8,
    });
  });

  it('never leaks internal fields', () => {
    const out = projectFindings([review([finding()])], { format: 'detailed', limit: 20 });
    const keys = Object.keys(out.findings[0]!);
    for (const banned of ['id', 'review_id', 'evidence', 'trifecta_components', 'out_of_scope', 'dismissed_at']) {
      expect(keys).not.toContain(banned);
    }
  });

  it('drops dismissed findings and counts by severity', () => {
    const out = projectFindings(
      [
        review([
          finding({ id: 'a', severity: 'CRITICAL' }),
          finding({ id: 'b', severity: 'SUGGESTION' }),
          finding({ id: 'c', severity: 'CRITICAL', dismissed_at: '2026-08-01T00:00:00Z' }),
        ]),
      ],
      { format: 'concise', limit: 20 },
    );
    expect(out.total).toBe(2);
    expect(out.counts).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 1 });
  });

  it('sorts most severe first', () => {
    const out = projectFindings(
      [
        review([
          finding({ id: 'a', severity: 'SUGGESTION', title: 'low' }),
          finding({ id: 'b', severity: 'CRITICAL', title: 'high' }),
          finding({ id: 'c', severity: 'WARNING', title: 'mid' }),
        ]),
      ],
      { format: 'concise', limit: 20 },
    );
    expect(out.findings.map((f) => f.title)).toEqual(['high', 'mid', 'low']);
  });

  it('truncates with an actionable note instead of silently cutting', () => {
    const many = Array.from({ length: 30 }, (_, i) => finding({ id: `f${i}` }));
    const out = projectFindings([review(many)], { format: 'concise', limit: 5 });
    expect(out.shown).toBe(5);
    expect(out.total).toBe(30);
    expect(out.note).toContain('severity');
  });

  it('filters by severity and by agent name', () => {
    const reviews = [
      review([finding({ id: 'a', severity: 'CRITICAL' })], { agent_name: 'Security Reviewer' }),
      review([finding({ id: 'b', severity: 'CRITICAL' })], { id: 'rev2', agent_name: 'Test Quality' }),
    ];
    expect(projectFindings(reviews, { format: 'concise', limit: 20, severity: 'CRITICAL' }).total).toBe(2);
    expect(
      projectFindings(reviews, { format: 'concise', limit: 20, agentName: 'test quality' }).total,
    ).toBe(1);
  });

  it('reports the worst verdict and the lowest score across agents', () => {
    const out = projectFindings(
      [
        review([], { verdict: 'approve', score: 90 }),
        review([], { id: 'rev2', verdict: 'request_changes', score: 40, agent_name: 'Test Quality' }),
      ],
      { format: 'concise', limit: 20 },
    );
    expect(out.verdict).toBe('request_changes');
    expect(out.score).toBe(40);
    expect(out.agents).toEqual(['Security Reviewer', 'Test Quality']);
  });

  it('reports no_reviews when the PR has never been reviewed', () => {
    const out = projectFindings([], { format: 'concise', limit: 20 });
    expect(out.verdict).toBe('no_reviews');
    expect(out.total).toBe(0);
  });
});

describe('projectConventions', () => {
  const view = {
    scan: { status: 'done' },
    candidates: [
      { id: 'c1', category: 'testing', rule: 'Use vitest', evidence_path: 'a.ts', evidence_line: 1, confidence: 0.9, status: 'accepted' as const },
      { id: 'c2', category: 'imports', rule: 'No default exports', evidence_path: 'b.ts', evidence_line: 2, confidence: 0.7, status: 'pending' as const },
    ],
  };

  it('returns accepted rules only, as category + rule', () => {
    const out = projectConventions(view, { limit: 30, status: 'accepted' });
    expect(out.conventions).toEqual([{ category: 'testing', rule: 'Use vitest' }]);
    expect(out.scan_status).toBe('done');
  });

  it('supports status "all" and a category filter', () => {
    expect(projectConventions(view, { limit: 30, status: 'all' }).total).toBe(2);
    expect(projectConventions(view, { limit: 30, status: 'all', category: 'imports' }).total).toBe(1);
  });

  it('reports never_scanned when no scan exists', () => {
    const out = projectConventions({ scan: null, candidates: [] }, { limit: 30, status: 'accepted' });
    expect(out.scan_status).toBe('never_scanned');
  });

  it('truncates with a note', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`,
      category: 'testing',
      rule: `rule ${i}`,
      evidence_path: 'a.ts',
      evidence_line: 1,
      confidence: 0.9,
      status: 'accepted' as const,
    }));
    const out = projectConventions({ scan: { status: 'done' }, candidates: many }, { limit: 10, status: 'accepted' });
    expect(out.shown).toBe(10);
    expect(out.note).toContain('category');
  });
});
