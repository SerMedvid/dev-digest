import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

/**
 * Smart Diff module — a PR's changed files grouped by role, marked with
 * findings, with a split suggestion when it's too big to review as one.
 *   GET  /pulls/:id/smart-diff          → the SmartDiff (404 on unknown/foreign PR)
 *   POST /pulls/:id/smart-diff/summary  → derive (or serve cached) one file's
 *                                          on-demand summary (409 while one is
 *                                          in flight for that file)
 *
 * The service is built in the container so its ports (`store` over
 * `reviewRepo`, `repo` over `smartDiffRepo`, `model` over the workspace's
 * `file_summary` choice) are composed in one place.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return container.smartDiffService.get(workspaceId, req.params.id);
  });

  // Synchronous on purpose: one bounded call, nothing to stream, no job to
  // track — same shape as `intent/routes.ts`'s POST. Composition facts
  // (provider, model, chars in/out) are logged inside the service via its
  // `log` dep (the container hands it `app.log`), not here.
  app.post(
    '/pulls/:id/smart-diff/summary',
    { schema: { params: IdParams, body: z.object({ path: z.string().min(1) }) } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.smartDiffService.summarize(workspaceId, req.params.id, req.body.path);
    },
  );
}
