import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import messages from "../../../../../../../../../../../../messages/en/blast.json";
import { BlastGraphDialog } from "./BlastGraphDialog";

const HEAD = "a1b2c3d4e5f6";

const MAP: BlastRadiusResponse = {
  status: "ok",
  reason: null,
  head_sha: HEAD,
  changed_symbols: [
    {
      name: "rateLimit",
      kind: "function",
      file: "src/middleware/ratelimit.ts",
      line: 12,
      callers: [{ file: "src/api/public/index.ts", line: 23, symbol: "publicRouter", rank: 0.9 }],
      endpoints: ["GET /api/public/items"],
      crons: [],
    },
  ],
  endpoints: ["GET /api/public/items"],
  crons: [],
  summary: null,
};

afterEach(cleanup);

function renderDialog(onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastGraphDialog data={MAP} headSha={HEAD} repoFullName="acme/payments-api" onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return onClose;
}

describe("BlastGraphDialog", () => {
  it("renders the graph inside a modal dialog", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();
  });

  it("names every node colour in the legend", () => {
    renderDialog();
    expect(screen.getByText("Changed symbol")).toBeInTheDocument();
    expect(screen.getByText("Caller")).toBeInTheDocument();
    expect(screen.getByText("Endpoint")).toBeInTheDocument();
    expect(screen.getByText("Cron / job")).toBeInTheDocument();
  });

  it("closes on the close control", () => {
    const onClose = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
