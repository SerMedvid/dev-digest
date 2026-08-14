import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClonePort } from './ports.js';

/**
 * The real checkout reader. `path.join` only — this has to work on a
 * contributor's Windows box and on the Linux CI runner alike.
 */
export const fsClone: ClonePort = {
  async readFile(clonePath: string, relPath: string): Promise<string | undefined> {
    try {
      return await readFile(join(clonePath, relPath), 'utf8');
    } catch {
      return undefined;
    }
  },

  async exists(clonePath: string, relPath: string): Promise<boolean> {
    try {
      await access(join(clonePath, relPath));
      return true;
    } catch {
      return false;
    }
  },
};
