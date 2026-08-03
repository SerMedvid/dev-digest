import type { SkillType } from "@devdigest/shared";

/** Same order as the Skills library's own selector. */
export const SKILL_TYPES: SkillType[] = ["rubric", "convention", "security", "custom"];

/** Matches the server's body limit (specs/skills.md). */
export const MAX_SKILL_BODY_CHARS = 20_000;
