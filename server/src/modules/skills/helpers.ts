import type { Skill, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';

/**
 * Pure helpers for the skills module — row ⇄ DTO mapping and the version-bump
 * rule.
 *
 * The row shapes are declared STRUCTURALLY rather than imported. `db/rows.ts`
 * is persistence, and `helpers.ts` is a core-ring file that `core-no-persistence`
 * forbids from importing `src/db/`; importing them from `repository.ts` instead
 * would close a cycle, since the repository imports `isBodyChange` from here.
 * The real `SkillRow` / `SkillVersionRow` satisfy these, so the call sites in
 * the repository and service type-check unchanged.
 */

/** The `skills` columns the DTO mapping reads. */
export interface SkillRowShape {
  id: string;
  name: string;
  description: string;
  type: string;
  source: string;
  body: string;
  enabled: boolean;
  version: number;
  evidenceFiles: string[] | null;
}

/** The `skill_versions` columns the DTO mapping reads. */
export interface SkillVersionRowShape {
  skillId: string;
  version: number;
  summary: string | null;
  body: string;
  createdAt: Date;
}

export function toSkillDto(row: SkillRowShape): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

export function toSkillVersionDto(row: SkillVersionRowShape): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    summary: row.summary,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * Only a changed `body` creates a new version. Renames, retypes, description
 * edits and the enabled toggle do not — `skill_versions` stores bodies, so a
 * version with an identical body would carry no information.
 */
export function isBodyChange(existing: { body: string }, patch: { body?: string }): boolean {
  return patch.body !== undefined && patch.body !== existing.body;
}
