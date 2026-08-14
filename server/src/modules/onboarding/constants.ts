import { FEATURE_MODELS } from '@devdigest/shared';

/** Job kind for the generation worker. */
export const GENERATE_JOB_KIND = 'onboarding.generate';

/** Section titles are server-owned so the TOC and the stored tour agree. */
export const SECTION_TITLES = {
  architecture: 'Architecture overview',
  critical_paths: 'Critical paths',
  run_locally: 'How to run locally',
  reading_path: 'Guided reading path',
  first_tasks: 'First tasks',
} as const;

export const MAX_CRITICAL_PATHS = 6;
export const MAX_READING_PATH = 5;
export const MAX_FIRST_TASKS = 4;
export const MAX_COMMANDS = 6;
export const MAX_CHAINS = 5;
export const REPO_MAP_TOKEN_BUDGET = 6_000;

/**
 * The default when the workspace has chosen nothing, taken from the registry
 * rather than restated here. A module-local literal is what let conventions run
 * one model while the Settings screen — which renders `defaultModel` from this
 * same registry — advertised another.
 */
const REGISTRY_DEFAULT = FEATURE_MODELS.find((f) => f.id === 'onboarding')!;
export const DEFAULT_MODEL = {
  provider: REGISTRY_DEFAULT.defaultProvider,
  model: REGISTRY_DEFAULT.defaultModel,
};
