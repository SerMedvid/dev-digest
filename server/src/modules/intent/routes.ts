import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * Intent module — what a PR is trying to do, and on what evidence.
 *   GET  /pulls/:id/intent  → the stored PrIntentRecord (404 when none)
 *   POST /pulls/:id/intent  → derive now (409 while one is in flight)
 *
 * The service itself is built in the container: the review pre-work needs it
 * too, and two composition roots for one use-case is how they drift.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/pulls/:id/intent', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const rec = await container.intentService.get(workspaceId, req.params.id);
    if (!rec) throw new NotFoundError('No intent has been derived for this pull request');
    return rec;
  });

  // Synchronous on purpose: one bounded call, nothing to stream, no job to track.
  // There is no run on this path, so the composition facts go to pino only —
  // that is what `onLog` is for. Same fields as the run-log event, no diff,
  // ticket or plan CONTENT, and nothing from `container.secrets`.
  app.post('/pulls/:id/intent', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return container.intentService.derive(workspaceId, req.params.id, {
      onLog: (msg, data) =>
        app.log.info({ prId: req.params.id, ...(typeof data === 'object' && data ? data : {}) }, `intent: ${msg}`),
    });
  });
}
