import type { SkillWithUsage } from "@devdigest/shared";

export interface SkillRowModel {
  skill: SkillWithUsage;
  linked: boolean;
}

/**
 * Linked skills first, in the order the agent stores; unlinked skills after
 * them, alphabetical. Only linked rows have an order to preserve, so the list
 * never has to invent one for the rest.
 */
export function orderRows(skills: SkillWithUsage[], linkedIds: string[]): SkillRowModel[] {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const linked = linkedIds
    .map((id) => byId.get(id))
    .filter((s): s is SkillWithUsage => s !== undefined)
    .map((skill) => ({ skill, linked: true }));
  const linkedSet = new Set(linked.map((r) => r.skill.id));
  const rest = skills
    .filter((s) => !linkedSet.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => ({ skill, linked: false }));
  return [...linked, ...rest];
}

/** Reorder the linked ids by moving one entry. */
export function moveLinked(linkedIds: string[], from: number, to: number): string[] {
  if (from === to) return linkedIds;
  const next = [...linkedIds];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return linkedIds;
  next.splice(to, 0, moved);
  return next;
}
