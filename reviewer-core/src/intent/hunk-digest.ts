import type { UnifiedDiff } from '@devdigest/shared';

/**
 * The classifier's view of a diff: which files changed, how much, and where —
 * never WHAT changed. Bodies are the expensive, sensitive part of a diff and the
 * intent question does not need them, so they are not merely truncated here,
 * they are never read.
 *
 * The caps keep a 200-file PR from dominating the prompt; both are reported so a
 * truncated digest is never mistaken for a complete one.
 */
const MAX_FILES = 60;
const MAX_HUNKS_PER_FILE = 12;

export function hunkHeaderDigest(diff: UnifiedDiff): string {
  const lines: string[] = [];
  for (const f of diff.files.slice(0, MAX_FILES)) {
    lines.push(`${f.path} (+${f.additions} -${f.deletions})`);
    for (const h of f.hunks.slice(0, MAX_HUNKS_PER_FILE)) {
      lines.push(`  @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    }
    const hidden = f.hunks.length - MAX_HUNKS_PER_FILE;
    if (hidden > 0) lines.push(`  … ${hidden} more hunk(s)`);
  }
  const hiddenFiles = diff.files.length - MAX_FILES;
  if (hiddenFiles > 0) lines.push(`… ${hiddenFiles} more file(s)`);
  return lines.join('\n');
}
