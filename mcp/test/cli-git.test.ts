/**
 * The git helpers against REAL git in throwaway repositories — mocking git here
 * would only prove the mock matches the mock. Everything uses `path.join` and
 * temp dirs, so it runs the same on Linux CI and Windows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoRoot, workingDiff, untrackedCount } from '../src/cli/git.js';

const exec = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await exec('git', args, { cwd });
}

let hasGit = true;
try {
  await exec('git', ['--version']);
} catch {
  hasGit = false;
}
const d = hasGit ? describe : describe.skip;

d('cli/git against a real repository', () => {
  let dir: string;
  let notARepo: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'devdigest-cli-'));
    notARepo = await mkdtemp(join(tmpdir(), 'devdigest-bare-'));

    await git(dir, 'init');
    // Identity is required for `git commit` and is not guaranteed in CI.
    await git(dir, 'config', 'user.email', 'test@example.com');
    await git(dir, 'config', 'user.name', 'Test');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'tracked.ts'), 'export const a = 1;\n');
    await git(dir, 'add', '.');
    await git(dir, 'commit', '-m', 'initial');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(notARepo, { recursive: true, force: true });
  });

  it('finds the repository root, and reports null outside one', async () => {
    expect(await repoRoot(dir)).toBeTruthy();
    expect(await repoRoot(notARepo)).toBeNull();
  });

  it('reports an empty diff on a clean tree', async () => {
    expect((await workingDiff(dir)).trim()).toBe('');
  });

  it('sees an unstaged edit to a tracked file', async () => {
    await writeFile(join(dir, 'src', 'tracked.ts'), 'export const a = 2;\n');
    const diff = await workingDiff(dir);
    expect(diff).toContain('src/tracked.ts');
    expect(diff).toContain('+export const a = 2;');
  });

  it('still sees the edit once it is staged — git diff HEAD covers both', async () => {
    await git(dir, 'add', '.');
    const diff = await workingDiff(dir);
    expect(diff).toContain('src/tracked.ts');
  });

  it('counts untracked files, which the diff cannot see', async () => {
    expect(await untrackedCount(dir)).toBe(0);

    await writeFile(join(dir, 'src', 'untracked.ts'), 'export const b = 3;\n');
    expect(await untrackedCount(dir)).toBe(1);
    // The honest bit: the new file is invisible to the review input.
    expect(await workingDiff(dir)).not.toContain('untracked.ts');

    await writeFile(join(dir, 'src', 'untracked2.ts'), 'export const c = 4;\n');
    expect(await untrackedCount(dir)).toBe(2);
  });

  it('respects .gitignore when counting untracked files', async () => {
    const before = await untrackedCount(dir);
    await writeFile(join(dir, '.gitignore'), 'ignored.ts\n');
    await writeFile(join(dir, 'ignored.ts'), 'export const d = 5;\n');
    // .gitignore itself is untracked and counts; ignored.ts must not.
    expect(await untrackedCount(dir)).toBe(before + 1);
  });
});
