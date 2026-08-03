import { describe, it, expect } from 'vitest';
import {
  buildSkillBody,
  buildSkillDescription,
  buildSkillName,
} from '../src/modules/conventions/skill-body.js';
import type { ConventionRecord } from '../src/modules/conventions/domain.js';

function record(over: Partial<ConventionRecord> = {}): ConventionRecord {
  return {
    id: 'c1',
    category: 'error-handling',
    rule: 'Always use async/await instead of .then() chains',
    evidencePath: 'src/api/users.ts',
    evidenceLine: 23,
    evidenceSnippet: 'const user = await db.users.find(id);',
    confidence: 0.91,
    status: 'accepted',
    ...over,
  };
}

describe('buildSkillName / buildSkillDescription', () => {
  it('names the skill after the repo', () => {
    expect(buildSkillName('payments-api')).toBe('payments-api-conventions');
  });

  it('counts the rules in the description', () => {
    expect(buildSkillDescription(3, 'payments-api')).toBe(
      '3 house conventions extracted from payments-api',
    );
  });

  it('uses the singular for one rule', () => {
    expect(buildSkillDescription(1, 'payments-api')).toBe(
      '1 house convention extracted from payments-api',
    );
  });
});

describe('buildSkillBody', () => {
  it('opens with a directive preamble naming the repo', () => {
    const body = buildSkillBody({ repoName: 'payments-api', candidates: [record()] });
    expect(body.startsWith('# payments-api-conventions\n')).toBe(true);
    expect(body).toContain('House conventions for `payments-api`');
    expect(body).toContain('cite the offending `file:line`');
  });

  it('gives each rule a slug heading, the rule, and fenced evidence', () => {
    const body = buildSkillBody({ repoName: 'payments-api', candidates: [record()] });
    expect(body).toContain('## always-use-async-await-instead-of-then-chains');
    expect(body).toContain('Always use async/await instead of .then() chains.');
    expect(body).toContain('Detected in `src/api/users.ts:23`:');
    expect(body).toContain('```\nconst user = await db.users.find(id);\n```');
  });

  it('does not double the full stop on a rule that already ends in one', () => {
    const body = buildSkillBody({
      repoName: 'r',
      candidates: [record({ rule: 'Always await db calls.' })],
    });
    expect(body).toContain('Always await db calls.');
    expect(body).not.toContain('Always await db calls..');
  });

  it('truncates evidence to ten lines — a citation, not a file dump', () => {
    const snippet = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n');
    const body = buildSkillBody({
      repoName: 'r',
      candidates: [record({ evidenceSnippet: snippet })],
    });
    expect(body).toContain('line9');
    expect(body).not.toContain('line10');
  });

  it('orders sections by category so related rules sit together', () => {
    const body = buildSkillBody({
      repoName: 'r',
      candidates: [
        record({ id: 'a', category: 'testing', rule: 'Always name tests should X' }),
        record({ id: 'b', category: 'naming', rule: 'Always suffix repos with Repository' }),
      ],
    });
    expect(body.indexOf('always-suffix-repos')).toBeLessThan(body.indexOf('always-name-tests'));
  });
});
