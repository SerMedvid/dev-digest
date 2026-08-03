import { describe, it, expect } from 'vitest';
import {
  ConventionCandidate,
  ConventionScan,
  ConventionsView,
} from '@devdigest/shared';

describe('convention contracts', () => {
  const candidate = {
    id: '11111111-1111-1111-1111-111111111111',
    category: 'error-handling',
    rule: 'Always wrap route handlers in asyncHandler',
    evidence_path: 'src/api/users.ts',
    evidence_line: 23,
    evidence_snippet: 'export const handler = asyncHandler(async (req) => {',
    confidence: 0.91,
    status: 'pending',
  };

  it('accepts a well-formed candidate', () => {
    expect(ConventionCandidate.parse(candidate)).toMatchObject({ evidence_line: 23 });
  });

  it('rejects a category outside the closed enum', () => {
    const bad = { ...candidate, category: 'vibes' };
    expect(ConventionCandidate.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-positive evidence line', () => {
    const bad = { ...candidate, evidence_line: 0 };
    expect(ConventionCandidate.safeParse(bad).success).toBe(false);
  });

  it('rejects the retired `accepted` boolean in place of `status`', () => {
    const { status, ...rest } = candidate;
    expect(ConventionCandidate.safeParse({ ...rest, accepted: true }).success).toBe(false);
  });

  it('parses a scan with drop counters and a never-scanned view', () => {
    const scan = ConventionScan.parse({
      status: 'done',
      pool_count: 40,
      sample_count: 14,
      candidate_count: 3,
      dropped: { snippet_not_found: 4, duplicate: 1 },
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      error: null,
      started_at: '2026-08-03T10:00:00.000Z',
      finished_at: '2026-08-03T10:00:31.000Z',
    });
    expect(scan.dropped.snippet_not_found).toBe(4);
    expect(ConventionsView.parse({ scan: null, candidates: [] }).scan).toBeNull();
  });
});
