import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DEFAULT_CONTEXT_ROOTS } from '../src/modules/project-context/constants.js';
import { CloneWalker } from '../src/modules/project-context/walk.js';

/**
 * Hermetic: `mkdtemp` fixtures only, no `test/helpers/pg.ts`, no Docker — the
 * lane splits by filename (`server/INSIGHTS.md`, 2026-08-06), so this file must
 * never import the pg helper.
 *
 * Every fixture path is **nested**. A separator bug in the walker is silent: the
 * native-separator path simply matches nothing and the walk reports success with
 * zero results (`server/INSIGHTS.md`, 2026-08-10). A flat `a.md` fixture cannot
 * surface it, because there is no separator in the relative path to get wrong.
 */

const ROOTS = [...DEFAULT_CONTEXT_ROOTS];

/**
 * A DIRECTORY link, probed on its own: Windows creates junctions without
 * elevation (`type: 'junction'`), which is what makes the non-traversal
 * assertion actually run on an unelevated Windows box rather than `it.skip`. On
 * POSIX the type argument is ignored and an ordinary symlink is created. Same
 * shape as `test/intent-docs.test.ts`.
 */
async function dirLinkSupported(): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), 'pc-walk-dirlink-probe-'));
  try {
    await mkdir(join(dir, 'target'), { recursive: true });
    await symlink(join(dir, 'target'), join(dir, 'link'), 'junction');
    return true;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A FILE link needs elevation or Developer Mode on Windows — probed separately. */
async function fileLinkSupported(): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), 'pc-walk-filelink-probe-'));
  try {
    const target = join(dir, 'target.md');
    await writeFile(target, 'x', 'utf8');
    await symlink(target, join(dir, 'link.md'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const canDirLink = await dirLinkSupported();
const dirLinkIt = canDirLink ? it : it.skip;
const canFileLink = await fileLinkSupported();
const fileLinkIt = canFileLink ? it : it.skip;

/** Non-ASCII on purpose: `sizeBytes` is bytes from `stat()`, not characters. */
const A_MD = '# A — é\n';

describe('CloneWalker', () => {
  let clone: string;
  let outside: string;

  beforeAll(async () => {
    clone = await mkdtemp(join(tmpdir(), 'pc-walk-'));
    outside = await mkdtemp(join(tmpdir(), 'pc-walk-outside-'));

    // Discovered.
    await mkdir(join(clone, 'specs'), { recursive: true });
    await writeFile(join(clone, 'specs', 'a.md'), A_MD, 'utf8');
    // A root at depth, itself nested below the root — the separator canary.
    await mkdir(join(clone, 'server', 'src', 'modules', 'x', 'docs'), { recursive: true });
    await writeFile(
      join(clone, 'server', 'src', 'modules', 'x', 'docs', 'y.md'),
      '# Y\n',
      'utf8',
    );
    // Case-INSENSITIVE extension.
    await mkdir(join(clone, 'insights', 'deep', 'nested'), { recursive: true });
    await writeFile(join(clone, 'insights', 'deep', 'nested', 'z.MD'), '# Z\n', 'utf8');

    // Not discovered: wrong extension.
    await mkdir(join(clone, 'docs'), { recursive: true });
    await writeFile(join(clone, 'docs', 'notes.txt'), 'notes\n', 'utf8');

    // Not discovered: case-SENSITIVE root match. `pkg` holds no lowercase
    // `docs`, so the entry keeps its case even on a case-insensitive filesystem.
    await mkdir(join(clone, 'pkg', 'Docs'), { recursive: true });
    await writeFile(join(clone, 'pkg', 'Docs', 'case.md'), '# Case\n', 'utf8');

    // Not discovered: excluded directories, at depth.
    await mkdir(join(clone, 'node_modules', 'pkg', 'docs'), { recursive: true });
    await writeFile(join(clone, 'node_modules', 'pkg', 'docs', 'dep.md'), '# Dep\n', 'utf8');
    await mkdir(join(clone, '.git', 'docs'), { recursive: true });
    await writeFile(join(clone, '.git', 'docs', 'g.md'), '# G\n', 'utf8');

    // Not discovered: a link is never followed. The link sits at a path that
    // WOULD be under a configured root, and its target holds a `.md` that would
    // also be under one — so traversal shows up as an extra result, not silence.
    await mkdir(join(outside, 'docs'), { recursive: true });
    await writeFile(join(outside, 'docs', 'linked.md'), 'SECRET-OUTSIDE-CLONE\n', 'utf8');
    if (canDirLink) {
      await symlink(join(outside, 'docs'), join(clone, 'docs', 'linked'), 'junction');
    }
    if (canFileLink) {
      await symlink(join(outside, 'docs', 'linked.md'), join(clone, 'specs', 'link.md'), 'file');
    }
  });

  afterAll(async () => {
    await rm(clone, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('returns every path repo-relative and POSIX', async () => {
    const { docs } = await new CloneWalker().walk(clone, ROOTS);
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) {
      expect(doc.path).toContain('/');
      expect(doc.path).not.toContain('\\');
      expect(doc.path.startsWith('/')).toBe(false);
      expect(doc.path).not.toContain(clone);
    }
  });

  it('discovers exactly the .md files under a configured root', async () => {
    const { docs, omitted } = await new CloneWalker().walk(clone, ROOTS);
    expect(docs.map((d) => d.path)).toEqual([
      'insights/deep/nested/z.MD',
      'server/src/modules/x/docs/y.md',
      'specs/a.md',
    ]);
    expect(omitted).toBe(0);
  });

  it('records the matched root segment, including a root at depth', async () => {
    const { docs } = await new CloneWalker().walk(clone, ROOTS);
    const byPath = new Map(docs.map((d) => [d.path, d]));
    expect(byPath.get('server/src/modules/x/docs/y.md')?.root).toBe('docs');
    expect(byPath.get('specs/a.md')?.root).toBe('specs');
    expect(byPath.get('insights/deep/nested/z.MD')?.root).toBe('insights');
  });

  it('reports size in bytes, not characters', async () => {
    const { docs } = await new CloneWalker().walk(clone, ROOTS);
    const a = docs.find((d) => d.path === 'specs/a.md');
    expect(a?.sizeBytes).toBe(Buffer.byteLength(A_MD, 'utf8'));
    expect(a?.sizeBytes).toBeGreaterThan(A_MD.length);
  });

  it('descends into no excluded directory, at any depth', async () => {
    const { docs } = await new CloneWalker().walk(clone, ROOTS);
    for (const doc of docs) {
      expect(doc.path).not.toContain('node_modules');
      expect(doc.path).not.toContain('.git');
    }
  });

  it('matches a root segment case-sensitively', async () => {
    const { docs } = await new CloneWalker().walk(clone, ROOTS);
    expect(docs.some((d) => d.path === 'pkg/Docs/case.md')).toBe(false);
  });

  // Runs everywhere this repo runs: a junction on Windows, a symlink on POSIX.
  dirLinkIt('does not traverse a symlinked directory', async () => {
    const { docs } = await new CloneWalker().walk(clone, ROOTS);
    expect(docs.some((d) => d.path.includes('linked'))).toBe(false);
    expect(JSON.stringify(docs)).not.toContain('SECRET-OUTSIDE-CLONE');
  });

  // Skipped on an unelevated Windows box without Developer Mode; CI is Linux.
  fileLinkIt('does not report a symlinked file', async () => {
    const { docs } = await new CloneWalker().walk(clone, ROOTS);
    expect(docs.some((d) => d.path === 'specs/link.md')).toBe(false);
  });

  /**
   * AC-7's second arm. `docs: []` alone cannot carry it: a clone with nothing
   * under the roots produces exactly the same array, and the service has to
   * answer `no_clone` for one and `ok` for the other. The walker is the only
   * thing that can tell them apart, so the flag is asserted in **both**
   * directions here — a `cloneMissing` hardcoded to `true` would pass the first
   * case and fail the second.
   */
  it('flags a clone path that is not there, without throwing', async () => {
    const walker = new CloneWalker();
    await expect(walker.walk(join(clone, 'nope'), ROOTS)).resolves.toEqual({
      docs: [],
      omitted: 0,
      cloneMissing: true,
    });
  });

  it('does not flag a real clone, whether or not it holds documents', async () => {
    const walker = new CloneWalker();
    expect((await walker.walk(clone, ROOTS)).cloneMissing).toBe(false);

    // Present, readable, and empty under every configured root: NOT missing.
    const empty = await mkdtemp(join(tmpdir(), 'pc-walk-empty-'));
    try {
      await expect(walker.walk(empty, ROOTS)).resolves.toEqual({
        docs: [],
        omitted: 0,
        cloneMissing: false,
      });
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe('CloneWalker cap', () => {
  let clone: string;

  beforeAll(async () => {
    clone = await mkdtemp(join(tmpdir(), 'pc-walk-cap-'));
    await mkdir(join(clone, 'specs', 'many'), { recursive: true });
    // Zero-padded so lexicographic order IS numeric order.
    await Promise.all(
      Array.from({ length: 520 }, (_unused, i) =>
        writeFile(join(clone, 'specs', 'many', `f${String(i).padStart(3, '0')}.md`), '#\n', 'utf8'),
      ),
    );
  });

  afterAll(async () => {
    await rm(clone, { recursive: true, force: true });
  });

  it('returns the lexicographically first 500 and counts the rest', async () => {
    const { docs, omitted } = await new CloneWalker().walk(clone, ROOTS);
    expect(docs).toHaveLength(500);
    expect(omitted).toBe(20);
    expect(docs[0]?.path).toBe('specs/many/f000.md');
    expect(docs[499]?.path).toBe('specs/many/f499.md');
    expect(docs.some((d) => d.path === 'specs/many/f500.md')).toBe(false);
    // Sorted ascending BEFORE the cap, so the kept set is the first 500 overall.
    const paths = docs.map((d) => d.path);
    expect(paths).toEqual([...paths].sort());
  });
});
