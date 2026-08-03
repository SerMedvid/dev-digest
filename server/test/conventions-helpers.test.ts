import { describe, it, expect } from 'vitest';
import {
  normaliseRule,
  slugifyRule,
  numberLines,
  bumpDrop,
  toCandidateDto,
  toScanDto,
} from '../src/modules/conventions/helpers.js';

describe('normaliseRule', () => {
  it('collapses case, punctuation and whitespace so paraphrases collide', () => {
    expect(normaliseRule('Always use async/await instead of .then() chains.')).toBe(
      normaliseRule('always use   async/await instead of .then() chains'),
    );
  });

  it('keeps genuinely different rules apart', () => {
    expect(normaliseRule('Always use async/await')).not.toBe(
      normaliseRule('Never use async/await'),
    );
  });
});

describe('slugifyRule', () => {
  it('makes a short kebab-case heading from a rule', () => {
    expect(slugifyRule('Always use async/await instead of .then() chains')).toBe(
      'always-use-async-await-instead-of-then-chains',
    );
  });

  it('never emits leading, trailing or doubled dashes', () => {
    expect(slugifyRule('  ...Redis access goes through src/lib/redis.ts!  ')).toBe(
      'redis-access-goes-through-src-lib-redis-ts',
    );
  });
});

describe('numberLines', () => {
  it('prefixes each line with its 1-based number', () => {
    expect(numberLines('a\nb\nc', 10)).toBe('1: a\n2: b\n3: c');
  });

  it('truncates to maxLines and says so, so the model cannot cite past the cut', () => {
    const out = numberLines('a\nb\nc\nd', 2);
    expect(out).toBe('1: a\n2: b\n… truncated at line 2 of 4');
  });
});

describe('bumpDrop', () => {
  it('counts per reason without mutating its input', () => {
    const first = bumpDrop({}, 'duplicate');
    const second = bumpDrop(first, 'duplicate');
    expect(first).toEqual({ duplicate: 1 });
    expect(second).toEqual({ duplicate: 2 });
  });
});

describe('dto mapping', () => {
  it('maps a record to the wire shape', () => {
    expect(
      toCandidateDto({
        id: 'c1',
        category: 'naming',
        rule: 'Always suffix repositories with Repository',
        evidencePath: 'src/a.ts',
        evidenceLine: 4,
        evidenceSnippet: 'class UserRepository {',
        confidence: 0.8,
        status: 'accepted',
      }),
    ).toEqual({
      id: 'c1',
      category: 'naming',
      rule: 'Always suffix repositories with Repository',
      evidence_path: 'src/a.ts',
      evidence_line: 4,
      evidence_snippet: 'class UserRepository {',
      confidence: 0.8,
      status: 'accepted',
    });
  });

  it('maps a scan, rendering timestamps as ISO strings', () => {
    const dto = toScanDto({
      status: 'done',
      poolCount: 40,
      sampleCount: 14,
      candidateCount: 2,
      dropped: { duplicate: 1 },
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      error: null,
      startedAt: new Date('2026-08-03T10:00:00.000Z'),
      finishedAt: null,
    });
    expect(dto.started_at).toBe('2026-08-03T10:00:00.000Z');
    expect(dto.finished_at).toBeNull();
    expect(dto.pool_count).toBe(40);
  });
});
