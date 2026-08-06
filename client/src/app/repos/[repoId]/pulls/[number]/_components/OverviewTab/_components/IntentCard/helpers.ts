import type { PrIntentRecord } from "@devdigest/shared";
import { KNOWN_SOURCES, type KnownSource } from "./constants";

/** The intent is stale when it was derived against a different head commit. */
export function isStale(rec: PrIntentRecord, headSha: string): boolean {
  return Boolean(headSha) && rec.head_sha !== headSha;
}

function isKnownSource(s: string): s is KnownSource {
  return (KNOWN_SOURCES as readonly string[]).includes(s);
}

/** "title · description · changed files" — an issue or doc tag (no catalogue
 *  entry) passes through as-is. `label` looks up the translated string for a
 *  known tag (`prReview.intent.source.<tag>`). */
export function sourceLine(sources: string[], label: (tag: KnownSource) => string): string {
  return sources.map((s) => (isKnownSource(s) ? label(s) : s)).join(" · ");
}
