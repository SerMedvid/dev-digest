/** Pure transforms shared by both project-context attachment editors. */

/**
 * Reorder the attached paths by moving one entry — the payload of the replace
 * a drag commits.
 *
 * Stored order is the order a review run assembles the documents in, so this
 * produces the complete new list rather than a diff: the wire contract for an
 * attachment change is a full replacement.
 */
export function moveAttached(paths: string[], from: number, to: number): string[] {
  if (from === to) return paths;
  const next = [...paths];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return paths;
  next.splice(to, 0, moved);
  return next;
}
