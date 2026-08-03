import type { SkillWithUsage } from "@devdigest/shared";

/** Filter the library by name or description. Empty query returns everything. */
export function filterSkills(skills: SkillWithUsage[], query: string): SkillWithUsage[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter(
    (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
  );
}
