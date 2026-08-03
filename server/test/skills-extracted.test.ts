import { describe, it, expect, vi } from 'vitest';
import { SkillsService } from '../src/modules/skills/service.js';
import type { SkillsRepository } from '../src/modules/skills/repository.js';

/** A repo double: we only care about what `create` forwards to `insert`. */
function repoDouble() {
  const insert = vi.fn(async (values: Record<string, unknown>) => ({
    id: 'sk1',
    workspaceId: 'ws1',
    name: values.name,
    description: values.description,
    type: values.type,
    source: values.source ?? 'manual',
    body: values.body,
    enabled: true,
    version: 1,
    evidenceFiles: values.evidenceFiles ?? null,
    createdAt: new Date(),
  }));
  const repo = { insert, findByName: vi.fn(async () => undefined) };
  return { repo: repo as unknown as SkillsRepository, insert };
}

describe('SkillsService.create with a non-manual source', () => {
  it('defaults to manual with no evidence, exactly as before', async () => {
    const { repo, insert } = repoDouble();
    const skill = await new SkillsService(repo).create('ws1', {
      name: 'n',
      description: 'd',
      type: 'rubric',
      body: 'b',
    });
    expect(insert.mock.calls[0]![0]).not.toHaveProperty('source');
    expect(skill.source).toBe('manual');
  });

  it('forwards an extracted source and its evidence files', async () => {
    const { repo, insert } = repoDouble();
    const skill = await new SkillsService(repo).create('ws1', {
      name: 'payments-api-conventions',
      description: 'd',
      type: 'convention',
      body: 'b',
      source: 'extracted',
      evidenceFiles: ['src/a.ts', 'src/b.ts'],
    });
    expect(insert.mock.calls[0]![0]).toMatchObject({
      source: 'extracted',
      evidenceFiles: ['src/a.ts', 'src/b.ts'],
    });
    expect(skill.source).toBe('extracted');
    expect(skill.evidence_files).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
