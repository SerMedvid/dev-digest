import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * PR Why + Risk Brief — what the change is for, how far it reaches, and which
 * file to read first, composed from seven inputs in one structured call and
 * grounded in code before it is stored.
 *   GET  /pulls/:id/brief  → the stored PrBriefRecord for the PR's CURRENT
 *                            head. Never calls a model. 404 in two distinct
 *                            cases (see below).
 *   POST /pulls/:id/brief  → generate now, ALWAYS. 409 while one is in flight,
 *                            422 `brief_no_inputs` on a PR with no changed files.
 *
 * `POST` always regenerates, unlike `POST /pulls/:id/blast/summary`, which
 * serves its cache. This one is wired to an explicit refresh control, and a
 * button that silently returned a cached row would read as broken. The read
 * path is `GET`'s job, which is why `GET` exists at all: making the card `POST`
 * on mount would spend a model call on every page open.
 *
 * The service is built in the container so its ports (`store` over `reviewRepo`,
 * `briefs` over `briefRepo`, `blast` over `blastService`, `docs` over the intent
 * module's reader, `model` over the workspace's `risk_brief` choice) are
 * composed in one place.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/pulls/:id/brief', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const rec = await container.briefService.read(workspaceId, req.params.id);
    // Deliberately a different message from `requirePull`'s "Pull request not
    // found". Both are 404 and the two must not be collapsed: one means the PR
    // does not exist or is not yours, the other means it exists and simply has
    // no brief at this head — which is an empty state the card renders, not an
    // error it reports.
    if (!rec) throw new NotFoundError('No brief has been generated for this pull request state');
    return rec;
  });

  // Synchronous on purpose: one bounded call, nothing to stream, no job to
  // track — same shape as `blast/routes.ts`'s POST. No body: the inputs are
  // whatever the PR's current head yields, never caller-supplied.
  app.post('/pulls/:id/brief', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return container.briefService.generate(workspaceId, req.params.id);
  });
}
