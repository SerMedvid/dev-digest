/**
 * FindingsBreakdown — the interaction contract from
 * `client/specs/findings-counters-display.md` §4.
 *
 * The load-bearing case is isolation: this widget always sits on a surface that
 * is itself clickable (a PR row that navigates, an accordion header that
 * toggles). Opening or reading the card must never activate what's underneath.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFindingPreview } from "@devdigest/shared";
import messages from "../../../../messages/en/prReview.json";
import { FindingsBreakdown } from "./FindingsBreakdown";
import { SeverityCounters } from "../SeverityCounters";
import {
  cardPlacement,
  fromPreview,
  fromRecords,
  lineLabel,
  previewTotals,
  shownSeverities,
  severityMeta,
  totalOf,
} from "../helpers";
import { CARD_MAX_HEIGHT, CARD_WIDTH } from "../constants";

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

  it("shownSeverities keeps non-zero severities only, most severe first", () => {
    expect(shownSeverities(COUNTS)).toEqual(["CRITICAL", "WARNING"]);
    expect(shownSeverities({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 })).toEqual([]);
  });

  it("severityMeta degrades an out-of-enum severity to INFO rather than throwing", () => {
    expect(severityMeta("CRITICAL").icon).toBe("AlertOctagon");
    expect(severityMeta("NONSENSE")).toBe(severityMeta("INFO"));
  });

  it("previewTotals reports the remainder only when the list is capped", () => {
    expect(previewTotals(2)).toEqual({ total: 2, hidden: 0 });
    expect(previewTotals(2, 9)).toEqual({ total: 9, hidden: 7 });
    // A total below what's on screen can't mean negative hidden rows.
    expect(previewTotals(6, 2)).toEqual({ total: 2, hidden: 0 });
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

/** Every surface hosting this widget wraps it in an `overflow: hidden` ancestor
 *  (the list's table card, the accordion shell) to clip its rounded corners. The
 *  card therefore can't be laid out inside that box — it's pinned in viewport
 *  coordinates instead, which is what these cases pin down. */
