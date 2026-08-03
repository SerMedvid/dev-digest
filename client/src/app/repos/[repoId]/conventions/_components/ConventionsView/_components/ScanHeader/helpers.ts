/** "1h ago" style stamp for the last finished scan. `now` is injected so the
    test does not depend on the clock. */
export function relativeTime(iso: string | null, now: Date): string {
  if (!iso) return "";
  const seconds = Math.floor((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
