import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ContextAttachmentsUpdate,
  type ContextAttachmentsView,
  type ContextDocContent,
  type ContextDocList,
  type ContextPreview,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { MAX_PATH_CHARS } from './constants.js';

/**
 * Project context module — the markdown documents discovered under a
 * repository's configured `context_roots`, and which of them an agent or a
 * skill reads during a review.
 *   GET /repos/:repoId/context             → ContextDocList (200 + `no_clone`
 *                                            when the repo has no clone; never
 *                                            a 5xx)
 *   GET /repos/:repoId/context/doc?path=   → ContextDocContent (read-only preview)
 *   GET /agents/:agentId/context?repoId=   → ContextAttachmentsView
 *   PUT /agents/:agentId/context           → replace the agent's set, return the view
 *   GET /skills/:skillId/context?repoId=   → ContextAttachmentsView
 *   PUT /skills/:skillId/context           → replace the skill's set, return the view
 *   GET /skills/:skillId/context/preview   → ContextPreview (the `specs` block)
 *
 * Two things about this file are load-bearing.
 *
 *  - **Everything goes through `container.projectContext`, never
 *    `container.projectContextRepo`.** Two repository methods
 *    (`attachmentsFor`, `resolveForRun`) take no `workspaceId` and trust their
 *    caller; the service is what resolves an owner workspace-scoped first. A
 *    handler wired straight onto `attachmentsFor(kind, req.params.agentId, …)`
 *    would be an IDOR, which is why no route here touches the repository.
 *  - **Ids are `uuid` at the edge, then scoped by `workspaceId` in the
 *    service.** A malformed id is a 422 from these schemas; a well-formed id
 *    belonging to another workspace is a `NotFoundError` from the service — a
 *    404, never a 403, so the API does not confirm that the row exists (AC-14).
 *
 * The service itself is composed in `platform/container.ts`, not here: the
 * review run resolves documents through the same instance, and two composition
 * roots for one use-case is how they drift.
 */

/** `:repoId`, `:agentId`, `:skillId` — a non-uuid is a 422, not a downstream 404. */
const RepoParams = z.object({ repoId: z.string().uuid() });
const AgentParams = z.object({ agentId: z.string().uuid() });
const SkillParams = z.object({ skillId: z.string().uuid() });

/** Which repository's documents an owner-scoped view is about. */
const RepoQuery = z.object({ repoId: z.string().uuid() });

/**
 * The document to preview. Length-bounded here so an absurd path never reaches
 * the filesystem confinement at all; containment itself is the reader's job
 * (lexical, then `realpath`), never this schema's.
 */
const DocQuery = z.object({ path: z.string().min(1).max(MAX_PATH_CHARS) });

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get(
    '/repos/:repoId/context',
    { schema: { params: RepoParams } },
    async (req): Promise<ContextDocList> => {
      const { workspaceId } = await getContext(container, req);
      return container.projectContext.listDocuments(workspaceId, req.params.repoId);
    },
  );

  app.get(
    '/repos/:repoId/context/doc',
    { schema: { params: RepoParams, querystring: DocQuery } },
    async (req): Promise<ContextDocContent> => {
      const { workspaceId } = await getContext(container, req);
      return container.projectContext.readDocument(
        workspaceId,
        req.params.repoId,
        req.query.path,
      );
    },
  );

  app.get(
    '/agents/:agentId/context',
    { schema: { params: AgentParams, querystring: RepoQuery } },
    async (req): Promise<ContextAttachmentsView> => {
      const { workspaceId } = await getContext(container, req);
      return container.projectContext.attachmentsForAgent(
        workspaceId,
        req.params.agentId,
        req.query.repoId,
      );
    },
  );

  // A replace, not a patch: the body is the whole set for one repository, in
  // the order the editor shows it, and the response is the freshly recomputed
  // view so the client reconciles in one round trip.
  //
  // `expected_version` makes it a compare-and-set. A whole-set replace computed
  // from a stale snapshot deletes whatever landed in between, so when the body
  // carries the version it believed it was replacing and that version has moved,
  // the service answers 409 rather than applying it. Omitting the field is
  // allowed and keeps the previous behaviour — the flag lives in the body
  // because it belongs to the same edit, not in an `If-Match` header this API
  // uses nowhere else.
  app.put(
    '/agents/:agentId/context',
    { schema: { params: AgentParams, body: ContextAttachmentsUpdate } },
    async (req): Promise<ContextAttachmentsView> => {
      const { workspaceId } = await getContext(container, req);
      return container.projectContext.setAttachments(
        workspaceId,
        { kind: 'agent', id: req.params.agentId },
        req.body.repo_id,
        req.body.paths,
        req.body.expected_version,
      );
    },
  );

  app.get(
    '/skills/:skillId/context',
    { schema: { params: SkillParams, querystring: RepoQuery } },
    async (req): Promise<ContextAttachmentsView> => {
      const { workspaceId } = await getContext(container, req);
      return container.projectContext.attachmentsForSkill(
        workspaceId,
        req.params.skillId,
        req.query.repoId,
      );
    },
  );

  app.put(
    '/skills/:skillId/context',
    { schema: { params: SkillParams, body: ContextAttachmentsUpdate } },
    async (req): Promise<ContextAttachmentsView> => {
      const { workspaceId } = await getContext(container, req);
      return container.projectContext.setAttachments(
        workspaceId,
        { kind: 'skill', id: req.params.skillId },
        req.body.repo_id,
        req.body.paths,
        req.body.expected_version,
      );
    },
  );

  /**
   * What the run would actually inject: the same documents, read by the same
   * capped reader and serialised by the same `wrapUntrusted` the prompt uses, so
   * the preview cannot drift from the prompt (AC-49).
   */
  app.get(
    '/skills/:skillId/context/preview',
    { schema: { params: SkillParams, querystring: RepoQuery } },
    async (req): Promise<ContextPreview> => {
      const { workspaceId } = await getContext(container, req);
      return container.projectContext.previewForSkill(
        workspaceId,
        req.params.skillId,
        req.query.repoId,
      );
    },
  );
}
