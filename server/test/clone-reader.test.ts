import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloneReader } from '../src/adapters/clone-reader/index.js';

/**
 * Symlink creation needs elevation on Windows unless Developer Mode is on, and
 * some CI sandboxes disallow it outright. Probe once at module load — the same
 * shape as `test/intent-docs.test.ts`, whose assertions this file generalises —
 * so the escaping-symlink case is `it.skip`ped rather than silently faked with a
 * copy when unsupported.
 */
async function symlinkSupported(): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), 'clone-reader-symlink-probe-'));
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

/**
 * A DIRECTORY link, probed separately: Windows creates junctions without
 * elevation (`type: 'junction'`), which is what makes the clone-root-behind-a-link
 * case testable on every platform this repo runs on — on POSIX the type argument
 * is ignored and an ordinary symlink is created.
 */
async function dirLinkSupported(): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), 'clone-reader-dirlink-probe-'));
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

const canDirLink = await dirLinkSupported();
const dirLinkIt = canDirLink ? it : it.skip;

/** Generous enough that nothing in the confinement cases truncates. */
const CAP = 64_000;

describe('CloneReader', () => {
  let clone: string;
  let outsideDir: string | undefined;

  beforeAll(async () => {
    clone = await mkdtemp(join(tmpdir(), 'clone-reader-'));
    // NESTED on purpose: a flat fixture cannot surface a separator bug.
    await mkdir(join(clone, 'docs', 'plans'), { recursive: true });
    await writeFile(join(clone, 'docs', 'plans', 'rate-limit.md'), '# Plan\nAdd a limiter.', 'utf8');
    await writeFile(join(clone, 'package.json'), '{"name":"fixture"}', 'utf8');
    await writeFile(join(clone, 'docs', 'big.md'), 'a'.repeat(100), 'utf8');
    await writeFile(join(clone, 'docs', 'exact.md'), 'b'.repeat(64), 'utf8');
    // 'é' is two bytes in UTF-8, so a cap of 3 splits the second one.
    await writeFile(join(clone, 'docs', 'multibyte.md'), 'éé', 'utf8');

    if (canSymlink) {
      outsideDir = await mkdtemp(join(tmpdir(), 'clone-reader-outside-'));
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

  it('reads a nested markdown file', async () => {
    const reader = await CloneReader.open(clone);
    const res = await reader.read('docs/plans/rate-limit.md', CAP);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.text).toContain('Add a limiter');
    expect(res.truncated).toBe(false);
    expect(res.bytes).toBe(Buffer.byteLength('# Plan\nAdd a limiter.', 'utf8'));
  });

  it('reports not_found for a path that does not exist', async () => {
    const reader = await CloneReader.open(clone);
    const res = await reader.read('docs/plans/nope.md', CAP);
    expect(res).toEqual({ ok: false, reason: 'not_found' });
  });

  it('refuses a lexical escape from the clone', async () => {
    const reader = await CloneReader.open(clone);
    for (const rel of ['../../../etc/passwd', 'docs/../../outside.md']) {
      expect(await reader.read(rel, CAP)).toEqual({ ok: false, reason: 'outside' });
    }
  });

  it('reports an escape as outside, never as not_markdown', async () => {
    // `../../../etc/passwd` lacks `.md` too; the order of the checks decides
    // which reason is reported, and it must be the confinement one.
    const reader = await CloneReader.open(clone);
    const res = await reader.read('../../../etc/passwd', CAP);
    expect(res).toEqual({ ok: false, reason: 'outside' });
  });

  it('refuses a non-markdown path inside the clone', async () => {
    const reader = await CloneReader.open(clone);
    const res = await reader.read('package.json', CAP);
    expect(res).toEqual({ ok: false, reason: 'not_markdown' });
  });

  // Skipped when the environment can't create symlinks (e.g. unelevated
  // Windows without Developer Mode) — see `symlinkSupported()` above. CI is
  // Linux, where this always runs.
  symlinkIt('refuses a symlink whose in-clone path is clean but whose target is not', async () => {
    const reader = await CloneReader.open(clone);
    const res = await reader.read('docs/plans/leak.md', CAP);
    expect(res).toEqual({ ok: false, reason: 'outside' });
    // The failure must carry no absolute path and no file content.
    const serialised = JSON.stringify(res);
    expect(serialised).not.toContain('SECRET-OUTSIDE-CLONE');
    expect(serialised).not.toContain(outsideDir!);
    expect(serialised).not.toContain('secret.md');
  });

  /**
   * The same escape one level up: the document's own path is clean and so is
   * its name, but an ANCESTOR DIRECTORY is a link out of the clone. Uses a
   * junction, so unlike the file-symlink case above this one also runs on an
   * unelevated Windows box.
   */
  dirLinkIt('refuses a document under a linked ancestor directory', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'clone-reader-outside-dir-'));
    try {
      await writeFile(join(parent, 'secret.md'), 'SECRET-OUTSIDE-CLONE', 'utf8');
      await symlink(parent, join(clone, 'docs', 'linked'), 'junction');
      const reader = await CloneReader.open(clone);
      const res = await reader.read('docs/linked/secret.md', CAP);
      expect(res).toEqual({ ok: false, reason: 'outside' });
      const serialised = JSON.stringify(res);
      expect(serialised).not.toContain('SECRET-OUTSIDE-CLONE');
      expect(serialised).not.toContain(parent);
    } finally {
      await rm(join(clone, 'docs', 'linked'), { recursive: true, force: true });
      await rm(parent, { recursive: true, force: true });
    }
  });

  /**
   * The root itself reached through a link — the case that silently rejected
   * EVERY document when the lexical root and the realpath'd target were
   * compared against each other. Not hypothetical: on macOS `os.tmpdir()` is
   * `/var/folders/…` and `/var` is a symlink. Reproduced deterministically with
   * a junction (Windows) / symlink (POSIX) in front of the clone directory.
   */
  dirLinkIt('reads a document when the clone root is reached through a link', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'clone-reader-linkroot-'));
    const linkedRoot = join(parent, 'clone-link');
    try {
      await symlink(clone, linkedRoot, 'junction');
      const reader = await CloneReader.open(linkedRoot);
      const res = await reader.read('docs/plans/rate-limit.md', CAP);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.text).toContain('Add a limiter');
      // …and an escape is still refused through the linked root.
      expect(await reader.read('docs/../../outside.md', CAP)).toEqual({
        ok: false,
        reason: 'outside',
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('truncates by bytes and reports the file’s real byte length', async () => {
    const reader = await CloneReader.open(clone);
    const res = await reader.read('docs/big.md', 40);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.truncated).toBe(true);
    expect(Buffer.byteLength(res.text, 'utf8')).toBe(40);
    expect(res.text.length).toBeLessThan(100);
    expect(res.bytes).toBe(100);
  });

  it('does not truncate a file of exactly maxBytes bytes', async () => {
    const reader = await CloneReader.open(clone);
    const res = await reader.read('docs/exact.md', 64);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.truncated).toBe(false);
    expect(res.text).toBe('b'.repeat(64));
    expect(res.bytes).toBe(64);
  });

  it('replaces a multi-byte sequence split by the cap with U+FFFD', async () => {
    const reader = await CloneReader.open(clone);
    const res = await reader.read('docs/multibyte.md', 3);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.truncated).toBe(true);
    expect(res.bytes).toBe(4);
    expect(res.text).toBe('é�');
  });

  /**
   * R1. `stat` exists so a caller that only needs "is it there, and how big is
   * it?" — the attachment view — stops paying for a read plus a tokenizer pass
   * per attached document.
   *
   * The cases below are the read's confinement cases repeated verbatim, on
   * purpose: a `stat` that confined differently from the `read` would let the
   * view describe a document the run refuses, or the reverse, and the view exists
   * precisely to describe what the run will do. The last case asserts the
   * agreement directly rather than by inspection.
   */
  describe('stat', () => {
    it('reports the real byte length without reading the file', async () => {
      const reader = await CloneReader.open(clone);
      expect(await reader.stat('docs/big.md')).toEqual({ ok: true, bytes: 100 });
      expect(await reader.stat('docs/multibyte.md')).toEqual({ ok: true, bytes: 4 });
      // No text, no truncation flag, no cap argument: nothing was transferred.
      expect(Object.keys(await reader.stat('docs/big.md'))).toEqual(['ok', 'bytes']);
    });

    it('reports not_found for an absent path', async () => {
      const reader = await CloneReader.open(clone);
      expect(await reader.stat('docs/plans/nope.md')).toEqual({
        ok: false,
        reason: 'not_found',
      });
    });

    it('reports not_found for a directory, not a size', async () => {
      const reader = await CloneReader.open(clone);
      // `.md` so the extension check passes and the `isFile()` arm is what answers.
      await mkdir(join(clone, 'docs', 'dir.md'), { recursive: true });
      try {
        expect(await reader.stat('docs/dir.md')).toEqual({ ok: false, reason: 'not_found' });
      } finally {
        await rm(join(clone, 'docs', 'dir.md'), { recursive: true, force: true });
      }
    });

    it('refuses a lexical escape, and calls it outside rather than not_markdown', async () => {
      const reader = await CloneReader.open(clone);
      for (const rel of ['../../../etc/passwd', 'docs/../../outside.md']) {
        expect(await reader.stat(rel)).toEqual({ ok: false, reason: 'outside' });
      }
    });

    it('refuses a non-markdown path inside the clone', async () => {
      const reader = await CloneReader.open(clone);
      expect(await reader.stat('package.json')).toEqual({ ok: false, reason: 'not_markdown' });
    });

    symlinkIt('refuses a symlink whose target leaves the clone, leaking nothing', async () => {
      const reader = await CloneReader.open(clone);
      const res = await reader.stat('docs/plans/leak.md');
      expect(res).toEqual({ ok: false, reason: 'outside' });
      const serialised = JSON.stringify(res);
      expect(serialised).not.toContain(outsideDir!);
      expect(serialised).not.toContain('secret.md');
    });

    dirLinkIt('stats a document when the clone root is reached through a link', async () => {
      const parent = await mkdtemp(join(tmpdir(), 'clone-reader-statlinkroot-'));
      const linkedRoot = join(parent, 'clone-link');
      try {
        await symlink(clone, linkedRoot, 'junction');
        const reader = await CloneReader.open(linkedRoot);
        expect(await reader.stat('docs/exact.md')).toEqual({ ok: true, bytes: 64 });
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });

    /**
     * The invariant the attachment view depends on: `stat` succeeds exactly when
     * `read` does, and agrees on the byte count. `missing` is derived from the
     * one and the run performs the other.
     */
    it('succeeds exactly where read succeeds, and agrees on bytes', async () => {
      const reader = await CloneReader.open(clone);
      const paths = [
        'docs/plans/rate-limit.md',
        'docs/big.md',
        'docs/exact.md',
        'docs/multibyte.md',
        'docs/plans/nope.md',
        'package.json',
        '../../../etc/passwd',
        'docs/../../outside.md',
      ];
      for (const rel of paths) {
        const read = await reader.read(rel, CAP);
        const stat = await reader.stat(rel);
        expect(stat.ok, `${rel}: stat.ok matches read.ok`).toBe(read.ok);
        if (read.ok && stat.ok) {
          expect(stat.bytes, `${rel}: same byte count`).toBe(read.bytes);
        } else if (!read.ok && !stat.ok) {
          expect(stat.reason, `${rel}: same reason`).toBe(read.reason);
        }
      }
    });
  });
});
