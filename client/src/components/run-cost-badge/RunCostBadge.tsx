/* RunCostBadge — what one review run (or, on the PR list, a whole PR) cost.
   Read-only; renders as mono text rather than a filled pill, matching the
   COST column, the run timeline and the verdict banner in the designs.

   The one rule that matters: an unknown cost renders "—", never "$0.00".
   A genuinely free model renders "$0". See helpers.formatCost. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { formatCost, formatTokenFlow, formatTokenTotal } from "./helpers";
import { s } from "./styles";

export function RunCostBadge({
  costUsd,
  tokensIn,
  tokensOut,
  variant = "compact",
  tokens = "total",
  style,
}: {
  costUsd: number | null | undefined;
  tokensIn?: number | null;
  tokensOut?: number | null;
  /** `compact` = cost only. `detailed` = tokens · cost. */
  variant?: "compact" | "detailed";
  /** Detailed only: `total` → "9,119 tok", `flow` → "8.2k→1.3k". */
  tokens?: "total" | "flow";
  style?: React.CSSProperties;
}) {
  const t = useTranslations("runs");
  const cost = formatCost(costUsd);

  if (variant === "compact") {
    return (
      <span className="mono tnum" style={{ ...s.plain, ...s.cost, ...style }}>
        {cost}
      </span>
    );
  }

  const tokenText =
    tokens === "flow"
      ? formatTokenFlow(tokensIn, tokensOut)
      : formatTokenTotal(tokensIn, tokensOut);

  return (
    <span className="mono tnum" style={{ ...s.plain, ...style }}>
      {tokenText && (
        <>
          <span>
            {tokens === "total" ? t("cost.tokensTotal", { tokens: tokenText }) : tokenText}
          </span>
          <span style={s.sep}>·</span>
        </>
      )}
      <span style={s.cost}>{cost}</span>
    </span>
  );
}

export default RunCostBadge;
