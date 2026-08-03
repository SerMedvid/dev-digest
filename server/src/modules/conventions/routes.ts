import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionStatus, FEATURE_MODELS, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EXTRACT_JOB_KIND } from './constants.js';
import { ConventionsModel } from './model.js';
import { CloneSampler } from './sampler.js';
import { ConventionsService } from './service.js';
import type { ConventionsServiceDeps } from './ports.js';

/**
 * Conventions module — extract house rules from a cloned repo and turn the
 * accepted ones into a skill.
 *   POST  /repos/:id/conventions/extract      → 202 + jobId (409 if in flight)
 *   GET   /repos/:id/conventions              → { scan, candidates } (poll target)
 *   PATCH /conventions/:id                    → accept / reject / edit
 *   GET   /repos/:id/conventions/skill-draft  → the merged body + token estimate
 *   POST  /repos/:id/conventions/skill        → create (+ optionally link an agent)
 *
 * This file is the composition root for the module: it assembles the service's
 * ports off the container and registers the job handler once at boot, the same
 * shape as repo-intel's `registerIndexJobHandlers`.
 */

/**
 * The default when the workspace has chosen nothing, taken from the registry
 * rather than restated here. A module-local constant is what let this feature
 * run deepseek while the Settings screen — which renders `defaultModel` from
 * this same registry — advertised something else.
 */
const REGISTRY_DEFAULT = FEATURE_MODELS.find((f) => f.id === 'conventions')!;
const DEFAULT_MODEL = {
  provider: REGISTRY_DEFAULT.defaultProvider,
  model: REGISTRY_DEFAULT.defaultModel,
};

const PatchBody = z
  .object({
    status: ConventionStatus.optional(),
    rule: z.string().min(1).max(300).optional(),
    evidence_path: z.string().min(1).max(400).optional(),
    evidence_line: z.number().int().positive().optional(),
    evidence_snippet: z.string().max(2000).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Patch cannot be empty' });

const CreateSkillBody = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  type: SkillType,
  body: z.string().min(1).max(20_000),
  enabled: z.boolean().optional(),
  agent_id: z.string().uuid().optional(),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  /** Ports, assembled here so the service itself never sees the container. */
  function buildDeps(): ConventionsServiceDeps {
    return {
      repo: container.conventionsRepo,
      sampler: new CloneSampler(),
      repoIntel: {
        getTopFilesByRank: (repoId, n) => container.repoIntel.getTopFilesByRank(repoId, n),
      },
      model: async (workspaceId) => {
        const choice =
          (await container.conventionsRepo.featureModelChoice(workspaceId)) ?? DEFAULT_MODEL;
        const llm = await container.llm(choice.provider);
        return new ConventionsModel(llm, choice.provider, choice.model);
      },
      skills: {
        createExtracted: async (workspaceId, input) =>
          container.skillsService.create(workspaceId, {
            name: input.name,
            description: input.description,
            type: input.type,
            body: input.body,
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            source: 'extracted',
            evidenceFiles: input.evidenceFiles,
          }),
        // `AgentsRepository.linkSkill` takes no workspace and applies no
        // predicate — the scoping lives in `AgentsService.linkSkill`, which
        // this module cannot import (no-cross-module-internals). So the check
        // is made here, against the workspace-scoped `getById`.
        assertAgent: async (workspaceId, agentId) => {
          const agent = await container.agentsRepo.getById(workspaceId, agentId);
          if (!agent) throw new NotFoundError('Agent not found');
        },
        linkToAgent: async (agentId, skillId) => {
          const linked = await container.agentsRepo.linkedSkills(agentId);
          await container.agentsRepo.linkSkill(agentId, skillId, linked.length);
        },
        deleteSkill: async (workspaceId, skillId) => {
          await container.skillsService.delete(workspaceId, skillId);
        },
      },
      tokenCount: (text) => container.tokenizer.count(text),
      logger: app.log,
    };
  }

  const service = new ConventionsService(buildDeps());

  // Registered once at boot so a job enqueued by the route has a handler.
  container.jobs.register(EXTRACT_JOB_KIND, async (payload) => {
    const { workspaceId, repoId } = payload as { workspaceId: string; repoId: string };
    await service.runScan(workspaceId, repoId);
  });

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      // Throws 404 for an unknown repo and 409 when a scan is already in flight.
      await service.requestScan(workspaceId, req.params.id);
      const job = await container.jobs.enqueue(workspaceId, EXTRACT_JOB_KIND, {
        workspaceId,
        repoId: req.params.id,
      });
      reply.code(202);
      return { status: 'accepted', jobId: job.id };
    },
  );

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.view(workspaceId, req.params.id);
  });

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: PatchBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const b = req.body;
      return service.patchCandidate(workspaceId, req.params.id, {
        ...(b.status !== undefined ? { status: b.status } : {}),
        ...(b.rule !== undefined ? { rule: b.rule } : {}),
        ...(b.evidence_path !== undefined ? { evidencePath: b.evidence_path } : {}),
        ...(b.evidence_line !== undefined ? { evidenceLine: b.evidence_line } : {}),
        ...(b.evidence_snippet !== undefined ? { evidenceSnippet: b.evidence_snippet } : {}),
      });
    },
  );

  app.get(
    '/repos/:id/conventions/skill-draft',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.skillDraft(workspaceId, req.params.id);
    },
  );

  app.post(
    '/repos/:id/conventions/skill',
    { schema: { params: IdParams, body: CreateSkillBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const created = await service.createSkill(workspaceId, req.params.id, {
        name: req.body.name,
        description: req.body.description ?? '',
        type: req.body.type,
        body: req.body.body,
        ...(req.body.enabled !== undefined ? { enabled: req.body.enabled } : {}),
        ...(req.body.agent_id !== undefined ? { agentId: req.body.agent_id } : {}),
      });
      reply.code(201);
      // Return the full skill so the client can navigate straight to it.
      return container.skillsService.get(workspaceId, created.id);
    },
  );
}
