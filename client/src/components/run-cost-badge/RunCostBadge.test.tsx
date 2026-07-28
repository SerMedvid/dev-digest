/**
 * RunCostBadge — the state table from `client/specs/run-cost-display.md` §2.
 *
 * The load-bearing case is `null → "—"`. Review runs cost fractions of a cent,
 * so the old 2-decimal formatter rendered every real run as "$0.00"; a missing
 * price and a genuinely free run must stay distinguishable.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import runsMessages from "../../../messages/en/runs.json";
import { RunCostBadge } from "./RunCostBadge";
import { formatCost, formatTokenFlow, formatTokenTotal } from "./helpers";

afterEach(cleanup);

function renderBadge(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("formatCost", () => {
  it("renders an unknown cost as an em dash, never $0.00", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
  });

  it("distinguishes a genuinely free run from an unknown one", () => {
    expect(formatCost(0)).toBe("$0");
  });

  it("scales precision to the magnitude and trims trailing zeros", () => {
    expect(formatCost(0.0013)).toBe("$0.0013");
    expect(formatCost(0.001)).toBe("$0.001");
    expect(formatCost(0.014)).toBe("$0.014");
    expect(formatCost(0.06)).toBe("$0.06");
    expect(formatCost(1.5)).toBe("$1.5");
    expect(formatCost(12)).toBe("$12");
  });

  it("does not round a non-zero cost down to free", () => {
    expect(formatCost(0.00001)).toBe("<$0.0001");
  });
});

describe("token formatters", () => {
  it("sums to a separated total, or null when nothing is known", () => {
    expect(formatTokenTotal(9000, 119)).toBe("9,119");
    expect(formatTokenTotal(null, null)).toBeNull();
  });

  it("renders the in→out flow, including sub-1k values", () => {
    expect(formatTokenFlow(8200, 1300)).toBe("8.2k→1.3k");
    expect(formatTokenFlow(15000, 1200)).toBe("15k→1.2k");
    // The trace drawer's old local helper rendered these as "0k".
    expect(formatTokenFlow(840, 60)).toBe("840→60");
  });
});

describe("RunCostBadge", () => {
  it("compact shows the cost alone", () => {
    renderBadge(<RunCostBadge costUsd={0.014} />);
    expect(screen.getByText("$0.014")).toBeInTheDocument();
  });

  it("compact shows an em dash when the cost is unknown", () => {
    renderBadge(<RunCostBadge costUsd={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("detailed/total shows the token total next to the cost", () => {
    renderBadge(
      <RunCostBadge costUsd={0.0013} tokensIn={9000} tokensOut={119} variant="detailed" />,
    );
    expect(screen.getByText("9,119 tok")).toBeInTheDocument();
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
  });

  it("detailed/flow shows the in→out token flow", () => {
    renderBadge(
      <RunCostBadge
        costUsd={0.014}
        tokensIn={8200}
        tokensOut={1300}
        variant="detailed"
        tokens="flow"
      />,
    );
    expect(screen.getByText("8.2k→1.3k")).toBeInTheDocument();
    expect(screen.getByText("$0.014")).toBeInTheDocument();
  });

  it("still shows tokens when only the cost is unknown", () => {
    renderBadge(
      <RunCostBadge costUsd={null} tokensIn={9000} tokensOut={119} variant="detailed" />,
    );
    expect(screen.getByText("9,119 tok")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("omits the token segment entirely when neither side is known", () => {
    renderBadge(<RunCostBadge costUsd={0.02} variant="detailed" />);
    expect(screen.getByText("$0.02")).toBeInTheDocument();
    expect(screen.queryByText("·")).not.toBeInTheDocument();
  });
});
