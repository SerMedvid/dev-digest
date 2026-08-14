import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  IntentConfidence,
  PrIntentRecord,
  PrFileSummaryRecord,
  BlastRadius,
  Brief,
  PrBriefRecord,
  SmartDiff,
  Conformance,
  ONBOARDING_SECTION_IDS,
  OnboardingView,
  EvalRun,
  MemoryItem,
  RunTrace,
  Settings,
  Repo,
  PrMeta,
  PrDetail,
  PrFindingPreview,
  SkillVersion,
  SkillStats,
  SkillWithUsage,
  FeatureModelId,
  FEATURE_MODELS,
  BlastStatus,
  BlastRadiusResponse,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Brief / PrBriefRecord', () => {
    expect(() =>
      Intent.parse({ intent: 'x', in_scope: ['a'], out_of_scope: ['b'] }),
    ).not.toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    // The composed brief (L05). `Risks`/`PrHistory` used to be asserted here;
    // they were replaced rather than extended — see contracts/brief.ts.
    const brief = {
      what: 'Adds rate limiting to the public API.',
      why: 'Unauthenticated clients can hammer the public endpoints.',
      risk_level: 'high' as const,
      risks: [
        {
          title: 'Committed secret',
          explanation: 'A live key is in the diff.',
          severity: 'high' as const,
          refs: ['src/config.ts'],
        },
      ],
      review_focus: [{ file: 'src/config.ts', line: 12, reason: 'The secret.' }],
    };
    expect(() => Brief.parse(brief)).not.toThrow();
    // `line` is NULLABLE, not optional: a focus item whose line no finding
    // vouched for keeps the key and carries null, so the client can tell
    // "no line" from "field missing".
    expect(() =>
      Brief.parse({ ...brief, review_focus: [{ file: 'src/config.ts', line: null, reason: 'r' }] }),
    ).not.toThrow();
    expect(() => Brief.parse({ ...brief, risk_level: 'severe' })).toThrow();
    expect(() =>
      PrBriefRecord.parse({
        ...brief,
        pr_id: 'pr1',
        head_sha: 'a1b2c3',
        review_id: null,
        stale: false,
        sources: ['pr', 'files'],
        est_tokens_in: 1200,
        provider: 'openai',
        model: 'gpt-4.1',
        created_at: '2026-08-14T00:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('PrIntentRecord carries evidence and a computed confidence', () => {
    const rec = PrIntentRecord.parse({
      intent: 'Add rate limiting to public API endpoints',
      in_scope: ['Add middleware for rate limiting'],
      out_of_scope: ['Authentication changes'],
      pr_id: 'p1',
      head_sha: 'a1b2c3d4',
      confidence: 'medium',
      sources: ['title', 'description', 'hunk_headers'],
      missing_context: ['issue #7 could not be fetched: 404'],
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash-lite',
      created_at: '2026-08-05T00:00:00Z',
    });
    expect(rec.confidence).toBe('medium');
    expect(rec.sources).toHaveLength(3);
    // The MODEL's schema stays at three fields — confidence is not askable.
    expect(Object.keys(Intent.shape).sort()).toEqual(['in_scope', 'intent', 'out_of_scope']);
    expect(IntentConfidence.options).toEqual(['high', 'medium', 'low']);
  });

  it('Finding carries an optional out_of_scope marker', () => {
    const base = {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded key',
      file: 'src/config.ts',
      start_line: 12,
      end_line: 12,
      rationale: 'x',
      confidence: 0.9,
    };
    expect(Finding.parse(base).out_of_scope ?? false).toBe(false);
    expect(Finding.parse({ ...base, out_of_scope: true }).out_of_scope).toBe(true);
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [{ path: 'a.ts', additions: 84, deletions: 0, finding_lines: [28, 52] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
  });

  it('SmartDiff carries finding_marks and round-trips them', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [
            {
              path: 'a.ts',
              additions: 84,
              deletions: 0,
              finding_lines: [28],
              finding_marks: [{ line: 28, severity: 'WARNING', finding_id: 'f1' }],
            },
          ],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.files[0]!.finding_marks).toEqual([
      { line: 28, severity: 'WARNING', finding_id: 'f1' },
    ]);
  });

  it('PrFileSummaryRecord parses a full record and rejects a missing summary', () => {
    const rec = PrFileSummaryRecord.parse({
      pr_id: 'p1',
      path: 'src/api/public/webhooks.ts',
      head_sha: 'a1b2c3d4',
      summary: 'Adds a signature check before dispatching the webhook payload.',
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash-lite',
      created_at: '2026-08-05T00:00:00Z',
    });
    expect(rec.summary).toContain('signature check');

    expect(() =>
      PrFileSummaryRecord.parse({
        pr_id: 'p1',
        path: 'src/api/public/webhooks.ts',
        head_sha: 'a1b2c3d4',
        provider: 'openrouter',
        model: 'google/gemini-2.5-flash-lite',
        created_at: '2026-08-05T00:00:00Z',
      }),
    ).toThrow();
  });

  it('FeatureModelId accepts file_summary', () => {
    expect(FeatureModelId.parse('file_summary')).toBe('file_summary');
  });

  it('BlastRadiusResponse round-trips a full map', () => {
    const sample = {
      status: 'partial' as const,
      reason: 'index_stale',
      head_sha: 'a1b2c3d4e5f6',
      changed_symbols: [
        {
          name: 'rateLimit',
          kind: 'function',
          file: 'src/middleware/ratelimit.ts',
          line: 12,
          callers: [
            { file: 'src/api/public/index.ts', line: 23, symbol: 'publicRouter', rank: 0.92 },
          ],
          endpoints: ['GET /api/public/items'],
          crons: [],
        },
        // A symbol the index knows about but whose declaration line is missing.
        {
          name: 'bucketKey',
          kind: 'function',
          file: 'src/middleware/ratelimit.ts',
          line: null,
          callers: [],
          endpoints: [],
          crons: [],
        },
      ],
      endpoints: ['GET /api/public/items', 'POST /api/public/webhooks'],
      crons: ['job:reset-rate-buckets'],
      summary: null,
    };
    const parsed = BlastRadiusResponse.parse(sample);
    expect(parsed).toEqual(sample);
    expect(parsed.changed_symbols[0]!.callers[0]!.rank).toBe(0.92);
    expect(parsed.changed_symbols[1]!.line).toBeNull();
  });

  it('BlastRadiusResponse accepts a true-empty ok map', () => {
    const ok = BlastRadiusResponse.parse({
      status: 'ok',
      reason: null,
      head_sha: 'deadbeef',
      changed_symbols: [],
      endpoints: [],
      crons: [],
      summary: null,
    });
    expect(ok.status).toBe('ok');
    expect(ok.reason).toBeNull();
    expect(BlastStatus.options).toEqual(['ok', 'partial', 'degraded']);
    // `reason` is nullable, never optional — an absent key is a producer bug.
    expect(() =>
      BlastRadiusResponse.parse({
        status: 'ok',
        head_sha: 'deadbeef',
        changed_symbols: [],
        endpoints: [],
        crons: [],
        summary: null,
      }),
    ).toThrow();
  });

  it('FeatureModelId accepts blast_summary and the registry carries its default', () => {
    expect(FeatureModelId.parse('blast_summary')).toBe('blast_summary');
    const entry = FEATURE_MODELS.find((f) => f.id === 'blast_summary');
    expect(entry).toBeDefined();
    expect(entry!.defaultProvider).toBe('openrouter');
    expect(entry!.defaultModel).toBe('google/gemini-2.5-flash-lite');
  });

  it('Conformance / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, cost_usd: 0.06, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });

  it('PrMeta findings counters: present, null, and absent all parse', () => {
    const base = {
      number: 482,
      title: 't',
      author: 'a',
      branch: 'b',
      base: 'main',
      head_sha: 'sha',
      additions: 1,
      deletions: 0,
      files_count: 1,
      status: 'open' as const,
    };
    const preview = {
      id: 'f1',
      severity: 'CRITICAL' as const,
      category: 'security',
      title: 'Hardcoded key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      confidence: 0.95,
      rationale_snippet: 'A live Stripe key is committed in source.',
    };

    const populated = PrMeta.parse({
      ...base,
      findings_by_severity: { CRITICAL: 1, WARNING: 2, SUGGESTION: 0 },
      findings_preview: [preview],
    });
    expect(populated.findings_by_severity?.WARNING).toBe(2);
    expect(populated.findings_preview).toHaveLength(1);

    // Zero findings / failed roll-up → explicit nulls.
    expect(() =>
      PrMeta.parse({ ...base, findings_by_severity: null, findings_preview: null }),
    ).not.toThrow();
    // Every other endpoint omits them entirely (list-endpoint-only fields).
    expect(PrMeta.parse(base).findings_by_severity).toBeUndefined();

    expect(PrFindingPreview.parse(preview).start_line).toBe(11);
    // Category is a free string (plain text column), severity is not.
    expect(() => PrFindingPreview.parse({ ...preview, category: 'whatever' })).not.toThrow();
    expect(() => PrFindingPreview.parse({ ...preview, severity: 'NOPE' })).toThrow();
  });
});

