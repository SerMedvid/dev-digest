/** Formatters for run spend. Shared: the trace drawer imports `formatCost`
 *  directly for its COST stat tile rather than rendering the badge. */

/** Shown wherever a number is genuinely unknown — never "$0.00". */
export const NO_VALUE = "—";

/**
 * USD cost, with precision that scales to the magnitude.
 *
 * Review runs cost fractions of a cent, so a fixed 2-decimal format (what this
 * screen used to do) collapses every real run to "$0.00". Trailing zeros are
 * trimmed so 0.06 reads "$0.06", not "$0.060".
 *
 * `null`/`undefined` mean the model's price is unknown (or the run failed) and
 * render as "—". Zero is a REAL measurement — a free-tier model — and renders
 * as "$0". The two must stay distinguishable.
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return NO_VALUE;
  if (usd === 0) return "$0";
  const abs = Math.abs(usd);
  // Non-zero but below the finest precision we print: say so, rather than
  // rounding down to "$0" and claiming the run was free.
  if (abs < 0.0001) return "<$0.0001";
  const decimals = abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
  const trimmed = usd.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
  return `$${trimmed}`;
}

/** Compact token count: 9119 → "9.1k", 15000 → "15k", 840 → "840". */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  const k = tokens / 1000;
  const s = (k >= 10 ? k.toFixed(0) : k.toFixed(1)).replace(/\.0$/, "");
  return `${s}k`;
}

/**
 * Total tokens with a thousands separator, e.g. "9,119". The unit that follows
 * it is a translated string, so it is NOT baked in here.
 * Returns null when neither side is known, so the caller can omit the segment.
 */
export function formatTokenTotal(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string | null {
  if (tokensIn == null && tokensOut == null) return null;
  const total = (tokensIn ?? 0) + (tokensOut ?? 0);
  return total.toLocaleString("en-US");
}

/**
 * Token in→out flow, e.g. "8.2k→1.3k". Returns null when neither side is known.
 * (Supersedes the trace drawer's local `formatTokens`, which rendered anything
 * under 1000 tokens as "0k".)
 */
export function formatTokenFlow(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string | null {
  if (tokensIn == null && tokensOut == null) return null;
  return `${formatTokenCount(tokensIn ?? 0)}→${formatTokenCount(tokensOut ?? 0)}`;
}
