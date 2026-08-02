/**
 * Architecture gate — the Onion dependency rule for server/src.
 * See .claude/skills/onion-architecture/SKILL.md for the reasoning.
 *
 * Run with `pnpm arch:check`. Violations that predate the gate are frozen in
 * .dependency-cruiser-known-violations.json; regenerate ONLY when the count
 * goes down (`pnpm arch:baseline`).
 *
 * Note: dependency-cruiser is also used as a *product feature* by
 * src/adapters/depgraph — that usage is unrelated to this config.
 */

/** The application core: rings that may not depend on anything outward. */
const CORE = '^src/modules/[^/]+/(service|helpers|domain|ports)\\.ts$';

module.exports = {
  forbidden: [
    {
      name: 'core-no-container',
      comment:
        'A service taking the concrete Container depends on the composition ' +
        'root, which imports every adapter — and it closes an import cycle. ' +
        'Take a narrow Deps interface from the module ports.ts instead.',
      severity: 'error',
      from: { path: CORE },
      to: { path: '^src/platform/container\\.ts$' },
    },
    {
      name: 'core-no-persistence',
      comment:
        'Only repository.ts may know the database. db/client.ts is exempt: it ' +
        'is the Db type a repository constructor takes.',
      severity: 'error',
      from: { path: CORE },
      to: { path: '^src/db/', pathNot: '^src/db/client\\.ts$' },
    },
    {
      name: 'core-no-sdk',
      comment:
        'Third-party SDKs belong in adapters, behind a port from ' +
        '@devdigest/shared. The core never sees an SDK type.',
      severity: 'error',
      from: { path: CORE },
      to: {
        path:
          'node_modules/(drizzle-orm|postgres|fastify|octokit|simple-git|@anthropic-ai|openai)/',
      },
    },
    {
      name: 'routes-no-persistence',
      comment:
        'A route is a driving adapter: parse, call one use-case, map to a DTO. ' +
        'Reaching the database from a route skips the core entirely.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/routes\\.ts$' },
      to: { path: '^src/db/|node_modules/drizzle-orm/' },
    },
    {
      name: 'no-cross-module-internals',
      comment:
        'A module never imports another module s internals. Shared aggregates ' +
        'are constructed in the container; _shared is the only common ground.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/',
        pathNot: ['^src/modules/$1/', '^src/modules/_shared/'],
      },
    },
    {
      name: 'adapters-no-modules',
      comment:
        'Adapters are the outermost ring. An adapter importing a module ' +
        'inverts the dependency rule.',
      severity: 'error',
      from: { path: '^src/adapters/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'no-circular',
      comment: 'A cycle means a boundary is in the wrong place.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment:
        'Weak dead-code signal: only catches files with neither importers nor ' +
        'imports. Kept for hygiene, not relied on.',
      severity: 'error',
      from: { orphan: true, pathNot: '^src/(server|app)\\.ts$' },
      to: {},
    },
  ],
  options: {
    // MANDATORY: without this, `import type { Container }` is invisible and
    // core-no-container silently passes.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    // Tests legitimately reach across every boundary to wire fakes.
    exclude: { path: '\\.test\\.ts$' },
  },
};
