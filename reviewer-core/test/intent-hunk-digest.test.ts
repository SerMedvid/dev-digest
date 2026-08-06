import { describe, it, expect } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import { hunkHeaderDigest } from '../src/intent/hunk-digest.js';

function diffWith(files: UnifiedDiff['files']): UnifiedDiff {
  return { raw: 'RAW-DIFF-WITH-SECRET sk_live_leak', files };
}

describe('hunkHeaderDigest', () => {
  it('emits paths, counts and hunk headers — and no body content', () => {
    const out = hunkHeaderDigest(
      diffWith([
        {
          path: 'src/config.ts',
          additions: 4,
          deletions: 0,
          hunks: [{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 4, newLineNumbers: [11] }],
        },
      ]),
    );
    expect(out).toContain('src/config.ts (+4 -0)');
    expect(out).toContain('@@ -10,3 +10,4 @@');
    expect(out).not.toContain('sk_live_leak');
    // No added/removed source lines: nothing starts with a bare + or - .
    for (const line of out.split('\n')) {
      expect(line.trimStart().startsWith('+')).toBe(false);
      expect(line.trimStart().startsWith('-')).toBe(false);
    }
  });

  it('caps files and hunks, and says how many it dropped', () => {
    const files = Array.from({ length: 70 }, (_, i) => ({
      path: `src/f${i}.ts`,
      additions: 1,
      deletions: 1,
      hunks: Array.from({ length: 15 }, (_, h) => ({
        oldStart: h + 1,
        oldLines: 1,
        newStart: h + 1,
        newLines: 1,
        newLineNumbers: [h + 1],
      })),
    }));
    const out = hunkHeaderDigest(diffWith(files));
    expect(out).toContain('… 10 more file(s)');
    expect(out).toContain('… 3 more hunk(s)');
    expect(out).not.toContain('src/f60.ts');
  });
});
