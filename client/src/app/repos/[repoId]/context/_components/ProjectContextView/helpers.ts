/** Pure formatters for the Project Context screen. */

/**
 * Clock time for the footer's `scanned {time}`. Seconds are included on
 * purpose: AC-39 requires the stamp to move when the user rescans, and two
 * scans a few seconds apart would read identically at minute resolution.
 * An absent or unparseable stamp renders as nothing rather than
 * "Invalid Date".
 */
export function scanTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Whole-kilobyte size for a row label. Any non-empty file is at least 1kb, so
    a 400-byte spec does not read as "0kb". */
export function kbSize(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.max(1, Math.round(bytes / 1024));
}
