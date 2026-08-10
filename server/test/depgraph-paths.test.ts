/**
 * `DepCruiseGraph.buildEdges` against real files on disk.
 *
 * The adapter had no test of its own — `indexer-pipeline.test.ts` stubs it with
 * `buildEdges: async () => []` — which is how a defect that emptied the entire
 * import graph on Windows shipped unnoticed.
 *
 * The fixture paths are deliberately NESTED. `toRel` returned native separators,
 * so the bug only appears once a relative path actually contains one: with flat
 * `a.ts` / `b.ts` at the root, `relative()` yields the same string on every
 * platform and the defect hides completely.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DepCruiseGraph } from '../src/adapters/depgraph/index.js';

let base: string;
let root: string;

beforeAll(async () => {
  // Under CWD, deliberately — NOT `os.tmpdir()`. dependency-cruiser emits
  // cwd-relative paths, so on Windows a fixture in `%TEMP%` (C:) while the
  // package sits on another drive (D:) cannot be expressed relative to cwd at
  // all: cruise joins the two and stats a path that cannot exist. The real
  // clone dir lives under the server package, so this mirrors production.
  base = join(process.cwd(), '.depgraph-test-tmp');
  await mkdir(base, { recursive: true });
  root = await mkdtemp(join(base, 'repo-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'lib'), { recursive: true });
  // A tsconfig makes cruise's resolution of the extensionless/.js specifier
  // deterministic; the adapter already picks one up when it exists.
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler' } }),
  );
  await writeFile(join(root, 'lib', 'b.ts'), 'export const b = 1;\n');
  await writeFile(
    join(root, 'src', 'a.ts'),
    "import { b } from '../lib/b.js';\nexport const a = b + 1;\n",
  );
});

afterAll(async () => {
  if (base) await rm(base, { recursive: true, force: true });
});

describe('DepCruiseGraph.buildEdges', () => {
  // The walker stores POSIX-relative paths (`pipeline/walk.ts` normalises them
  // on purpose), so that is exactly what the caller passes in here.
  const files = ['src/a.ts', 'lib/b.ts'];

  it('resolves a local import into an edge', async () => {
    const edges = await new DepCruiseGraph().buildEdges(root, files);
    expect(edges).toContainEqual({ from: 'src/a.ts', to: 'lib/b.ts' });
  });

  it('REGRESSION: emits POSIX separators, so edges survive the caller fileSet check', async () => {
    // `toRel` used to return `relative()` unchanged — native separators — so on
    // Windows every path came back as `src\a.ts` while the caller's `fileSet`
    // held `src/a.ts`. `fileSet.has(from)` then missed for EVERY module and
    // buildEdges returned [] with no throw, so `graphFailed` stayed unset and
    // the index still reported status 'full'. That emptied file_edges and left
    // every references.decl_file NULL (resolution runs through this graph),
    // which is what made blast radius show 0 callers on every symbol.
    const edges = await new DepCruiseGraph().buildEdges(root, files);

    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.from).not.toContain('\\');
      expect(e.to).not.toContain('\\');
      // The contract that actually matters: what comes out must be findable in
      // what went in, or the caller silently discards it.
      expect(files).toContain(e.from);
      expect(files).toContain(e.to);
    }
  });

  it('returns [] for an empty file list without invoking cruise', async () => {
    expect(await new DepCruiseGraph().buildEdges(root, [])).toEqual([]);
  });
});
