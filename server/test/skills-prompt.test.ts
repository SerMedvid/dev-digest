import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '@devdigest/reviewer-core';
import { enabledSkillBodies } from '../src/modules/reviews/helpers.js';

/**
 * The skills → prompt contract. `enabledSkillBodies` is the pure selector the
 * run executor feeds to reviewer-core; the assembly assertions pin the section
 * it produces so a future prompt edit cannot silently drop user rules.
 */

const link = (id: string, body: string, enabled: boolean, order: number) => ({
  order,
  skill: {
    id,
    workspaceId: 'ws',
    name: id,
    description: '',
    type: 'rubric' as const,
    source: 'manual' as const,
    body,
    enabled,
    version: 1,
    evidenceFiles: null,
    createdAt: new Date(),
  },
});

describe('enabledSkillBodies', () => {
  it('keeps link order and drops globally disabled skills', () => {
    const bodies = enabledSkillBodies([
      link('first', '# First', true, 0),
      link('off', '# Off', false, 1),
      link('second', '# Second', true, 2),
    ]);
    expect(bodies).toEqual(['# First', '# Second']);
  });

  it('returns an empty array when nothing is linked', () => {
    expect(enabledSkillBodies([])).toEqual([]);
  });
});

describe('assembled prompt', () => {
  it('renders the bodies into a Skills / rules section in order', () => {
    const { assembly } = assemblePrompt({
      system: 'You are a reviewer.',
      skills: ['# First', '# Second'],
      diff: 'diff --git a/a.ts b/a.ts',
    });
    expect(assembly.skills).toBe('# First\n\n# Second');
    expect(assembly.user).toContain('## Skills / rules');
    expect(assembly.user.indexOf('# First')).toBeLessThan(assembly.user.indexOf('# Second'));
  });

  it('omits the section entirely when there are no skills', () => {
    const { assembly } = assemblePrompt({
      system: 'You are a reviewer.',
      skills: [],
      diff: 'diff --git a/a.ts b/a.ts',
    });
    expect(assembly.skills).toBeNull();
    expect(assembly.user).not.toContain('## Skills / rules');
  });
});
