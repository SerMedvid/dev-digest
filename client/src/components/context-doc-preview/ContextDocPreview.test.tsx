/* ContextDocPreview — the shared read-only preview modal. Two things matter and
   both are negative-adjacent: the document's text renders, and the surface
   carries no edit or save control (AC-37). */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ContextDocContent } from "@devdigest/shared";
import messages from "../../../messages/en/context.json";
import { ContextDocPreview } from "./ContextDocPreview";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubDoc(over: Partial<ContextDocContent> = {}) {
  const body: ContextDocContent = {
    path: "specs/api-contract.md",
    content: "# API contract\n\nEvery endpoint answers to this.",
    size_bytes: 2048,
    truncated: false,
    ...over,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => body })),
  );
}

function renderPreview(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextDocPreview repoId="r1" path="specs/api-contract.md" onClose={onClose} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return onClose;
}

describe("ContextDocPreview", () => {
  it("renders the document read-only, named by its path", async () => {
    stubDoc();
    renderPreview();

    expect(await screen.findByText("Every endpoint answers to this.")).toBeInTheDocument();
    expect(screen.getByText("specs/api-contract.md")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /edit|save/i })).toHaveLength(0);
  });

  it("says when the 64kb read cap clipped the document", async () => {
    stubDoc({ truncated: true });
    renderPreview();

    expect(await screen.findByText(/Only the first 64kb/)).toBeInTheDocument();
  });
});
