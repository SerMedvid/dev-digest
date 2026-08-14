/* Pure helpers for OnboardingTourView. */

/** Anchor id for a section, so the TOC can scroll to it. */
export function anchorFor(sectionId: string): string {
  return `tour-${sectionId}`;
}

/**
 * "2h ago" / "3 days ago" for the header stamp. Deliberately coarse: the exact
 * minute of a generated document is never what the reader wants to know.
 */
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((now - then) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** A section with nothing in it — every collection empty and no prose. */
export function isSectionEmpty(section: {
  body: string;
  diagram: string | null;
  files: unknown[];
  commands: unknown[];
  tasks: unknown[];
}): boolean {
  return (
    section.body.trim().length === 0 &&
    !section.diagram &&
    section.files.length === 0 &&
    section.commands.length === 0 &&
    section.tasks.length === 0
  );
}
