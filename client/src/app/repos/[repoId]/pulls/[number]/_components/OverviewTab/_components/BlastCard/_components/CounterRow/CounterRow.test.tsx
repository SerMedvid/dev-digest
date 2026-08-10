import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../../../../messages/en/blast.json";
import { CounterRow } from "./CounterRow";

afterEach(cleanup);

function renderRow(props: Partial<React.ComponentProps<typeof CounterRow>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <CounterRow symbols={2} callers={14} endpoints={3} crons={1} onOpenGraph={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("CounterRow", () => {
  it("reports all four counters", () => {
    renderRow();
    const counter = (label: string) => screen.getByText(label).parentElement;
    expect(counter("symbols")).toHaveTextContent("2symbols");
    expect(counter("callers")).toHaveTextContent("14callers");
    expect(counter("endpoints")).toHaveTextContent("3endpoints");
    expect(counter("cron/jobs")).toHaveTextContent("1cron/jobs");
  });

  it("renders a zero rather than hiding the counter", () => {
    // Under `status: ok`, "0 endpoints" is a measurement. Hiding it would make
    // "nothing there" look like "we could not see", which is what the status
    // enum exists to distinguish.
    renderRow({ endpoints: 0, crons: 0 });
    expect(screen.getByText("endpoints").parentElement).toHaveTextContent("0endpoints");
    expect(screen.getByText("cron/jobs").parentElement).toHaveTextContent("0cron/jobs");
  });

  it("opens the graph on click", () => {
    const onOpenGraph = vi.fn();
    renderRow({ onOpenGraph });
    fireEvent.click(screen.getByRole("button", { name: /^graph$/i }));
    expect(onOpenGraph).toHaveBeenCalledTimes(1);
  });

  it("renders no Graph button when there is no map to draw", () => {
    renderRow({ onOpenGraph: null });
    expect(screen.queryByRole("button", { name: /^graph$/i })).not.toBeInTheDocument();
  });
});
