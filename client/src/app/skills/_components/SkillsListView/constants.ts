import type { SkillType } from "@devdigest/shared";

/**
 * Chip colour per skill type. Security borrows the critical token so a security
 * rule reads as one at a glance; the rest map to the neutral scale.
 */
export const TYPE_COLOR: Record<SkillType, string> = {
  rubric: "var(--accent)",
  convention: "var(--info)",
  security: "var(--crit)",
  custom: "var(--text-secondary)",
};
