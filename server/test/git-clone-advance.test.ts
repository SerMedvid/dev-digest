/* SimpleGitClient.clone() over an ALREADY cloned repository.
 *
 * The regression this pins is not subtle once seen: the branch used to do a
 * bare `fetch()`, which moves `origin/<branch>` and touches neither HEAD nor
 * the worktree. Every "re-fetch the clone" therefore left the files exactly as
 * the first clone wrote them — one clone in this repository sat two months
 * behind while its own `origin/main` was current, and everything that reads
 * files off that disk (project context, repo intel, the indexer) reported the
 * stale tree as the truth.
 *
 * Real git, real repositories, no network: `origin` is a directory. That is the
 * only way to test this — the defect lives entirely in which git commands run.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';

const REPO = { owner: 'acme', name: 'widgets' };

let root: string;
let originDir: string;
let cloneDir: string;

/** A real repository with one commit on `main`, serving as `origin`. */
async function makeOrigin(): Promise<void> {
  originDir = join(root, 'origin');
  await mkdir(originDir, { recursive: true });
  const g = simpleGit(originDir);
  await g.init(['--initial-branch=main']);
  await g.addConfig('user.email', 'test@example.com');
  await g.addConfig('user.name', 'Test');
  await writeFile(join(originDir, 'doc.md'), 'first\n', 'utf8');
  await g.add('.');
  await g.commit('first');
}

/** Advance `origin` by one commit, so a clone has something to catch up to. */
async function commitToOrigin(text: string): Promise<string> {
  const g = simpleGit(originDir);
  await writeFile(join(originDir, 'doc.md'), text, 'utf8');
  await g.add('.');
  await g.commit('second');
  return (await g.revparse(['HEAD'])).trim();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'devdigest-clone-advance-'));
  cloneDir = join(root, 'clones');
  await mkdir(cloneDir, { recursive: true });
  await makeOrigin();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('SimpleGitClient.clone on an existing clone', () => {
  it('advances the working tree to the branch head, not just the remote ref', async () => {
    const client = new SimpleGitClient(cloneDir);

    const { path } = await client.clone(REPO, originDir, { branch: 'main' });
    expect(await readFile(join(path, 'doc.md'), 'utf8')).toBe('first\n');

    const head = await commitToOrigin('second\n');

    // The re-clone: same call the `clone` job makes on a refresh.
    await client.clone(REPO, originDir, { branch: 'main' });

    /* Both halves matter. A bare fetch moves `origin/main` and passes an
       assertion that only looks at the remote ref — so the file content is
       what actually proves the worktree followed. */
    const g = simpleGit(path);
    expect((await g.revparse(['origin/main'])).trim()).toBe(head);
    expect((await g.revparse(['HEAD'])).trim()).toBe(head);
    expect(await readFile(join(path, 'doc.md'), 'utf8')).toBe('second\n');
  });

  it('leaves the clone alone when no branch is given', async () => {
    const client = new SimpleGitClient(cloneDir);
    const { path } = await client.clone(REPO, originDir, { branch: 'main' });
    await commitToOrigin('second\n');

    // Without a branch there is no reset target to name, so this degrades to
    // the old fetch rather than guessing one.
    await client.clone(REPO, originDir);

    expect(await readFile(join(path, 'doc.md'), 'utf8')).toBe('first\n');
  });
});
