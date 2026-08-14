import {
  MAX_CHAINS,
  MAX_COMMANDS,
  MAX_CRITICAL_PATHS,
  MAX_READING_PATH,
  REPO_MAP_TOKEN_BUDGET,
} from './constants.js';
import type { FactsSkeleton, RankedFile } from './domain.js';
import type { ClonePort, RepoIntelPort } from './ports.js';

/**
 * The deterministic half of the tour: everything the model is forbidden to
 * invent. Paths come from the index, commands from the checkout — so a
 * hallucinated file cannot reach the page, because the model never supplies one.
 */

export interface CommandInput {
  lockfiles: string[];
  packageJson: string | undefined;
  composeServices: string[];
  hasEnvExample: boolean;
}

interface FactsDeps {
  repoIntel: RepoIntelPort;
  clone: ClonePort;
}

const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb'] as const;

/** lockfile → install command + the prefix that runs a script. */
const MANAGERS: Record<string, { install: string; run: string }> = {
  'pnpm-lock.yaml': { install: 'pnpm install', run: 'pnpm' },
  'package-lock.json': { install: 'npm ci', run: 'npm run' },
  'yarn.lock': { install: 'yarn install', run: 'yarn' },
  'bun.lockb': { install: 'bun install', run: 'bun run' },
};

/**
 * Pure, so it is testable without a checkout. The order is fixed — install,
 * env, services, run — because that is the order a newcomer types them.
 */
export function extractCommands(input: CommandInput): string[] {
  const out: string[] = [];
  const lock = LOCKFILES.find((l) => input.lockfiles.includes(l));
  const manager = lock ? MANAGERS[lock] : undefined;
  if (manager) out.push(manager.install);
  if (input.hasEnvExample) out.push('cp .env.example .env');
  if (input.composeServices.length > 0) {
    out.push(`docker compose up -d ${input.composeServices.join(' ')}`);
  }
  const scripts = parseScripts(input.packageJson);
  if (manager) {
    if (scripts['dev']) out.push(`${manager.run} dev`);
    else if (scripts['start']) out.push(`${manager.run} start`);
  }
  return out.slice(0, MAX_COMMANDS);
}

function parseScripts(packageJson: string | undefined): Record<string, string> {
  if (!packageJson) return {};
  try {
    const parsed = JSON.parse(packageJson) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

/**
 * Service names from a compose file, without adding a YAML parser: the
 * two-space-indented keys directly under a top-level `services:`. Anything
 * fancier than that is not worth a dependency for four command strings.
 */
export function parseComposeServices(compose: string | undefined): string[] {
  if (!compose) return [];
  const lines = compose.split(/\r?\n/);
  const start = lines.findIndex((l) => /^services:\s*$/.test(l));
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // back to a top-level key
    const m = line.match(/^\s{2}([A-Za-z0-9._-]+):\s*$/);
    if (m?.[1]) out.push(m[1]);
  }
  return out;
}

export async function buildFacts(
  deps: FactsDeps,
  repoId: string,
  clonePath: string | null,
): Promise<FactsSkeleton> {
  const [indexState, topFiles, repoMap, chains] = await Promise.all([
    deps.repoIntel.getIndexState(repoId),
    deps.repoIntel.getTopFilesByRank(repoId, MAX_CRITICAL_PATHS),
    deps.repoIntel.getRepoMap(repoId, REPO_MAP_TOKEN_BUDGET),
    deps.repoIntel.getCriticalPaths(repoId),
  ]);

  const ranks = topFiles.length > 0 ? await deps.repoIntel.getFileRank(repoId, topFiles) : [];
  const percentileOf = new Map(ranks.map((r) => [r.path, r.percentile]));
  const criticalPaths: RankedFile[] = topFiles.map((path) => ({
    path,
    percentile: percentileOf.get(path) ?? null,
  }));

  return {
    criticalPaths,
    // A subset of the same rank order, exactly as the reference design shows —
    // the reading path is "start here", not a second opinion about importance.
    readingPath: criticalPaths.slice(0, MAX_READING_PATH),
    chains: chains.slice(0, MAX_CHAINS),
    commands: clonePath ? await readCommands(deps.clone, clonePath) : [],
    repoMap: repoMap.text,
    indexedFiles: indexState.filesIndexed,
    indexSha: indexState.lastIndexedSha,
  };
}

async function readCommands(clone: ClonePort, clonePath: string): Promise<string[]> {
  const [packageJson, composeYml, composeYaml, hasEnvExample, ...locks] = await Promise.all([
    clone.readFile(clonePath, 'package.json'),
    clone.readFile(clonePath, 'docker-compose.yml'),
    clone.readFile(clonePath, 'docker-compose.yaml'),
    clone.exists(clonePath, '.env.example'),
    ...LOCKFILES.map((l) => clone.exists(clonePath, l)),
  ]);
  const lockfiles = LOCKFILES.filter((_, i) => locks[i]);
  return extractCommands({
    lockfiles,
    packageJson,
    composeServices: parseComposeServices(composeYml ?? composeYaml),
    hasEnvExample,
  });
}
