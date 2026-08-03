/** Extraction limits. Every magic number in the module lives here. */

/** Code-file paths offered to the selection call. */
export const POOL_SIZE = 40;
/** Upper bound on files the model may pick. */
export const MAX_SELECTED = 12;
/** Below this we top up deterministically from the ranked list. */
export const MIN_SELECTED = 8;

export const MAX_FILE_LINES = 200;
export const MAX_FILE_BYTES = 8192;

/** A candidate the model is less sure of than this is not worth a human's time. */
export const MIN_CONFIDENCE = 0.5;
/** Lines either side of the cited line to search for the snippet. */
export const SNIPPET_WINDOW = 10;
export const MAX_PER_CATEGORY = 3;
export const MAX_CANDIDATES = 15;
/** Evidence in a skill body is a citation, not a file dump. */
export const MAX_SNIPPET_LINES = 10;

export const EXTRACT_JOB_KIND = 'conventions.extract';

/**
 * Config files worth sampling, checked at the clone root. Ordered most to least
 * informative; the first match of each family is enough.
 */
export const CONFIG_CANDIDATES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  'prettier.config.js',
  'prettier.config.cjs',
  'biome.json',
  '.editorconfig',
  'package.json',
] as const;
