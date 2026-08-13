import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloneReader } from '../src/adapters/clone-reader/index.js';

/**
 * The byte cap must bind on the **read**, not after it.
 *
 * `CloneReader` used to `readFile` the whole document and then slice it to
 * `maxBytes`, so a 200 MB generated CHANGELOG cost 200 MB of heap to keep
 * 64 KiB — and past Node's `readFile` size limit the call *threw*, which the
 * reader swallowed into `not_found`: "not found in the repository clone" for a
 * file that plainly exists.
 *
 * A file that large cannot be written in a test, so the failure mode is injected
 * instead: `readFile` is replaced by one that rejects the way Node's own size
 * limit does. Against the old implementation both cases below fail (the read
 * reports `not_found`); against a reader that opens a handle and transfers only
 * `maxBytes`, `readFile` is never reached at all.
 */
const { readFileSpy } = vi.hoisted(() => ({
  readFileSpy: vi.fn(async () => {
    const err = new Error(
      'File size (9007199254740991) is greater than 2 GiB',
    ) as Error & { code?: string };
    err.code = 'ERR_FS_FILE_TOO_LARGE';
    throw err;
  }),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: readFileSpy };
});

/** The production cap (`MAX_DOC_BYTES`), so the numbers below are the real ones. */
const CAP = 65_536;

describe('CloneReader — the cap binds on the read', () => {
  let clone: string;

  beforeAll(async () => {
    clone = await mkdtemp(join(tmpdir(), 'clone-reader-bounded-'));
    await mkdir(join(clone, 'docs'), { recursive: true });
    // Comfortably larger than the cap, so a whole-file read is observable.
    await writeFile(join(clone, 'docs', 'changelog.md'), 'a'.repeat(200_000), 'utf8');
    await writeFile(join(clone, 'docs', 'small.md'), '# hi\n', 'utf8');
  });
  afterAll(async () => {
    await rm(clone, { recursive: true, force: true });
  });

  it('reads a document larger than any whole-file read allows', async () => {
    const reader = await CloneReader.open(clone);
    const res = await reader.read('docs/changelog.md', CAP);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Buffer.byteLength(res.text, 'utf8')).toBe(CAP);
    // `bytes` still reports the file's REAL length — the caller renders the
    // truncation marker from it.
    expect(res.bytes).toBe(200_000);
    expect(res.truncated).toBe(true);
  });

  it('never materialises the whole file, for a large document or a small one', async () => {
    const reader = await CloneReader.open(clone);
    await reader.read('docs/changelog.md', CAP);
    await reader.read('docs/small.md', CAP);
    expect(readFileSpy).not.toHaveBeenCalled();
  });
});
