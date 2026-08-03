import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../messages/en/conventions.json";
import { SelectionBar } from "./SelectionBar";

afterEach(cleanup);

function renderBar(props: Partial<React.ComponentProps<typeof SelectionBar>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <SelectionBar
        accepted={3}
        total={3}
        busy={false}
        onDeselectAll={() => {}}
        onCreateSkill={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("SelectionBar", () => {
  it("counts the accepted candidates", () => {
    renderBar();
    expect(screen.getByText("3 of 3 accepted")).toBeInTheDocument();
  });

  it("creates a skill from the accepted set", () => {
    const onCreateSkill = vi.fn();
    renderBar({ onCreateSkill });
    fireEvent.click(screen.getByRole("button", { name: /create skill/i }));
    expect(onCreateSkill).toHaveBeenCalled();
  });

  it("cannot create a skill with nothing accepted — the endpoint 409s", () => {
    renderBar({ accepted: 0 });
    expect(screen.getByRole("button", { name: /create skill/i })).toBeDisabled();
  });

  it("deselects everything", () => {
    const onDeselectAll = vi.fn();
    renderBar({ onDeselectAll });
    fireEvent.click(screen.getByRole("button", { name: /deselect all/i }));
    expect(onDeselectAll).toHaveBeenCalled();
  });
});
