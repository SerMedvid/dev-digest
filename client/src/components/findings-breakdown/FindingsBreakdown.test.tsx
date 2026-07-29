/**
 * FindingsBreakdown — the interaction contract from
 * `client/specs/findings-counters-display.md` §4.
 *
 * The load-bearing case is isolation: this widget always sits on a surface that
 * is itself clickable (a PR row that navigates, an accordion header that
 * toggles). Opening or reading the card must never activate what's underneath.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFindingPreview } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { FindingsBreakdown, SeverityCounters } from "./FindingsBreakdown";
import { fromPreview, fromRecords, lineLabel, totalOf } from "./helpers";

afterEach(cleanup);

const COUNTS = { CRITICAL: 1, WARNING: 2, SUGGESTION: 0 };

const FINDINGS = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    confidence: 0.95,
    snippet: "A live Stripe key is committed in source.",
  },
  {
    id: "f2",
    severity: "WARNING",
    category: "bug",
    title: "Unbounded retry loop",
    file: "src/worker.ts",
    start_line: 40,
    end_line: 52,
    confidence: 0.6,
    snippet: "The retry has no ceiling.",
  },
];

function renderCard(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const openTrigger = () => screen.getByRole("button", { name: /show findings breakdown/i });

function preview(o: Partial<PrFindingPreview> = {}): PrFindingPreview {
  return {
    id: "p1",
    severity: "WARNING",
    category: "perf",
    title: "N+1 query",
    file: "src/db.ts",
    start_line: 3,
    end_line: 3,
    confidence: 0.5,
    rationale_snippet: "One query per row.",
    ...o,
  };
}

/** `severity` widens to string on purpose: the DB column is plain text, so the
 *  out-of-enum row this component has to fold away is representable here. */
function record(
  o: Partial<Omit<FindingRecord, "severity">> & { severity?: string } = {},
): FindingRecord {
  return {
    id: "r1",
    review_id: "rev1",
    severity: "WARNING",
    category: "bug",
    title: "A finding",
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "why",
    confidence: 0.5,
    accepted_at: null,
    dismissed_at: null,
    ...o,
  } as FindingRecord;
}

describe("helpers", () => {
  it("lineLabel collapses a single-line range", () => {
    expect(lineLabel({ start_line: 11, end_line: 11 })).toBe("11");
    expect(lineLabel({ start_line: 11, end_line: 15 })).toBe("11-15");
  });

  it("totalOf sums the counts, and treats null as nothing", () => {
    expect(totalOf(COUNTS)).toBe(3);
    expect(totalOf(null)).toBe(0);
  });

  it("fromPreview maps the server's snippet field onto the card row", () => {
    expect(fromPreview(preview()).snippet).toBe("One query per row.");
  });

  it("fromRecords counts non-dismissed findings only and orders by severity then confidence", () => {
    const { counts, findings } = fromRecords([
      record({ id: "a", severity: "WARNING", confidence: 0.2 }),
      record({ id: "b", severity: "CRITICAL", confidence: 0.4 }),
      record({ id: "c", severity: "WARNING", confidence: 0.9 }),
      record({ id: "d", severity: "CRITICAL", confidence: 0.1, dismissed_at: "2026-07-29" }),
      // Out-of-enum severity: counted by neither, listed by neither.
      record({ id: "e", severity: "INFO", confidence: 1 }),
    ]);
    expect(counts).toEqual({ CRITICAL: 1, WARNING: 2, SUGGESTION: 0 });
    expect(findings.map((f) => f.id)).toEqual(["b", "c", "a"]);
  });
});

