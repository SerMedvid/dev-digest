import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { scopeFindings } from '../src/scope.js';

function f(over: Partial<Finding>): Finding {
  return {
    id: 'x',
    severity: 'SUGGESTION',
    category: 'style',
    title: 't',
    file: 'a.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'r',
    confidence: 0.5,
    ...over,
  } as Finding;
}

describe('scopeFindings', () => {
  it('drops only out-of-scope SUGGESTION-level style/perf/test noise', () => {
    const noise = f({ id: 'noise', out_of_scope: true, severity: 'SUGGESTION', category: 'style' });
    const res = scopeFindings([noise], true);
    expect(res.kept).toHaveLength(0);
    expect(res.dropped[0]!.reason).toContain('out of scope');
  });

  it('never drops a defect, whatever the model marked', () => {
    const survivors: Finding[] = [
      f({ id: 'crit', out_of_scope: true, severity: 'CRITICAL', category: 'security' }),
      f({ id: 'warn', out_of_scope: true, severity: 'WARNING', category: 'style' }),
      f({ id: 'bug', out_of_scope: true, severity: 'SUGGESTION', category: 'bug' }),
      f({ id: 'sec', out_of_scope: true, severity: 'SUGGESTION', category: 'security' }),
      f({ id: 'secret', out_of_scope: true, severity: 'SUGGESTION', category: 'style', kind: 'secret_leak' }),
      f({ id: 'trifecta', out_of_scope: true, severity: 'SUGGESTION', category: 'style', kind: 'lethal_trifecta' }),
      f({ id: 'phantom', out_of_scope: true, severity: 'SUGGESTION', category: 'style', kind: 'phantom' }),
      f({ id: 'hook', out_of_scope: true, severity: 'SUGGESTION', category: 'style', kind: 'hook' }),
    ];
    const res = scopeFindings(survivors, true);
    expect(res.kept.map((k) => k.id).sort()).toEqual(
      ['bug', 'crit', 'hook', 'phantom', 'secret', 'sec', 'trifecta', 'warn'].sort(),
    );
    expect(res.dropped).toHaveLength(0);
  });

  it('is a no-op when no intent was in the prompt', () => {
    const noise = f({ id: 'noise', out_of_scope: true });
    expect(scopeFindings([noise], false).kept).toHaveLength(1);
  });

  it('keeps in-scope and unmarked findings untouched', () => {
    const kept = [f({ id: 'a' }), f({ id: 'b', out_of_scope: false })];
    expect(scopeFindings(kept, true).kept).toHaveLength(2);
  });
});
