import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

/**
 * Blast radius module — which symbols a PR changed, who calls them, and what
 * sits downstream, read entirely from the persisted index.
 *   GET  /pulls/:id/blast          → the BlastRadiusResponse. Never calls a
 *                                     model. 404 on unknown/foreign PR.
 *   POST /pulls/:id/blast/summary  → derive (or serve cached) the one-paragraph
 *                                     explanation. 409 while one is in flight,
 *                                     422 `blast_degraded` on a map with no
 *                                     data to explain.
 *   GET  /pulls/:id/prior-prs      → merged/closed PRs that touched the same
 *                                     files, read from `pr_files` alone.
 *
 * The service is built in the container so its ports (`store` over `reviewRepo`,
 * `intel` over `repoIntel`, `summaries` over `blastRepo`, `model` over the
 * workspace's `blast_summary` choice) are composed in one place.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/pulls/:id/blast', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return container.blastService.get(workspaceId, req.params.id);
  });

  /**
   * Which merged or closed PRs have already been in this PR's files. Read from
   * `pr_files` only — no index, no model, no GitHub call — so it answers even
   * when the blast map itself is degraded.
   */
  app.get('/pulls/:id/prior-prs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return container.blastService.priorPrs(workspaceId, req.params.id);
  });

  // Synchronous on purpose: one bounded call, nothing to stream, no job to
  // track — same shape as `smart-diff/routes.ts`'s POST. No body: the map to
  // explain is whatever the PR's current head yields, never caller-supplied.
  app.post('/pulls/:id/blast/summary', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return container.blastService.summarize(workspaceId, req.params.id);
  });
}
