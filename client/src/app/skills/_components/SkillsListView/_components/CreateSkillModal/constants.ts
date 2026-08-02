import type { SkillType } from "@devdigest/shared";

/**
 * Mirrors the server's limit in `modules/skills/constants.ts`. Duplicated on
 * purpose: the user should see the ceiling while typing rather than meeting it
 * as a 422 after pressing Save.
 */
export const MAX_SKILL_BODY_CHARS = 20_000;

export const SKILL_TYPES: SkillType[] = ["rubric", "convention", "security", "custom"];
