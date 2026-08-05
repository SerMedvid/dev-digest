import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloneDocReader } from '../src/modules/intent/docs.js';

describe('CloneDocReader', () => {
  let clone: string;

  beforeAll(async () => {
    clone = await mkdtemp(join(tmpdir(), 'intent-docs-'));
    await mkdir(join(clone, 'docs', 'plans'), { recursive: true });
    await writeFile(join(clone, 'docs', 'plans', 'rate-limit.md'), '# Plan\nAdd a limiter.', 'utf8');
  });
  afterAll(async () => {
    await rm(clone, { recursive: true, force: true });
  });

  it('reads a referenced document', async () => {
    const { found, missing } = await new CloneDocReader().read(clone, ['docs/plans/rate-limit.md']);
    expect(found[0]!.label).toBe('doc:docs/plans/rate-limit.md');
    expect(found[0]!.content).toContain('Add a limiter');
    expect(missing).toEqual([]);
  });

  it('reports an absent document instead of inventing one', async () => {
    const { found, missing } = await new CloneDocReader().read(clone, ['docs/plans/nope.md']);
    expect(found).toEqual([]);
    expect(missing[0]).toContain('docs/plans/nope.md');
  });

  it('refuses to escape the clone', async () => {
    const { found, missing } = await new CloneDocReader().read(clone, [
      '../../../etc/passwd',
      'docs/../../outside.md',
    ]);
    expect(found).toEqual([]);
    expect(missing).toHaveLength(2);
    for (const m of missing) expect(m).toContain('outside the repository');
  });

  it('refuses a non-markdown path and caps how many it reads', async () => {
    const many = Array.from({ length: 10 }, (_, i) => `docs/plans/d${i}.md`);
    const { missing } = await new CloneDocReader().read(clone, ['package.json', ...many]);
    expect(missing.some((m) => m.includes('not a markdown file'))).toBe(true);
  });
});
