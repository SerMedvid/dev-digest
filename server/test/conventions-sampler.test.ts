import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { CloneSampler } from '../src/modules/conventions/sampler.js';

let clone: string;

/** join()+dirname(), never lastIndexOf('/') — that bug is in this repo twice. */
async function write(rel: string, content: string) {
  const full = join(clone, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
}

beforeAll(async () => {
  clone = await mkdtemp(join(tmpdir(), 'conv-sampler-'));
  await write('tsconfig.json', '{ "compilerOptions": { "strict": true } }');
  await write('.prettierrc', '{ "semi": false }');
  await write('src/api/users.ts', 'export const a = 1;\nexport const b = 2;\n');
  await write('src/big.ts', 'x'.repeat(20_000));
});

afterAll(async () => {
  await rm(clone, { recursive: true, force: true });
});

describe('CloneSampler.configSamples', () => {
  it('finds the configs that exist and ignores the ones that do not', async () => {
    const samples = await new CloneSampler().configSamples(clone);
    expect(samples.map((s) => s.path).sort()).toEqual(['.prettierrc', 'tsconfig.json']);
    expect(samples.every((s) => s.kind === 'config')).toBe(true);
    expect(samples.find((s) => s.path === '.prettierrc')!.content).toContain('semi');
  });

  it('returns [] for a clone path that does not exist', async () => {
    const samples = await new CloneSampler().configSamples(join(clone, 'nope'));
    expect(samples).toEqual([]);
  });
});

describe('CloneSampler.readSamples', () => {
  it('reads the requested code files', async () => {
    const samples = await new CloneSampler().readSamples(clone, ['src/api/users.ts']);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.kind).toBe('code');
    expect(samples[0]!.content).toContain('export const b');
  });

  it('skips a path that is not in the clone instead of throwing', async () => {
    const samples = await new CloneSampler().readSamples(clone, [
      'src/api/users.ts',
      'src/ghost.ts',
    ]);
    expect(samples.map((s) => s.path)).toEqual(['src/api/users.ts']);
  });

  it('truncates a file to the byte cap', async () => {
    const samples = await new CloneSampler().readSamples(clone, ['src/big.ts']);
    expect(samples[0]!.content.length).toBeLessThanOrEqual(8192);
  });
});
