import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import briefMessages from "../../../../../../../../../../../../messages/en/brief.json";
import { RiskAreas } from "./RiskAreas";

const RISKS = [
  {
    title: "Committed secret",
    explanation: "A live Stripe key is in the diff and must be rotated.",
    severity: "high" as const,
    refs: ["src/config.ts", "GET /api/public/items"],
  },
  {
    title: "Limiter fronts every public route",
    explanation: "A wrong ceiling returns 429 across all of them.",
    severity: "medium" as const,
    refs: ["src/middleware/ratelimit.ts"],
  },
];

afterEach(cleanup);

function renderRisks(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("RiskAreas", () => {
  it("renders one row per risk, with its refs visible while collapsed (AC-14)", () => {
    renderRisks(<RiskAreas risks={RISKS} />);

    expect(screen.getByText("Committed secret")).toBeTruthy();
    expect(screen.getByText("Limiter fronts every public route")).toBeTruthy();
    // The refs are the row's evidence and stay visible: every one has already
    // passed the server's grounding gate, so a path shown here really is in the
    // pull request. Hiding them made the risk a claim nobody could check.
    expect(screen.getByText("src/config.ts")).toBeTruthy();
    expect(screen.getByText("GET /api/public/items")).toBeTruthy();
  });

  it("announces severity even though no severity text is rendered", () => {
    renderRisks(<RiskAreas risks={RISKS} />);
    // The icon's shape and colour carry it visually — never colour alone — and
    // the level rides on the toggle's accessible name.
    expect(screen.getByRole("button", { name: /Committed secret — High risk/ })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Limiter fronts every public route — Medium risk/ }),
    ).toBeTruthy();
  });

  it("keeps only the explanation collapsed until the row is expanded", () => {
    renderRisks(<RiskAreas risks={RISKS} />);

    expect(screen.queryByText(RISKS[0]!.explanation)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Committed secret/ }));

    expect(screen.getByText(RISKS[0]!.explanation)).toBeTruthy();
  });

  it("marks the expanded state for assistive technology", () => {
    renderRisks(<RiskAreas risks={RISKS} />);
    const toggle = screen.getByRole("button", { name: /Committed secret/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders a risk with no surviving refs without an empty evidence row", () => {
    // The gate drops a risk whose every ref was invented, but a risk can also
    // arrive with none at all — it must not render a blank line where the
    // evidence would be.
    const { container } = renderRisks(
      <RiskAreas risks={[{ ...RISKS[0]!, refs: [] }]} />,
    );
    expect(screen.getByText("Committed secret")).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("collapses the open row when another is opened", () => {
    renderRisks(<RiskAreas risks={RISKS} />);
    fireEvent.click(screen.getByRole("button", { name: /Committed secret/ }));
    fireEvent.click(screen.getByRole("button", { name: /Limiter fronts/ }));

    expect(screen.queryByText(RISKS[0]!.explanation)).toBeNull();
    expect(screen.getByText(RISKS[1]!.explanation)).toBeTruthy();
  });

  it("renders nothing at all for an empty, null or absent list", () => {
    // An empty block under a heading reads as a feature that failed rather than
    // as a PR with no flagged risks.
    for (const risks of [[], null, undefined]) {
      const { container, unmount } = renderRisks(<RiskAreas risks={risks} />);
      expect(container.textContent).toBe("");
      unmount();
    }
  });
});
