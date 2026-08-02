/* FindingRow — one finding inside the breakdown card. Same shape whichever
   surface fed it (list preview or a run's own findings), because both sides
   normalise to BreakdownFinding first.

   Both of the row's exits are optional and independent: `onOpen` needs a
   surface that knows where the PR detail page is, `href` needs the repo's
   owner/repo. A surface that has neither still gets the original static row. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, CategoryTag, ConfidenceNum, type Category } from "@devdigest/ui";
import { lineLabel, severityMeta, type BreakdownFinding } from "../helpers";
import { s } from "../styles";

export function FindingRow({
  f,
  href,
  onOpen,
}: {
  f: BreakdownFinding;
  /** The file's location inside the PR's diff on GitHub. */
  href?: string;
  /** Jump to this finding on the PR detail page. */
  onOpen?: (findingId: string) => void;
}) {
  const t = useTranslations("prReview");
  const sev = severityMeta(f.severity);
  const SevIcon = Icon[sev.icon];
  const [hoverTitle, setHoverTitle] = React.useState(false);
  const [hoverFile, setHoverFile] = React.useState(false);
  const location = `${f.file}:${lineLabel(f)}`;

  return (
    <div style={s.findingRow}>
      <SevIcon size={13} style={s.sevIcon(sev.c)} />
      <div style={s.findingMain}>
        <div style={s.titleRow}>
          {onOpen ? (
            <button
              type="button"
              title={t("findings.goToFinding")}
              onClick={() => onOpen(f.id)}
              onMouseEnter={() => setHoverTitle(true)}
              onMouseLeave={() => setHoverTitle(false)}
              style={s.titleButton(hoverTitle)}
            >
              {f.title}
            </button>
          ) : (
            <span style={s.title}>{f.title}</span>
          )}
          {/* Renders nothing for a category outside the known set. */}
          <CategoryTag category={f.category as Category} />
        </div>
        <div style={s.metaRow}>
          {href ? (
            <a
              className="mono"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={t("findings.openInPr")}
              onMouseEnter={() => setHoverFile(true)}
              onMouseLeave={() => setHoverFile(false)}
              style={s.locationLink(hoverFile)}
            >
              {location}
            </a>
          ) : (
            <span className="mono" style={s.location}>
              {location}
            </span>
          )}
          <ConfidenceNum value={f.confidence} />
        </div>
        {f.snippet && <div style={s.snippet}>{f.snippet}</div>}
      </div>
    </div>
  );
}

export default FindingRow;
