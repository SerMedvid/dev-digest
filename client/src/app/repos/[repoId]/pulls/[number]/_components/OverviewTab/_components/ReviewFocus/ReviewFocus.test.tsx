import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";
import shellMessages from "../../../../../../../../../../messages/en/shell.json";
import { ReviewFocus } from "./ReviewFocus";

const ITEMS = [
  { file: "src/config.ts", line: 12, reason: "The committed secret." },
  { file: "src/middleware/ratelimit.ts", line: null, reason: "The limiter is entirely new." },
];

const DIFF_PATHS = ["src/config.ts", "src/middleware/ratelimit.ts"];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderFocus(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages, shell: shellMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ReviewFocus", () => {
  it("renders the items in the order they arrived, numbered", () => {
    renderFocus(<ReviewFocus items={ITEMS} diffPaths={DIFF_PATHS} onSetTab={vi.fn()} />);
    const rows = screen.getAllByRole("listitem");
    // Order is the content: the server ranked by where a mistake would be most
    // expensive, so the list is never re-sorted by path.
    expect(rows[0]!.textContent).toContain("src/config.ts");
    expect(rows[1]!.textContent).toContain("src/middleware/ratelimit.ts");
    expect(rows[0]!.textContent).toContain("The committed secret.");
  });

  it("shows :line only when line is not null (AC-14)", () => {
    renderFocus(<ReviewFocus items={ITEMS} diffPaths={DIFF_PATHS} onSetTab={vi.fn()} />);
    expect(screen.getByText("src/config.ts:12")).toBeTruthy();
    // A null line means no finding vouched for one. Printing `:0` or guessing
    // would undo the server's grounding gate on the client.
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeTruthy();
    expect(screen.queryByText(/ratelimit\.ts:/)).toBeNull();
  });

  it("switches to the diff tab and scrolls to the file on click", async () => {
    const onSetTab = vi.fn();
    const scroll = vi.fn();
    // The anchor lives on FileCard, which is not mounted here — stand one up so
    // the lookup has something to find.
    const anchor = document.createElement("div");
    anchor.id = "file-src/config.ts";
    anchor.scrollIntoView = scroll;
    document.body.appendChild(anchor);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    renderFocus(<ReviewFocus items={ITEMS} diffPaths={DIFF_PATHS} onSetTab={onSetTab} />);
    fireEvent.click(screen.getByText("src/config.ts:12"));

    expect(onSetTab).toHaveBeenCalledWith("diff");
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    anchor.remove();
    vi.unstubAllGlobals();
  });

  it("renders a file absent from the diff unlinked", () => {
    const onSetTab = vi.fn();
    renderFocus(
      <ReviewFocus items={ITEMS} diffPaths={["src/config.ts"]} onSetTab={onSetTab} />,
    );
    // One clickable row, not two: a control that scrolls nowhere is worse than
    // plain text.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeTruthy();
  });

  it("renders nothing for an empty, null or absent list", () => {
    for (const items of [[], null, undefined]) {
      const { container, unmount } = renderFocus(
        <ReviewFocus items={items} diffPaths={DIFF_PATHS} onSetTab={vi.fn()} />,
      );
      expect(container.textContent).toBe("");
      unmount();
    }
  });
});
