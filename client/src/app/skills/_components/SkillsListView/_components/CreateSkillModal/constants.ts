import type { SkillType } from "@devdigest/shared";

/**
 * Mirrors the server's limit in `modules/skills/constants.ts`. Duplicated on
 * purpose: the user should see the ceiling while typing rather than meeting it
 * as a 422 after pressing Save.
 */
export const MAX_SKILL_BODY_CHARS = 20_000;

export const SKILL_TYPES: SkillType[] = ["rubric", "convention", "security", "custom"];

/** The two creation sources that have a server behind them. */
export const CREATE_SKILL_TABS = ["create", "file"] as const;
export type CreateSkillTab = (typeof CREATE_SKILL_TABS)[number];

/**
 * Markdown only. A `.zip` bundle would need unzipping plus a manifest format,
 * neither of which exists on either side.
 */
export const SKILL_FILE_ACCEPT = ".md,.markdown,text/markdown";
