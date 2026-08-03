import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_CANDIDATES, MAX_FILE_BYTES } from './constants.js';
import type { SampleFile } from './domain.js';

/**
 * Driven adapter: the only file-system access in the module. Injected into the
 * service as `SamplerPort`, so the orchestration is testable with no clone.
 *
 * Every read is best-effort. A config that is absent is simply not sampled, and
 * a code file that has moved since indexing must not fail the scan.
 */
export class CloneSampler {
  /**
   * Configs at the clone root. These always enter the sample and never pass
   * through model selection: they are the densest source of already-agreed
   * rules in any repo, so letting a model decide whether to look buys nothing.
   */
  async configSamples(clonePath: string): Promise<SampleFile[]> {
    const found = await Promise.all(
      // Annotated: without it the element type keeps CONFIG_CANDIDATES' literal
      // path union, which the `s is SampleFile` predicate below cannot narrow.
      CONFIG_CANDIDATES.map(async (path): Promise<SampleFile | null> => {
        const content = await this.read(clonePath, path);
        return content === null ? null : { path, content, kind: 'config' };
      }),
    );
    return found.filter((s): s is SampleFile => s !== null);
  }

  /** The code files the selection step chose, in the order given. */
  async readSamples(clonePath: string, paths: string[]): Promise<SampleFile[]> {
    const read = await Promise.all(
      paths.map(async (path): Promise<SampleFile | null> => {
        const content = await this.read(clonePath, path);
        return content === null ? null : { path, content, kind: 'code' };
      }),
    );
    return read.filter((s): s is SampleFile => s !== null);
  }

  private async read(clonePath: string, file: string): Promise<string | null> {
    const content = await readFile(join(clonePath, file), 'utf8').catch(() => null);
    return content === null ? null : content.slice(0, MAX_FILE_BYTES);
  }
}
