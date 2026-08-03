import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ConventionCandidate,
  ConventionScan,
  ConventionsView as View,
} from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { ConventionsView } from "./ConventionsView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const candidate: ConventionCandidate = {
  id: "c1",
  category: "naming",
  rule: "Always suffix repositories with Repository",
  evidence_path: "src/a.ts",
  evidence_line: 2,
  evidence_snippet: "class UserRepository {",
  confidence: 0.9,
  status: "pending",
};

function scan(over: Partial<ConventionScan> = {}): ConventionScan {
  return {
    status: "done",
    pool_count: 40,
    sample_count: 14,
    candidate_count: 1,
    dropped: {},
    provider: "openrouter",
    model: "cheap",
    error: null,
    started_at: "2026-08-03T10:00:00.000Z",
    finished_at: "2026-08-03T10:00:31.000Z",
    ...over,
  };
}

function stubView(view: View) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return { ok: true, status: 202, statusText: "Accepted", json: async () => ({ jobId: "j1" }) };
    }
    if (String(url).includes("/agents")) {
      return { ok: true, status: 200, statusText: "OK", json: async () => [] };
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => view };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubFailure() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ error: { message: "boom" } }),
    })),
  );
}

function renderView(indexed = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <ConventionsView repoId="r1" repoName="payments-api" indexed={indexed} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ConventionsView", () => {
  it("invites a first scan for a repo that was never scanned", async () => {
    stubView({ scan: null, candidates: [] });
    renderView();
    expect(await screen.findByText("No conventions extracted yet")).toBeInTheDocument();
  });

  it("starts a scan from the empty state", async () => {
    const mock = stubView({ scan: null, candidates: [] });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /run extraction/i }));
    await waitFor(() =>
      expect(
        mock.mock.calls.some(
          (c) => String(c[0]).includes("/conventions/extract") && c[1]?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("shows progress while the scan runs", async () => {
    stubView({ scan: scan({ status: "running", candidate_count: 0 }), candidates: [] });
    renderView();
    expect(await screen.findByText(/Scanning/)).toBeInTheDocument();
  });

  it("explains a scan that found nothing that survived verification", async () => {
    stubView({
      scan: scan({ candidate_count: 0, dropped: { snippet_not_found: 4, duplicate: 1 } }),
      candidates: [],
    });
    renderView();
    expect(await screen.findByText("Nothing survived verification")).toBeInTheDocument();
    expect(screen.getByText(/quoted code we could not find/)).toBeInTheDocument();
  });

  it("lists the candidates with the selection bar", async () => {
    stubView({ scan: scan(), candidates: [candidate] });
    renderView();
    expect(await screen.findByText(candidate.rule)).toBeInTheDocument();
    expect(screen.getByText("0 of 1 accepted")).toBeInTheDocument();
  });

  it("counts accepted candidates and opens the modal", async () => {
    stubView({ scan: scan(), candidates: [{ ...candidate, status: "accepted" }] });
    renderView();
    expect(await screen.findByText("1 of 1 accepted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /create skill/i }));
    expect(await screen.findByText(/Merged from 1 accepted convention/)).toBeInTheDocument();
  });

  it("says so when deselect-all only partly succeeded", async () => {
    const accepted = ["c1", "c2", "c3"].map((id) => ({ ...candidate, id, status: "accepted" }));
    const patched: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const id = String(url).split("/conventions/")[1]!;
        patched.push(id);
        return id === "c2"
          ? {
              ok: false,
              status: 500,
              statusText: "Internal Server Error",
              json: async () => ({ error: { message: "boom" } }),
            }
          : { ok: true, status: 200, statusText: "OK", json: async () => ({ ...candidate, id }) };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ scan: scan(), candidates: accepted }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /deselect all/i }));

    expect(await screen.findByText(/Some conventions could not be deselected/)).toBeInTheDocument();
    // The other two were still attempted — one failure must not abort the rest.
    expect(patched.sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("surfaces a failed scan with its reason", async () => {
    stubView({
      scan: scan({ status: "failed", error: "OPENROUTER_API_KEY is not configured" }),
      candidates: [],
    });
    renderView();
    expect(await screen.findByText(/Extraction failed/)).toBeInTheDocument();
    expect(screen.getByText(/OPENROUTER_API_KEY is not configured/)).toBeInTheDocument();
  });

  it("offers a retry when the view itself cannot load", async () => {
    stubFailure();
    renderView();
    expect(await screen.findByText("Could not load conventions.")).toBeInTheDocument();
  });

  it("says an unindexed repo can only be scanned for configs", async () => {
    stubView({ scan: null, candidates: [] });
    renderView(false);
    expect(await screen.findByText("This repo is not indexed yet")).toBeInTheDocument();
  });
});
