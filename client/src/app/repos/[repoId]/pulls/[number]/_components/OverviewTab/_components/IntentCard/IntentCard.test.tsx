import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../../messages/en/prReview.json";
import { IntentCard } from "./IntentCard";

const RECORD = {
  intent: "Add rate limiting to public API endpoints",
  in_scope: ["Add middleware for rate limiting", "Apply to /api/public/* routes"],
  out_of_scope: ["Authentication changes"],
  pr_id: "pr1",
  head_sha: "sha-1",
  confidence: "medium",
  sources: ["title", "description", "hunk_headers"],
  missing_context: ["docs/plans/rate-limit.md was not read: not found in the repository clone"],
  provider: "openrouter",
  model: "google/gemini-2.5-flash-lite",
  created_at: "2026-08-05T00:00:00Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status < 400,
      status,
      statusText: status < 400 ? "OK" : "Not Found",
      json: async () => body,
    })),
  );
}

/** GET returns `record`; POST (the derive/re-derive call) returns `onPost`,
 *  so a test can observe the card update to what the server sent back. */
function stubFetchWithDerive(record: unknown, onPost: unknown) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.method === "POST" ? onPost : record;
    return { ok: true, status: 200, statusText: "OK", json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderCard(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("IntentCard", () => {
  it("offers to derive when there is no intent yet", async () => {
    stubFetch(404, { error: { code: "not_found", message: "none" } });
    renderCard(<IntentCard prId="pr1" headSha="sha-1" />);
    expect(await screen.findByRole("button", { name: /derive intent/i })).toBeInTheDocument();
  });

  it("shows the statement, both lists, the confidence and the sources", async () => {
    stubFetch(200, RECORD);
    renderCard(<IntentCard prId="pr1" headSha="sha-1" />);

    expect(await screen.findByText(/Add rate limiting to public API endpoints/)).toBeInTheDocument();
    expect(screen.getByText("Apply to /api/public/* routes")).toBeInTheDocument();
    expect(screen.getByText("Authentication changes")).toBeInTheDocument();
    expect(screen.getByText(/medium/i)).toBeInTheDocument();
    expect(screen.getByText(/description/)).toBeInTheDocument();
    expect(screen.getByText(/google\/gemini-2.5-flash-lite/)).toBeInTheDocument();
  });

  it("surfaces missing context as its own warning", async () => {
    stubFetch(200, RECORD);
    renderCard(<IntentCard prId="pr1" headSha="sha-1" />);
    expect(
      await screen.findByText(/docs\/plans\/rate-limit.md was not read/),
    ).toBeInTheDocument();
  });

  it("retries a failed load with a re-read, never with a paid derivation", async () => {
    // The GET failed. Answering that with `derive.mutate()` spends a model call
    // per click on a problem that may just be a flaky read.
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: async () => ({ error: { code: "internal", message: "boom" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderCard(<IntentCard prId="pr1" headSha="sha-1" />);
    const retry = await screen.findByRole("button", { name: /retry/i });
    const before = fetchMock.mock.calls.length;

    fireEvent.click(retry);

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
    for (const call of fetchMock.mock.calls as unknown as [string, RequestInit?][]) {
      expect(call[1]?.method ?? "GET").toBe("GET");
    }
  });

  it("says the intent is stale when the PR head moved, and a re-derive refreshes it", async () => {
    // The re-derive returns a record whose head_sha now matches the PR's
    // current head, so a successful re-derive is observable as the stale
    // banner clearing — not just a network call having happened.
    const fetchMock = stubFetchWithDerive(RECORD, { ...RECORD, head_sha: "sha-TWO" });
    renderCard(<IntentCard prId="pr1" headSha="sha-TWO" />);
    expect(await screen.findByText(/changed since/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /re-derive/i }));

    await waitFor(() => expect(screen.queryByText(/changed since/i)).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/pulls/pr1/intent"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