describe("cardPlacement", () => {
  const VIEWPORT = { width: 1200, height: 800 };
  const trigger = (o: Partial<DOMRect> = {}) =>
    ({ top: 300, bottom: 320, left: 200, right: 260, ...o }) as DOMRect;

  it("hangs the card under the trigger, left edges aligned, when there's room below", () => {
    const p = cardPlacement(trigger(), VIEWPORT, "left");
    expect(p.top).toBe(326); // trigger bottom + the 6px gap
    expect(p.bottom).toBeUndefined();
    expect(p.left).toBe(200);
    expect(p.maxHeight).toBe(CARD_MAX_HEIGHT);
  });

  it("aligns the card's RIGHT edge to the trigger's when asked", () => {
    // Far enough right that the card fits without clamping, which is the only
    // way this assertion says anything about alignment.
    const p = cardPlacement(trigger({ left: 800, right: 860 }), VIEWPORT, "right");
    expect(p.left).toBe(860 - CARD_WIDTH);
  });

  it("flips above the trigger when the space below can't fit the card and above can", () => {
    // A row near the bottom of the window: 40px below, ~700 above.
    const p = cardPlacement(trigger({ top: 740, bottom: 760 }), VIEWPORT, "left");
    expect(p.top).toBeUndefined();
    expect(p.bottom).toBe(VIEWPORT.height - 740 + 6); // pinned to just above the trigger
    expect(p.maxHeight).toBe(CARD_MAX_HEIGHT);
  });

  it("shrinks rather than flipping when neither side can fit the full card", () => {
    // A short window: ~136 below the trigger, ~116 above ⇒ stay below, cap the
    // height, and let the card's own overflowY scroll the rest.
    const p = cardPlacement(trigger({ top: 130, bottom: 150 }), { width: 1200, height: 300 }, "left");
    expect(p.top).toBe(156);
    expect(p.maxHeight).toBe(300 - 150 - 6 - 8);
  });

  it("clamps a card that would run off the right edge back into the viewport", () => {
    const p = cardPlacement(trigger({ left: 1150, right: 1190 }), VIEWPORT, "left");
    expect(p.left).toBe(VIEWPORT.width - CARD_WIDTH - 8);
  });

  it("never pushes the card off the left edge", () => {
    const p = cardPlacement(trigger({ left: 20, right: 60 }), VIEWPORT, "right");
    expect(p.left).toBe(8);
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

  /* The trigger is the only click target, so the whole badge cluster reacts as
     one. `SeverityBadge` is vendored and takes no style prop, so the feedback
     lives on a wrapper per badge — hence the structural query. */
  it("underlines each badge in its severity colour while the trigger is hovered", () => {
    renderCard(<FindingsBreakdown counts={COUNTS} findings={FINDINGS} />);
    // Read the raw inline values: these are CSS vars, which `toHaveStyle` can't
    // resolve without the stylesheet that defines them.
    const NONE = "transparent";
    const underlines = () =>
      Array.from(openTrigger().firstElementChild!.children).map(
        (b) => (b as HTMLElement).style.borderBottomColor,
      );

    expect(underlines()).toEqual([NONE, NONE]); // CRITICAL + WARNING; SUGGESTION is zero

    fireEvent.mouseOver(openTrigger());
    expect(underlines()).toEqual(["var(--crit)", "var(--warn)"]);

    fireEvent.mouseOut(openTrigger());
    expect(underlines()).toEqual([NONE, NONE]);
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

  /* The bug these two cover: the card used to be `position: absolute`, so its
     containing block was the trigger's wrapper — inside the table card, which
     sets `overflow: hidden`. The card was clipped at the row's edge. jsdom has
     no layout to assert the clipping itself, so what's pinned here is the
     mechanism that removes it: viewport coordinates, recomputed as the surface
     underneath moves. */
  it("pins the card in viewport coordinates so no overflow:hidden ancestor can clip it", () => {
    renderCard(
      <div style={{ overflow: "hidden" }}>
        <FindingsBreakdown counts={COUNTS} findings={FINDINGS} />
      </div>,
    );
    fireEvent.click(openTrigger());
    expect(screen.getByRole("dialog")).toHaveStyle({ position: "fixed" });
  });

  it("re-pins the card when the surface underneath scrolls", () => {
    const rect = vi.spyOn(HTMLButtonElement.prototype, "getBoundingClientRect");
    rect.mockReturnValue({ top: 300, bottom: 320, left: 100, right: 160 } as DOMRect);
    renderCard(<FindingsBreakdown counts={COUNTS} findings={FINDINGS} />);
    fireEvent.click(openTrigger());
    expect(screen.getByRole("dialog")).toHaveStyle({ top: "326px", left: "100px" });

    // The list scrolls inside `<main overflow:auto>`, not the window, so the
    // listener has to be capture-phase to see it at all.
    rect.mockReturnValue({ top: 120, bottom: 140, left: 100, right: 160 } as DOMRect);
    fireEvent.scroll(document);
    expect(screen.getByRole("dialog")).toHaveStyle({ top: "146px" });
    rect.mockRestore();
  });

  it("renders nothing at all when the counts are empty", () => {
    const { container } = renderCard(
      <FindingsBreakdown counts={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }} findings={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * The two ways out of the card — `client/specs/finding-deep-links.md` §5.
 *
 * Both are optional and independent: a surface may know where the PR detail
 * page is, or the repo's owner/repo, or neither. "Neither" is the original
 * read-only row and has to keep working, because the component is shared.
 */
describe("FindingsBreakdown — deep links", () => {
  const LINK = { repoFullName: "acme/api", prNumber: 128 };
  const title = () => screen.getByText("Hardcoded Stripe secret key");

  /** jsdom has no SubtleCrypto; digest of the path is stubbed to a fixed hash. */
  function stubSubtle() {
    vi.stubGlobal("crypto", {
      ...globalThis.crypto,
      subtle: { digest: async () => new Uint8Array([0xab, 0xcd]).buffer },
    });
  }

  afterEach(() => vi.unstubAllGlobals());

  it("leaves the row read-only when the surface wires neither exit", () => {
    renderCard(<FindingsBreakdown counts={COUNTS} findings={FINDINGS} />);
    fireEvent.click(openTrigger());
    expect(title().tagName).toBe("SPAN");
    expect(screen.getByText("src/config.ts:11").tagName).toBe("SPAN");
  });

  it("makes the title a button that reports the finding id and closes the card", () => {
    const onOpenFinding = vi.fn();
    renderCard(
      <FindingsBreakdown counts={COUNTS} findings={FINDINGS} onOpenFinding={onOpenFinding} />,
    );
    fireEvent.click(openTrigger());
    expect(title().tagName).toBe("BUTTON");

    fireEvent.click(title());
    expect(onOpenFinding).toHaveBeenCalledTimes(1);
    expect(onOpenFinding).toHaveBeenCalledWith("f1");
    // Closed, so the card isn't left hanging over what we jumped to.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("jumping never activates the surface underneath", () => {
    const onSurfaceClick = vi.fn();
    renderCard(
      <div onClick={onSurfaceClick}>
        <FindingsBreakdown counts={COUNTS} findings={FINDINGS} onOpenFinding={vi.fn()} />
      </div>,
    );
    fireEvent.click(openTrigger());
    fireEvent.click(title());
    expect(onSurfaceClick).not.toHaveBeenCalled();
  });

  it("links file:line into the PR's diff, un-anchored first and anchored once the hash lands", async () => {
    stubSubtle();
    renderCard(<FindingsBreakdown counts={COUNTS} findings={FINDINGS} link={LINK} />);
    fireEvent.click(openTrigger());

    const link = screen.getByText("src/config.ts:11") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    // Never a dead or missing link while the digest is in flight.
    expect(link.getAttribute("href")).toBe("https://github.com/acme/api/pull/128/files");

    await waitFor(() =>
      expect(screen.getByText("src/config.ts:11").getAttribute("href")).toBe(
        "https://github.com/acme/api/pull/128/files#diff-abcdR11",
      ),
    );
    // A multi-line finding keeps both ends of the range.
    expect(screen.getByText("src/worker.ts:40-52").getAttribute("href")).toBe(
      "https://github.com/acme/api/pull/128/files#diff-abcdR40-R52",
    );
  });

  it("keeps the un-anchored link when SubtleCrypto is unavailable", async () => {
    vi.stubGlobal("crypto", { ...globalThis.crypto, subtle: undefined });
    // A file no other case hashes — `diffAnchorHash` memoizes at module scope.
    const findings = [{ ...FINDINGS[0]!, file: "src/insecure-context.ts" }];
    renderCard(<FindingsBreakdown counts={COUNTS} findings={findings} link={LINK} />);
    fireEvent.click(openTrigger());

    const href = () => screen.getByText(/insecure-context/).getAttribute("href");
    expect(href()).toBe("https://github.com/acme/api/pull/128/files");
    // Give the (resolved-null) promise a turn; nothing should change or throw.
    await Promise.resolve();
    expect(href()).toBe("https://github.com/acme/api/pull/128/files");
  });
});
