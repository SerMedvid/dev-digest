import type { IconName } from "@devdigest/ui";
import type { Verdict, RiskLevel } from "@devdigest/shared";

/** Per-verdict visual meta. `labelKey` resolves under the `verdict` namespace. */
export const VERDICT_META: Record<
  Verdict,
  { c: string; bg: string; icon: IconName; labelKey: string }
> = {
  request_changes: {
    c: "var(--crit)",
    bg: "var(--crit-bg)",
    icon: "XCircle",
    labelKey: "requestChanges",
  },
  approve: { c: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle", labelKey: "approve" },
  comment: { c: "var(--info)", bg: "var(--info-bg)", icon: "MessageSquare", labelKey: "comment" },
};

/**
 * The brief's risk badge, tinted per level (L05).
 *
 * `low` is the neutral info tint rather than green: low risk is not an
 * approval, and painting it as one would let the badge overrule the verdict
 * beside it.
 */
export const RISK_BADGE: Record<RiskLevel, { color: string; bg: string }> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg)" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)" },
  low: { color: "var(--info)", bg: "var(--info-bg)" },
};
