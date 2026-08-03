import { describe, it, expect } from 'vitest';
import { verifyCandidates } from '../src/modules/conventions/verify.js';
import type { RawCandidate } from '../src/modules/conventions/domain.js';

const FILE = [
  'import { db } from "./db";', // 1
  '', // 2
  'export async function getUser(id) {', // 3
  '  const user = await db.users.find(id);', // 4
  '  return user;', // 5
  '}', // 6
];

function shown(extra: Record<string, string[]> = {}) {
  return new Map(Object.entries({ 'src/a.ts': FILE, ...extra }));
}

function candidate(over: Partial<RawCandidate> = {}): RawCandidate {
  return {
    category: 'error-handling',
    rule: 'Always await db calls',
    evidencePath: 'src/a.ts',
    evidenceLine: 4,
    evidenceSnippet: '  const user = await db.users.find(id);',
    confidence: 0.9,
    ...over,
  };
}

describe('verifyCandidates', () => {
  it('keeps a candidate whose snippet is exactly where it says', () => {
    const out = verifyCandidates({ candidates: [candidate()], shown: shown() });
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]!.evidenceLine).toBe(4);
    expect(out.dropped).toEqual({});
  });

  it('drops a path the model was never shown', () => {
    const out = verifyCandidates({
      candidates: [candidate({ evidencePath: 'src/invented.ts' })],
      shown: shown(),
    });
    expect(out.kept).toHaveLength(0);
    expect(out.dropped.unknown_path).toBe(1);
  });

  it('drops a line past the end of the file', () => {
    const out = verifyCandidates({
      candidates: [candidate({ evidenceLine: 99 })],
      shown: shown(),
    });
    expect(out.dropped.line_out_of_range).toBe(1);
  });

  it('repairs a line that is off by a few instead of discarding the rule', () => {
    const out = verifyCandidates({
      candidates: [candidate({ evidenceLine: 6 })],
      shown: shown(),
    });
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]!.evidenceLine).toBe(4);
  });

  it('ignores whitespace differences when matching the snippet', () => {
    const out = verifyCandidates({
      candidates: [candidate({ evidenceSnippet: 'const user   = await db.users.find(id);' })],
      shown: shown(),
    });
    expect(out.kept).toHaveLength(1);
  });

  it('drops a snippet that is not in the window at all', () => {
    const out = verifyCandidates({
      candidates: [candidate({ evidenceSnippet: 'throw new Unreachable();' })],
      shown: shown(),
    });
    expect(out.dropped.snippet_not_found).toBe(1);
  });

  it('drops a snippet that exists but outside the ±10 window', () => {
    const long = ['const marker = 1;', ...Array.from({ length: 40 }, () => 'filler();')];
    const out = verifyCandidates({
      candidates: [
        candidate({
          evidencePath: 'src/long.ts',
          evidenceLine: 30,
          evidenceSnippet: 'const marker = 1;',
        }),
      ],
      shown: shown({ 'src/long.ts': long }),
    });
    expect(out.dropped.snippet_not_found).toBe(1);
  });

  it('drops a low-confidence candidate', () => {
    const out = verifyCandidates({
      candidates: [candidate({ confidence: 0.49 })],
      shown: shown(),
    });
    expect(out.dropped.low_confidence).toBe(1);
  });

  it('collapses paraphrases of one rule, keeping the most confident', () => {
    const out = verifyCandidates({
      candidates: [
        candidate({ rule: 'Always await db calls.', confidence: 0.6 }),
        candidate({ rule: 'always   await DB calls', confidence: 0.95 }),
      ],
      shown: shown(),
    });
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]!.confidence).toBe(0.95);
    expect(out.dropped.duplicate).toBe(1);
  });

  it('caps a category at three, dropping the least confident', () => {
    const candidates = [0.9, 0.8, 0.7, 0.6].map((confidence, i) =>
      candidate({ rule: `Always await db calls number ${i}`, confidence }),
    );
    const out = verifyCandidates({ candidates, shown: shown() });
    expect(out.kept).toHaveLength(3);
    expect(out.kept.map((c) => c.confidence)).toEqual([0.9, 0.8, 0.7]);
    expect(out.dropped.over_quota).toBe(1);
  });

  it('caps the whole set at fifteen across categories', () => {
    const cats = ['naming', 'structure', 'testing', 'imports', 'typing', 'tooling'] as const;
    const candidates = cats.flatMap((category, c) =>
      [0.9, 0.8, 0.7].map((confidence, i) =>
        candidate({ category, rule: `Rule ${c}-${i}`, confidence }),
      ),
    );
    const out = verifyCandidates({ candidates, shown: shown() });
    expect(candidates).toHaveLength(18);
    expect(out.kept).toHaveLength(15);
    expect(out.dropped.over_quota).toBe(3);
  });
});
