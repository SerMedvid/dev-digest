import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastSymbolC } from "@devdigest/shared";
import messages from "../../../../../../../../../../../../messages/en/blast.json";
import { SymbolRow } from "./SymbolRow";

const HEAD = "a1b2c3d4e5f6";
const REPO = "acme/payments-api";

const FN: BlastSymbolC = {
  name: "rateLimit",
  kind: "function",
  file: "src/middleware/ratelimit.ts",
  line: 12,
  callers: [
    { file: "src/api/public/index.ts", line: 23, symbol: "publicRouter", rank: 0.92 },
    { file: "src/api/public/webhooks.ts", line: 45, symbol: "handleWebhook", rank: 0.71 },
  ],
  endpoints: ["GET /api/public/items"],
  crons: ["job:reset-rate-buckets"],
};

const IFACE: BlastSymbolC = {
  name: "TicketStreamProps",
  kind: "interface",
  file: "app/_components/TicketStream.tsx",
  line: 4,
  callers: [],
  endpoints: [],
  crons: [],
};

afterEach(cleanup);

function renderRow(props: Partial<React.ComponentProps<typeof SymbolRow>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <SymbolRow sym={FN} headSha={HEAD} repoFullName={REPO} defaultOpen {...props} />
    </NextIntlClientProvider>,
  );
}

describe("SymbolRow — header", () => {
  it("renders a function kind as callable and reports its caller count", () => {
    renderRow();
    const header = screen.getByRole("button", { name: /rateLimit/ });
    expect(header).toHaveTextContent("rateLimit()");
    expect(header).toHaveTextContent("2 callers");
  });

  it("never draws a non-function kind as callable, and keeps the kind visible", () => {
    renderRow({ sym: IFACE });
    const header = screen.getByRole("button", { name: /TicketStreamProps/ });
    expect(header).toHaveTextContent("TicketStreamProps");
    expect(header).not.toHaveTextContent("TicketStreamProps()");
    expect(header).toHaveTextContent("interface");
  });
});

describe("SymbolRow — collapse", () => {
  it("starts closed when defaultOpen is false, hiding the body entirely", () => {
    renderRow({ defaultOpen: false });
    const header = screen.getByRole("button", { name: /rateLimit/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("src/api/public/index.ts:23")).not.toBeInTheDocument();
  });

  it("expands on click and announces it", () => {
    renderRow({ defaultOpen: false });
    fireEvent.click(screen.getByRole("button", { name: /rateLimit/ }));
    expect(screen.getByRole("button", { name: /rateLimit/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
  });

  it("collapses again on a second click", () => {
    renderRow({ defaultOpen: true });
    fireEvent.click(screen.getByRole("button", { name: /rateLimit/ }));
    expect(screen.queryByText("src/api/public/index.ts:23")).not.toBeInTheDocument();
  });
});

describe("SymbolRow — body", () => {
  it("keeps the declaration link the comp drops", () => {
    renderRow();
    expect(screen.getByText(/declared at/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "src/middleware/ratelimit.ts:12" });
    expect(link).toHaveAttribute(
      "href",
      `https://github.com/${REPO}/blob/${HEAD}/src/middleware/ratelimit.ts#L12`,
    );
  });

  it("SHA-pins every caller link", () => {
    renderRow();
    const link = screen.getByRole("link", { name: "src/api/public/index.ts:23" });
    expect(link).toHaveAttribute(
      "href",
      `https://github.com/${REPO}/blob/${HEAD}/src/api/public/index.ts#L23`,
    );
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders rows as plain text — never a dead link — when the repo is unknown", () => {
    renderRow({ repoFullName: null });
    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders this symbol's own endpoint and cron chips", () => {
    renderRow();
    expect(screen.getByText("GET /api/public/items")).toBeInTheDocument();
    expect(screen.getByText("job:reset-rate-buckets")).toBeInTheDocument();
  });
});
