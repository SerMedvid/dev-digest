import { describe, it, expect } from 'vitest';
import { buildFacts, extractCommands, parseComposeServices } from '../src/modules/onboarding/facts.js';
import type { ClonePort, RepoIntelPort } from '../src/modules/onboarding/ports.js';

/**
 * The deterministic half of the tour. These tests are the guarantee behind the
 * spec's grounding claim: paths and commands come from the index and the
 * checkout, so the model is never in a position to invent one.
 */

describe('extractCommands', () => {
  it('derives install, env, docker and dev in a fixed order', () => {
    const cmds = extractCommands({
      lockfiles: ['pnpm-lock.yaml'],
      packageJson: JSON.stringify({ scripts: { dev: 'next dev', build: 'next build' } }),
      composeServices: ['postgres', 'redis'],
      hasEnvExample: true,
    });
    expect(cmds).toEqual([
      'pnpm install',
      'cp .env.example .env',
      'docker compose up -d postgres redis',
      'pnpm dev',
    ]);
  });

  it('picks the package manager from the lockfile', () => {
    expect(
      extractCommands({
        lockfiles: ['package-lock.json'],
        packageJson: '{}',
        composeServices: [],
        hasEnvExample: false,
      }),
    ).toEqual(['npm ci']);
    expect(
      extractCommands({
        lockfiles: ['yarn.lock'],
        packageJson: '{}',
        composeServices: [],
        hasEnvExample: false,
      }),
    ).toEqual(['yarn install']);
  });

  it('falls back to start when there is no dev script', () => {
    const cmds = extractCommands({
      lockfiles: ['pnpm-lock.yaml'],
      packageJson: JSON.stringify({ scripts: { start: 'node server.js' } }),
      composeServices: [],
      hasEnvExample: false,
    });
    expect(cmds).toEqual(['pnpm install', 'pnpm start']);
  });

  it('survives an unparseable package.json', () => {
    expect(
      extractCommands({
        lockfiles: [],
        packageJson: 'not json',
        composeServices: [],
        hasEnvExample: false,
      }),
    ).toEqual([]);
  });

  it('caps the command list', () => {
    const cmds = extractCommands({
      lockfiles: ['pnpm-lock.yaml'],
      packageJson: JSON.stringify({ scripts: { dev: 'x' } }),
      composeServices: Array.from({ length: 20 }, (_, i) => `svc${i}`),
      hasEnvExample: true,
    });
    expect(cmds.length).toBeLessThanOrEqual(6);
  });
});

describe('parseComposeServices', () => {
  it('reads the two-space-indented keys under services:', () => {
    const compose = [
      'version: "3"',
      'services:',
      '  postgres:',
      '    image: pgvector/pgvector:pg16',
      '    ports:',
      '      - 5432:5432',
      '  redis:',
      '    image: redis:7',
      'volumes:',
      '  pgdata:',
    ].join('\n');
    expect(parseComposeServices(compose)).toEqual(['postgres', 'redis']);
  });

  it('returns empty for an absent or service-less file', () => {
    expect(parseComposeServices(undefined)).toEqual([]);
    expect(parseComposeServices('version: "3"\nvolumes:\n  pgdata:\n')).toEqual([]);
  });
});

const intel = (over: Partial<RepoIntelPort> = {}): RepoIntelPort => ({
  getIndexState: async () => ({ lastIndexedSha: 'sha-1', filesIndexed: 12_450 }),
  getTopFilesByRank: async (_r, n) =>
    [
      'src/server.ts',
      'src/api/public/index.ts',
      'src/middleware/auth.ts',
      'src/lib/redis.ts',
      'src/db.ts',
      'src/util.ts',
    ].slice(0, n),
  getFileRank: async (_r, paths) => paths.map((path, i) => ({ path, percentile: 99 - i })),
  getRepoMap: async () => ({ text: 'MAP' }),
  getCriticalPaths: async () => [['src/server.ts', 'src/middleware/auth.ts']],
  ...over,
});

const clone = (files: Record<string, string>): ClonePort => ({
  readFile: async (_c, rel) => files[rel],
  exists: async (_c, rel) => rel in files,
});

describe('buildFacts', () => {
  it('orders the reading path by rank and keeps it inside the cap', async () => {
    const facts = await buildFacts(
      { repoIntel: intel(), clone: clone({ 'package.json': '{}' }) },
      'repo-1',
      '/tmp/clone',
    );
    expect(facts.readingPath.map((f) => f.path)).toEqual([
      'src/server.ts',
      'src/api/public/index.ts',
      'src/middleware/auth.ts',
      'src/lib/redis.ts',
      'src/db.ts',
    ]);
    expect(facts.readingPath.map((f) => f.percentile)).toEqual([99, 98, 97, 96, 95]);
    expect(facts.criticalPaths).toHaveLength(6);
  });

  it('carries the index state through for the staleness badge', async () => {
    const facts = await buildFacts({ repoIntel: intel(), clone: clone({}) }, 'repo-1', '/tmp/clone');
    expect(facts.indexSha).toBe('sha-1');
    expect(facts.indexedFiles).toBe(12_450);
  });

  it('degrades to empty collections when the index is empty', async () => {
    const facts = await buildFacts(
      {
        repoIntel: intel({ getTopFilesByRank: async () => [], getCriticalPaths: async () => [] }),
        clone: clone({}),
      },
      'repo-1',
      '/tmp/clone',
    );
    expect(facts.criticalPaths).toEqual([]);
    expect(facts.readingPath).toEqual([]);
  });

  it('leaves percentile null when the rank lookup has no row for a file', async () => {
    const facts = await buildFacts(
      { repoIntel: intel({ getFileRank: async () => [] }), clone: clone({}) },
      'repo-1',
      '/tmp/clone',
    );
    expect(facts.criticalPaths.every((f) => f.percentile === null)).toBe(true);
  });

  it('reads commands off the checkout', async () => {
    const facts = await buildFacts(
      {
        repoIntel: intel(),
        clone: clone({
          'package.json': JSON.stringify({ scripts: { dev: 'next dev' } }),
          'pnpm-lock.yaml': '',
          '.env.example': '',
          'docker-compose.yml': 'services:\n  postgres:\n    image: x\n',
        }),
      },
      'repo-1',
      '/tmp/clone',
    );
    expect(facts.commands).toEqual([
      'pnpm install',
      'cp .env.example .env',
      'docker compose up -d postgres',
      'pnpm dev',
    ]);
  });

  it('yields no commands when there is no clone on disk', async () => {
    const facts = await buildFacts({ repoIntel: intel(), clone: clone({}) }, 'repo-1', null);
    expect(facts.commands).toEqual([]);
  });
});
