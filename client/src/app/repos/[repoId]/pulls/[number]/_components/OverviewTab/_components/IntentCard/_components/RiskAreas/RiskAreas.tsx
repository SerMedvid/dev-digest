"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { BriefRisk } from "@devdigest/shared";
import { s, severityIcon } from "./styles";

interface RiskAreasProps {
  risks: BriefRisk[] | null | undefined;
}

/**
 * The brief's risk list, inside the intent card and below its scope lists —
 * "what this PR is for" and "what could go wrong with it" are the same
 * question's two halves, and splitting them into two cards made the reader
 * hold one in their head while reading the other.
 *
 * Presentational only: it takes data and calls no hook. `OverviewTab` owns the
 * one `usePrBrief` call for the whole overview.
 *
 * Every `refs` entry shown here has already passed the server's grounding gate,
 * so a path rendered in this list is a path that really is in the pull request.
 */
export function RiskAreas({ risks }: RiskAreasProps) {
  const t = useTranslations("brief");
  const [open, setOpen] = React.useState<string | null>(null);

  // Nothing at all when there is nothing to show. An empty block under a
  // heading reads as a feature that failed rather than as a PR with no flagged
  // risks — and "no risks survived the gate" is already said by the brief card.
  if (!risks || risks.length === 0) return null;

  return (
    <div style={s.wrap}>
      <div style={s.heading}>
        <Icon.AlertTriangle size={12} />
        {t("risksTitle")}
      </div>
      <ul style={s.list}>
        {risks.map((risk) => {
          const expanded = open === risk.title;
          const sev = severityIcon[risk.severity];
          const SevIcon = Icon[sev.icon];
          return (
            <li key={risk.title} style={s.row}>
              <button
                type="button"
                style={s.toggle}
                aria-expanded={expanded}
                // The severity has no visible text, so it is announced here —
                // the icon's shape and colour carry it visually.
                aria-label={`${risk.title} — ${t(`risk.${risk.severity}`)}`}
                onClick={() => setOpen(expanded ? null : risk.title)}
              >
                <SevIcon size={14} style={{ color: sev.color, flexShrink: 0, marginTop: 2 }} />
                <span style={s.rowMain}>
                  <span style={s.title}>{risk.title}</span>
                  {/* Visible while collapsed: the refs are the row's evidence,
                      and every one has already passed the server's grounding
                      gate, so a path shown here really is in the pull request.
                      Hiding them made the risk a claim nobody could check
                      without a click. */}
                  {risk.refs.length > 0 && (
                    <span style={s.refs}>
                      {risk.refs.map((ref) => (
                        <span key={ref} style={s.ref}>
                          {ref}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <Icon.ChevronDown
                  size={14}
                  style={{
                    ...s.chevron,
                    transform: expanded ? "rotate(180deg)" : undefined,
                  }}
                />
              </button>
              {expanded && (
                <div style={s.body}>
                  <p style={s.explanation}>{risk.explanation}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
