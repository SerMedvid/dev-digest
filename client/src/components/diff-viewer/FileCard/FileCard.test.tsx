import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingMark } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import shellMessages from "../../../../messages/en/shell.json";
import { FileCard } from "./FileCard";

afterEach(cleanup);

function wrap(ui: React.ReactElement) {
  return <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>{ui}</NextIntlClientProvider>;
}

// Hunk @@ -1,2 +1,3 @@ over " const a = 1;" / "-const b = 2;" / "+const b = 3;" / "+const c = 4;"
// gives new-side line numbers: 1 (ctx), 2 (add "const b = 3;"), 3 (add "const c = 4;").
const FILE: PrFile = {
  path: "src/config.ts",
  additions: 2,
  deletions: 1,
  patch: "@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;",
};

describe("FileCard", () => {
  it("renders open by default under the auto-expand threshold and toggles on header click (uncontrolled)", () => {
    render(wrap(<FileCard file={FILE} />));
    expect(screen.getByText("const c = 4;")).toBeInTheDocument();

    fireEvent.click(screen.getByText("src/config.ts"));
    expect(screen.queryByText("const c = 4;")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("src/config.ts"));
    expect(screen.getByText("const c = 4;")).toBeInTheDocument();
  });

  it("respects a controlled open/onToggle and leaves the internal state alone", () => {
    const onToggle = vi.fn();
    const { rerender } = render(wrap(<FileCard file={FILE} open={false} onToggle={onToggle} />));
    expect(screen.queryByText("const c = 4;")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("src/config.ts"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    // The parent didn't actually flip `open`, so the body stays closed —
    // proof the click didn't fall through to uncontrolled state.
    expect(screen.queryByText("const c = 4;")).not.toBeInTheDocument();

    rerender(wrap(<FileCard file={FILE} open={true} onToggle={onToggle} />));
    expect(screen.getByText("const c = 4;")).toBeInTheDocument();
  });

  it("anchors a mark to the matching new-side line and reports its finding id on click", () => {
    const onMarkClick = vi.fn();
    const marks: FindingMark[] = [{ line: 3, severity: "CRITICAL", finding_id: "f1" }];
    render(wrap(<FileCard file={FILE} marks={marks} onMarkClick={onMarkClick} />));

    // A CRITICAL mark is labelled for the reviewer, not for the pipeline.
    const chip = screen.getByRole("button", { name: /blocker/i });
    fireEvent.click(chip);
    expect(onMarkClick).toHaveBeenCalledWith("f1");

    // The chip is a sibling of the code text, never nested inside it.
    expect(screen.getByText("const c = 4;")).not.toContainElement(chip);
  });

  it("picks the highest-severity mark when two findings land on the same line, regardless of array order", () => {
    const onMarkClick = vi.fn();
    // Deliberately unfavourable order: SUGGESTION first, CRITICAL second. A
    // naive `marks.find(...)` would pick SUGGESTION here and pass under the
    // old buggy code too — the ordering is the whole point of this test.
    const marks: FindingMark[] = [
      { line: 3, severity: "SUGGESTION", finding_id: "low" },
      { line: 3, severity: "CRITICAL", finding_id: "high" },
    ];
    render(wrap(<FileCard file={FILE} marks={marks} onMarkClick={onMarkClick} />));

    const chips = screen.getAllByRole("button", { name: /finding/i });
    expect(chips).toHaveLength(1); // only the winning mark renders a chip
    fireEvent.click(chips[0]!);
    expect(onMarkClick).toHaveBeenCalledWith("high");
  });

  it("scrolls to the target line once, and does not replay the scroll after collapsing and reopening", () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    render(wrap(<FileCard file={FILE} scrollToLine={3} />));
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    const header = screen.getByText("src/config.ts");
    fireEvent.click(header); // collapse
    fireEvent.click(header); // reopen — same scrollToLine value, must not re-scroll
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("puts pathAdornment beside the path, headerExtra before the +/- stat, and preBody above the lines", () => {
    render(
      wrap(
        <FileCard
          file={FILE}
          pathAdornment={<span>Dot</span>}
          headerExtra={<span>Extra</span>}
          preBody={<div>What this does: does a thing</div>}
        />,
      ),
    );
    expect(screen.getByText("What this does: does a thing")).toBeInTheDocument();

    // The adornment shares the path's own wrapper — it reads as part of the
    // file's name, not as one more control in the right-hand cluster.
    const pathWrap = screen.getByText("src/config.ts").parentElement!;
    expect(pathWrap).toContainElement(screen.getByText("Dot"));

    // …and the stat follows headerExtra, not the other way round.
    const extra = screen.getByText("Extra");
    const stat = screen.getByText("+2").parentElement!;
    expect(extra.compareDocumentPosition(stat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
