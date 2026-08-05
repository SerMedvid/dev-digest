import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloneDocReader } from '../src/modules/intent/docs.js';

/**
 * Symlink creation needs elevation on Windows unless Developer Mode is on, and
 * some CI sandboxes disallow it outright. Probe once at module load — same
 * shape as `dockerAvailable()` elsewhere in this suite — so the escaping-symlink
 * test is `it.skip`ped rather than silently faked with a copy when unsupported.
 */
async function symlinkSupported(): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), 'intent-docs-symlink-probe-'));
  try {
    const target = join(dir, 'target.txt');
    await writeFile(target, 'x', 'utf8');
    await symlink(target, join(dir, 'link'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const canSymlink = await symlinkSupported();
const symlinkIt = canSymlink ? it : it.skip;

describe('CloneDocReader', () => {
  let clone: string;
  let outsideDir: string | undefined;

  beforeAll(async () => {
    clone = await mkdtemp(join(tmpdir(), 'intent-docs-'));
    await mkdir(join(clone, 'docs', 'plans'), { recursive: true });
    await writeFile(join(clone, 'docs', 'plans', 'rate-limit.md'), '# Plan\nAdd a limiter.', 'utf8');

    if (canSymlink) {
      outsideDir = await mkdtemp(join(tmpdir(), 'intent-docs-outside-'));
      const outsideSecret = join(outsideDir, 'secret.md');
      await writeFile(outsideSecret, 'SECRET-OUTSIDE-CLONE', 'utf8');
      // A committed symlink whose OWN path is clean (inside `clone`) but whose
      // target is not — the case the lexical root check cannot see.
      await symlink(outsideSecret, join(clone, 'docs', 'plans', 'leak.md'), 'file');
    }
  });
  afterAll(async () => {
    await rm(clone, { recursive: true, force: true });
    if (outsideDir) await rm(outsideDir, { recursive: true, force: true });
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

  // Skipped when the environment can't create symlinks (e.g. unelevated
  // Windows without Developer Mode) — see `symlinkSupported()` above. CI is
  // Linux, where this always runs.
  symlinkIt('refuses a symlink whose in-root path is clean but whose target is not', async () => {
    const { found, missing } = await new CloneDocReader().read(clone, ['docs/plans/leak.md']);
    expect(found).toEqual([]);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('outside the repository');
    // The rejection message must never leak the resolved target or its content.
    expect(missing[0]).not.toContain('SECRET-OUTSIDE-CLONE');
    expect(missing[0]).not.toContain(outsideDir!);
    expect(JSON.stringify(found)).not.toContain('SECRET-OUTSIDE-CLONE');
  });
});
