/** Constants for CodeLine. */
import type { IconName } from "@devdigest/ui";
import type { Severity } from "@devdigest/shared";

/**
 * Icon per severity, mirroring the design system's own `SEV` token map so a
 * line chip and a `SeverityBadge` elsewhere on the page never disagree about
 * what a severity looks like. Restated rather than imported because `SEV` is
 * keyed by the vendored UI's `Severity` (which carries an extra `INFO` case)
 * — the shared contract's three are what a finding can actually be.
 *
 * The icon is not decoration: it is what keeps the chip legible without
 * colour, the same rule `SeverityBadge` states ("never colour alone").
 */
export const SEVERITY_ICON: Record<Severity, IconName> = {
  CRITICAL: "AlertOctagon",
  WARNING: "AlertTriangle",
  SUGGESTION: "Lightbulb",
};

/**
 * i18n key (under `shell.diffViewer.`) for the word a line's severity chip
 * shows. The stored severities are the review pipeline's own vocabulary; what
 * a reviewer reads on the line is the reviewer-facing one, so `CRITICAL`
 * renders as "blocker". Mapped here rather than in the component so the two
 * vocabularies stay visibly connected in one place.
 */
export const SEVERITY_LABEL_KEY: Record<Severity, string> = {
  CRITICAL: "diffViewer.severityBlocker",
  WARNING: "diffViewer.severityWarning",
  SUGGESTION: "diffViewer.severitySuggestion",
};
