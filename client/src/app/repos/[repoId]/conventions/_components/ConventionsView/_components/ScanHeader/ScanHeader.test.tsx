import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionScan } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/conventions.json";
import { ScanHeader } from "./ScanHeader";

afterEach(cleanup);

function scan(over: Partial<ConventionScan> = {}): ConventionScan {
  return {
    status: "done",
    pool_count: 40,
    sample_count: 84,
    candidate_count: 3,
    dropped: {},
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    error: null,
    started_at: "2026-08-03T10:00:00.000Z",
    finished_at: "2026-08-03T10:00:31.000Z",
    ...over,
  };
}

function renderHeader(props: Partial<React.ComponentProps<typeof ScanHeader>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ScanHeader
        scan={scan()}
        accepted={0}
        rejected={0}
        busy={false}
        onRescan={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("ScanHeader", () => {
  it("reports how many files were sampled", () => {
    renderHeader();
    expect(screen.getByText(/Detected from 84 sample files/)).toBeInTheDocument();
  });

  it("re-scans straight away when there is nothing to lose", () => {
    const onRescan = vi.fn();
    renderHeader({ onRescan });
    fireEvent.click(screen.getByRole("button", { name: /re-scan/i }));
    expect(onRescan).toHaveBeenCalledTimes(1);
  });

  it("names the decisions a re-scan would discard before running it", () => {
    const onRescan = vi.fn();
    renderHeader({ accepted: 2, rejected: 5, onRescan });
    fireEvent.click(screen.getByRole("button", { name: /^re-scan$/i }));
    expect(onRescan).not.toHaveBeenCalled();
    expect(screen.getByText(/discards 2 accepted and 5 rejected conventions/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /discard and re-scan/i }));
    expect(onRescan).toHaveBeenCalledTimes(1);
  });

  it("keeps the decisions when the confirmation is dismissed", () => {
    const onRescan = vi.fn();
    renderHeader({ accepted: 2, rejected: 5, onRescan });
    fireEvent.click(screen.getByRole("button", { name: /^re-scan$/i }));
    fireEvent.click(screen.getByRole("button", { name: /keep them/i }));
    expect(onRescan).not.toHaveBeenCalled();
  });

  it("shows progress and blocks a second scan while one is in flight", () => {
    renderHeader({ scan: scan({ status: "running" }), busy: true });
    expect(screen.getByText(/Scanning/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /re-scan/i })).toBeDisabled();
  });

  it("offers a first run for a repo that was never scanned", () => {
    const onRescan = vi.fn();
    renderHeader({ scan: null, onRescan });
    fireEvent.click(screen.getByRole("button", { name: /run extraction/i }));
    expect(onRescan).toHaveBeenCalledTimes(1);
  });
});
