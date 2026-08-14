/* AttachmentRow — the row both Context editors draw.
 *
 * It exists because the agent's tab and the skill's drew this row separately
 * for a while, and every fix had to be applied twice: the cross-repository
 * keying, the 409 handling, the per-run cap badge. Drag reached only one of
 * them, which is what put this component here. The two editors' own suites
 * still cover their semantics; this covers the chrome they share.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AttachmentRow } from "./AttachmentRow";
import { moveAttached } from "../helpers";

afterEach(cleanup);

const LABELS = {
  dragHandle: "Reorder specs/a.md",
  preview: "Preview specs/a.md",
  missing: "Missing from the clone",
  beyondCap: "Not read: only 20 documents are read per run",
};

function renderRow(over: Partial<React.ComponentProps<typeof AttachmentRow>> = {}) {
  return render(
    <AttachmentRow
      path="specs/a.md"
      root="specs"
      attached
      labels={LABELS}
      onToggle={() => {}}
      onPreview={() => {}}
      {...over}
    />,
  );
}

describe("AttachmentRow", () => {
  /* The checkbox's accessible name must BE the document path: it is how both
     editors' suites address a row, and how a screen reader says which document
     is being attached (AC-42, AC-53). */
  it("names the checkbox after the document", () => {
    renderRow();
    expect(screen.getByRole("checkbox", { name: "specs/a.md" })).toBeChecked();
  });

  it("carries the root as text, not as colour alone (AC-53)", () => {
    renderRow({ root: "insights" });
    expect(screen.getByText("insights")).toBeInTheDocument();
  });

  it("shows a drag handle only when it is given drag props", () => {
    const { unmount } = renderRow();
    expect(screen.queryByRole("button", { name: LABELS.dragHandle })).toBeNull();
    unmount();

    renderRow({ handleProps: {} });
    expect(screen.getByRole("button", { name: LABELS.dragHandle })).toBeInTheDocument();
  });

  /* Locked and inactive both mean "attached, but not yours to detach here" —
     an inherited row in the agent editor, a cross-repository row in either.
     Disabled rather than absent, so the row still reads as attached without
     offering an action it cannot perform (AC-50, AC-63). */
  it("disables the checkbox when the row is locked or inactive, without hiding it", () => {
    const { unmount } = renderRow({ locked: true });
    expect(screen.getByRole("checkbox", { name: "specs/a.md" })).toBeDisabled();
    unmount();

    renderRow({ inactive: true });
    expect(screen.getByRole("checkbox", { name: "specs/a.md" })).toBeDisabled();
  });

  it("badges a missing document and one past the per-run cap", () => {
    renderRow({ missing: true, beyondReadCap: true });
    expect(screen.getByText(LABELS.missing)).toBeInTheDocument();
    expect(screen.getByText(LABELS.beyondCap)).toBeInTheDocument();
  });

  /* A missing document has nothing on disk to preview and a cross-repository
     one lives in a clone this editor is not looking at — the request would 404
     either way. */
  it("offers a preview only for a document this editor can actually read", () => {
    const onPreview = vi.fn();
    const { unmount } = renderRow({ onPreview });
    fireEvent.click(screen.getByRole("button", { name: LABELS.preview }));
    expect(onPreview).toHaveBeenCalledOnce();
    unmount();

    renderRow({ missing: true });
    expect(screen.queryByRole("button", { name: LABELS.preview })).toBeNull();
    cleanup();

    renderRow({ inactive: true });
    expect(screen.queryByRole("button", { name: LABELS.preview })).toBeNull();
  });

  it("renders the caller's notes without interpreting them", () => {
    renderRow({ notes: <span>Inherited from rubric</span> });
    expect(screen.getByText("Inherited from rubric")).toBeInTheDocument();
  });

  it("reports a toggle", () => {
    const onToggle = vi.fn();
    renderRow({ attached: false, onToggle });
    fireEvent.click(screen.getByRole("checkbox", { name: "specs/a.md" }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});

describe("moveAttached", () => {
  const paths = ["a.md", "b.md", "c.md"];

  it("returns the complete reordered list, since a replace is a full list", () => {
    expect(moveAttached(paths, 0, 2)).toEqual(["b.md", "c.md", "a.md"]);
    expect(moveAttached(paths, 2, 0)).toEqual(["c.md", "a.md", "b.md"]);
  });

  it("does not mutate the list it was given", () => {
    moveAttached(paths, 0, 2);
    expect(paths).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("is a no-op for a move that goes nowhere or off the end", () => {
    expect(moveAttached(paths, 1, 1)).toBe(paths);
    expect(moveAttached(paths, 9, 0)).toBe(paths);
  });
});
