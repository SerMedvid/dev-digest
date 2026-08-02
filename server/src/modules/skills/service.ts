import type { Skill, SkillType, SkillVersion, SkillWithUsage } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import type { SkillsRepository } from './repository.js';
import { toSkillDto, toSkillVersionDto } from './helpers.js';

/**
 * Skills business logic. A skill is reusable prompt text: many agents can link
 * the same one, and editing it changes every review that uses it.
 *
 * Takes its repository, NOT the Container — a service that imports the
 * composition root closes an import cycle (see server/INSIGHTS.md).
 */

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  /** Note attached to the version this save creates; ignored if body is unchanged. */
  summary?: string;
}

export class SkillsService {
  constructor(private repo: SkillsRepository) {}

  async list(workspaceId: string): Promise<SkillWithUsage[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map((r) => ({ ...toSkillDto(r.skill), agent_count: r.agentCount }));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    await this.assertNameFree(workspaceId, input.name);
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      body: input.body,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    if (patch.name !== undefined) await this.assertNameFree(workspaceId, patch.name, id);
    const row = await this.repo.update(
      workspaceId,
      id,
      {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      },
      patch.summary,
    );
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** Version history, newest first. undefined when the skill isn't in this workspace. */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(id);
    return rows.map(toSkillVersionDto);
  }

  /**
   * Restore an old body by APPENDING it as a new version. History is
   * append-only: nothing is rewritten, and the restore itself is auditable.
   */
  async restore(workspaceId: string, id: string, version: number): Promise<Skill | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const snapshot = await this.repo.getVersion(id, version);
    if (!snapshot) return undefined;
    const row = await this.repo.update(
      workspaceId,
      id,
      { body: snapshot.body },
      `Restored from v${version}`,
    );
    return row ? toSkillDto(row) : undefined;
  }

  /** Names are how a user identifies a skill in the agent editor — keep them unique. */
  private async assertNameFree(workspaceId: string, name: string, exceptId?: string) {
    const clash = await this.repo.findByName(workspaceId, name);
    if (clash && clash.id !== exceptId) {
      throw new ValidationError(`A skill named "${name}" already exists`);
    }
  }
}