describe('onboarding contract', () => {
  it('fixes the five section ids in order', () => {
    expect(ONBOARDING_SECTION_IDS).toEqual([
      'architecture',
      'critical_paths',
      'run_locally',
      'reading_path',
      'first_tasks',
    ]);
  });

  it("defaults a section's collections so a sparse section still parses", () => {
    const view = OnboardingView.parse({
      status: 'ready',
      sections: [{ id: 'architecture', title: 'Architecture overview', body: 'x' }],
      generatedAt: '2026-08-14T00:00:00.000Z',
      stale: false,
      indexedFiles: 42,
      error: null,
      reason: null,
    });
    expect(view.sections[0]).toMatchObject({
      diagram: null,
      files: [],
      commands: [],
      tasks: [],
    });
  });

  it('rejects an unknown section id', () => {
    const bad = OnboardingView.safeParse({
      status: 'ready',
      sections: [{ id: 'glossary', title: 'x', body: '' }],
      generatedAt: null,
      stale: false,
      indexedFiles: 0,
      error: null,
      reason: null,
    });
    expect(bad.success).toBe(false);
  });
});

describe('Skill contracts', () => {
  it('SkillWithUsage carries the link count', () => {
    const row = SkillWithUsage.parse({
      id: 's1',
      name: 'pr-quality-rubric',
      description: 'Rubric for overall PR quality',
      type: 'rubric',
      source: 'manual',
      body: '# PR Quality Rubric',
      enabled: true,
      version: 5,
      agent_count: 3,
    });
    expect(row.agent_count).toBe(3);
  });

  it('SkillVersion allows a null summary', () => {
    const v = SkillVersion.parse({
      skill_id: 's1',
      version: 1,
      summary: null,
      body: '# initial',
      created_at: '2026-08-02T10:00:00.000Z',
    });
    expect(v.summary).toBeNull();
  });

  it('SkillStats defaults to an empty agent list', () => {
    const stats = SkillStats.parse({ agent_count: 0, agents: [] });
    expect(stats.agents).toEqual([]);
  });
});
