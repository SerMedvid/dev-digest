import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

/**
 * Smart Diff module — a PR's changed files grouped by role, marked with
 * findings, with a split suggestion when it's too big to review as one.
 *   GET /pulls/:id/smart-diff  → the SmartDiff (404 on unknown/foreign PR)
 *
 * The service is built in the container so its ports (`store` over
 * `reviewRepo`, `repo` over `smartDiffRepo`) are composed in one place.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return container.smartDiffService.get(workspaceId, req.params.id);
  });
}