describe("SeverityCounters", () => {
  it("renders a badge per NON-ZERO severity, most severe first", () => {
    const { container } = renderCard(<SeverityCounters counts={COUNTS} />);
    // Icon + count, never colour alone — the counts are the whole text content,
    // and the zeroed SUGGESTION contributes nothing.
    expect(container.textContent).toBe("12");
  });

  it("renders nothing when every severity is zero", () => {
    const { container } = renderCard(
      <SeverityCounters counts={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("FindingsBreakdown", () => {
  it("toggles the card on click and reflects it in aria-expanded", () => {
    renderCard(<FindingsBreakdown counts={COUNTS} findings={FINDINGS} />);
    expect(openTrigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // A browser turns Enter/Space on a native button into exactly this click,
    // so keyboard activation takes the same path.
    fireEvent.click(openTrigger());
    expect(openTrigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(openTrigger());
    expect(openTrigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("lists each finding with its title, file:line, confidence and snippet", () => {
    renderCard(<FindingsBreakdown counts={COUNTS} findings={FINDINGS} />);
    fireEvent.click(openTrigger());

    // No totalOverride ⇒ the list on screen IS the whole list.
    expect(screen.getByText("2 findings")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
    expect(screen.getByText("95% conf")).toBeInTheDocument();
    expect(screen.getByText("A live Stripe key is committed in source.")).toBeInTheDocument();
    // Multi-line range keeps both ends.
    expect(screen.getByText("src/worker.ts:40-52")).toBeInTheDocument();
  });

  it("uses the counts total in the header and footers the remainder when the preview is capped", () => {
    renderCard(<FindingsBreakdown counts={COUNTS} findings={FINDINGS} totalOverride={9} />);
    fireEvent.click(openTrigger());
    expect(screen.getByText("9 findings")).toBeInTheDocument();
    expect(screen.getByText("+7 more")).toBeInTheDocument();
  });

  it("shows no '+k more' footer when the list is complete", () => {
    renderCard(<FindingsBreakdown counts={COUNTS} findings={FINDINGS} totalOverride={2} />);
    fireEvent.click(openTrigger());
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });

  it("Escape closes the card and returns focus to the trigger", () => {
    renderCard(<FindingsBreakdown counts={COUNTS} findings={FINDINGS} />);
    fireEvent.click(openTrigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(openTrigger()).toHaveFocus();
  });

  it("an outside mousedown closes the card", () => {
    renderCard(
      <div>
        <span data-testid="elsewhere">elsewhere</span>
        <FindingsBreakdown counts={COUNTS} findings={FINDINGS} />
      </div>,
    );
    fireEvent.click(openTrigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Mousedown, not click — the same listener the vendored Dropdown uses, which
    // is what gives "at most one card open at a time" for free.
    fireEvent.mouseDown(screen.getByTestId("elsewhere"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a mousedown INSIDE the card leaves it open", () => {
    renderCard(<FindingsBreakdown counts={COUNTS} findings={FINDINGS} />);
    fireEvent.click(openTrigger());
    fireEvent.mouseDown(screen.getByText("Hardcoded Stripe secret key"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("never activates the surface underneath — not from the trigger, not from the card", () => {
    const onSurfaceClick = vi.fn();
    renderCard(
      <div onClick={onSurfaceClick}>
        <FindingsBreakdown counts={COUNTS} findings={FINDINGS} />
        <span data-testid="rest-of-row">rest of the row</span>
      </div>,
    );

    fireEvent.click(openTrigger());
    expect(onSurfaceClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Hardcoded Stripe secret key"));
    expect(onSurfaceClick).not.toHaveBeenCalled();

    // Enter/Space on the trigger would otherwise reach a role="button" header.
    const onSurfaceKeyDown = vi.fn();
    renderCard(
      <div onKeyDown={onSurfaceKeyDown}>
        <FindingsBreakdown counts={COUNTS} findings={FINDINGS} />
      </div>,
    );
    const triggers = screen.getAllByRole("button", { name: /show findings breakdown/i });
    fireEvent.keyDown(triggers[1]!, { key: "Enter" });
    expect(onSurfaceKeyDown).not.toHaveBeenCalled();
    // …while an unrelated key still reaches whatever listens above.
    fireEvent.keyDown(triggers[1]!, { key: "k", metaKey: true });
    expect(onSurfaceKeyDown).toHaveBeenCalledTimes(1);

    // …but the rest of the row still works.
    fireEvent.click(screen.getByTestId("rest-of-row"));
    expect(onSurfaceClick).toHaveBeenCalledTimes(1);
  });

  it("renders nothing at all when the counts are empty", () => {
    const { container } = renderCard(
      <FindingsBreakdown counts={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }} findings={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
