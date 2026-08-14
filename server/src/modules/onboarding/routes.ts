import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { fsClone } from './clone.js';
import { DEFAULT_MODEL, GENERATE_JOB_KIND } from './constants.js';
import { OnboardingModel } from './model.js';
import { OnboardingService } from './service.js';
import type { OnboardingServiceDeps } from './ports.js';

/**
 * Onboarding module — the per-repo guided tour.
 *   GET  /repos/:id/onboarding           → the view (poll target)
 *   POST /repos/:id/onboarding/generate  → 202 + jobId (409 if in flight)
 *
 * This file is the composition root for the module: it assembles the service's
 * ports off the container and registers the job handler once at boot, the same
 * shape as conventions.
 */
export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  /** Ports, assembled here so the service itself never sees the container. */
  function buildDeps(): OnboardingServiceDeps {
    return {
      repo: container.onboardingRepo,
      // The facade's own types carry degradation fields this module does not
      // branch on, so the port is narrowed to what the tour actually reads.
      repoIntel: {
        getIndexState: async (repoId) => {
          const state = await container.repoIntel.getIndexState(repoId);
          return { lastIndexedSha: state.lastIndexedSha, filesIndexed: state.filesIndexed };
        },
        getTopFilesByRank: (repoId, n) => container.repoIntel.getTopFilesByRank(repoId, n),
        getFileRank: (repoId, paths) => container.repoIntel.getFileRank(repoId, paths),
        getRepoMap: async (repoId, budget) => {
          const map = await container.repoIntel.getRepoMap(repoId, budget);
          return { text: map.text };
        },
        getCriticalPaths: (repoId) => container.repoIntel.getCriticalPaths(repoId),
      },
      clone: fsClone,
      model: async (workspaceId) => {
        const choice =
          (await container.onboardingRepo.featureModelChoice(workspaceId)) ?? DEFAULT_MODEL;
        const llm = await container.llm(choice.provider);
        return new OnboardingModel(llm, choice.provider, choice.model);
      },
      logger: app.log,
    };
  }

  const service = new OnboardingService(buildDeps());

  // Registered once at boot so a job enqueued by the route has a handler.
  container.jobs.register(GENERATE_JOB_KIND, async (payload) => {
    const { workspaceId, repoId } = payload as { workspaceId: string; repoId: string };
    await service.runGenerate(workspaceId, repoId);
  });

  app.get('/repos/:id/onboarding', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.view(workspaceId, req.params.id);
  });

  app.post(
    '/repos/:id/onboarding/generate',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      // Throws 404 for an unknown repo and 409 when a generation is in flight.
      await service.requestGenerate(workspaceId, req.params.id);
      const job = await container.jobs.enqueue(workspaceId, GENERATE_JOB_KIND, {
        workspaceId,
        repoId: req.params.id,
      });
      reply.code(202);
      return { status: 'accepted', jobId: job.id };
    },
  );
}
