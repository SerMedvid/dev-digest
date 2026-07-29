/* FindingRow — one finding inside the breakdown card. Same shape whichever
   surface fed it (list preview or a run's own findings), because both sides
   normalise to BreakdownFinding first. */
"use client";

import { Icon, CategoryTag, ConfidenceNum, type Category } from "@devdigest/ui";
import { lineLabel, severityMeta, type BreakdownFinding } from "../helpers";
import { s } from "../styles";

export function FindingRow({ f }: { f: BreakdownFinding }) {
  const sev = severityMeta(f.severity);
  const SevIcon = Icon[sev.icon];
  return (
    <div style={s.findingRow}>
      <SevIcon size={13} style={s.sevIcon(sev.c)} />
      <div style={s.findingMain}>
        <div style={s.titleRow}>
          <span style={s.title}>{f.title}</span>
          {/* Renders nothing for a category outside the known set. */}
          <CategoryTag category={f.category as Category} />
        </div>
        <div style={s.metaRow}>
          <span className="mono" style={s.location}>
            {f.file}:{lineLabel(f)}
          </span>
          <ConfidenceNum value={f.confidence} />
        </div>
        {f.snippet && <div style={s.snippet}>{f.snippet}</div>}
      </div>
    </div>
  );
}

export default FindingRow;
