/* SeverityCounters — the badge cluster on its own: presentational, no card, no
   interaction. Severity is never colour alone; each badge pairs the icon with a
   count, matching the SeverityBadge convention. */
"use client";

import { SeverityBadge, type Severity } from "@devdigest/ui";
import type { PrFindingsBySeverity } from "@devdigest/shared";
import { severityMeta, shownSeverities } from "../helpers";
import { s } from "../styles";

/** Renders nothing when every severity is zero.
 *  `hovered` is owned by whatever wraps this — the cluster has no pointer
 *  handlers of its own, because the click target is the trigger around it and
 *  hovering that (padding included) must light the badges up. */
export function SeverityCounters({
  counts,
  hovered = false,
}: {
  counts: PrFindingsBySeverity;
  hovered?: boolean;
}) {
  const shown = shownSeverities(counts);
  if (shown.length === 0) return null;
  return (
    <span style={s.counters(hovered)}>
      {shown.map((sev) => (
        <span key={sev} style={s.badgeWrap(severityMeta(sev).c, hovered)}>
          <SeverityBadge severity={sev as Severity} count={counts[sev]} compact />
        </span>
      ))}
    </span>
  );
}

export default SeverityCounters;
