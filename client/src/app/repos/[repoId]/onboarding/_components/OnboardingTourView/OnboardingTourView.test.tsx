/* OnboardingTourView — the five-section generated repo tour, covering its rows
   through the screen.

   Two assertions carry most of the weight. The reading path must render in the
   order the server sent (it is file-rank order, decided server-side, and a
   client-side sort would silently replace the whole point of the feature), and
   a running regeneration must keep the previous tour on screen rather than
   blanking it. */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OnboardingSectionValue, OnboardingViewValue } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/onboarding.json";
import { OnboardingTourView } from "./OnboardingTourView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function section(
  id: OnboardingSectionValue["id"],
  over: Partial<OnboardingSectionValue> = {},
): OnboardingSectionValue {
  return {
    id,
    title: id,
    body: "",
    diagram: null,
    files: [],
    commands: [],
    tasks: [],
    ...over,
  };
}

function view(over: Partial<OnboardingViewValue> = {}): OnboardingViewValue {
  return {
    status: "ready",
    sections: [section("architecture", { title: "Architecture overview", body: "A Node service." })],
    generatedAt: "2026-08-14T10:00:00.000Z",
    stale: false,
    indexedFiles: 12_450,
    error: null,
    reason: null,
    ...over,
  };
}

/** GET returns the view; POST returns an accepted job. Dispatched by method. */
function stubApi(payload: OnboardingViewValue) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body =
      init?.method === "POST" ? { status: "accepted", jobId: "job-1" } : payload;
    return { ok: true, status: 200, statusText: "OK", json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** `retry: false` — a bare client retries 3× with backoff, and an error-state
    assertion then reads as broken rather than as slow (client/INSIGHTS.md). */
function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
        <OnboardingTourView repoId="r1" repoName="payments-api" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("OnboardingTourView", () => {
  it("offers to generate when no tour exists yet, and posts on click", async () => {
    const fetchMock = stubApi(
      view({ status: "empty", reason: "never_generated", sections: [], generatedAt: null }),
    );
    renderView();

    const cta = await screen.findByRole("button", { name: /generate onboarding tour/i });
    expect(cta).not.toBeDisabled();
    fireEvent.click(cta);

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(posted?.[0]).toContain("/repos/r1/onboarding/generate");
    });
  });

  it("explains that indexing comes first and refuses to generate", async () => {
    stubApi(
      view({
        status: "empty",
        reason: "not_indexed",
        sections: [],
        generatedAt: null,
        indexedFiles: 0,
      }),
    );
    renderView();

    expect(await screen.findByText(/isn't indexed yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate onboarding tour/i })).toBeDisabled();
  });

  it("shows a skeleton for a first generation, with nothing to keep on screen", async () => {
    stubApi(view({ status: "running", sections: [], generatedAt: null }));
    renderView();

    expect(await screen.findByTestId("tour-skeleton")).toBeInTheDocument();
    // No empty TOC rail and no bare header: there is no tour to navigate yet.
    expect(screen.queryByTestId("tour-toc")).not.toBeInTheDocument();
  });

  it("keeps the previous tour on screen while regenerating", async () => {
    stubApi(
      view({
        status: "running",
        sections: [section("architecture", { title: "Architecture overview", body: "Old body." })],
      }),
    );
    renderView();

    expect(await screen.findByText("Old body.")).toBeInTheDocument();
    expect(screen.getByText(/regenerating/i)).toBeInTheDocument();
  });

  it("renders the reading path in the order the server sent", async () => {
    stubApi(
      view({
        sections: [
          section("reading_path", {
            title: "Guided reading path",
            files: [
              { path: "src/server.ts", note: "the whole lifecycle", percentile: 99 },
              { path: "src/api/public/index.ts", note: "the public contract", percentile: 92 },
              { path: "src/middleware/auth.ts", note: "touches everything", percentile: 88 },
            ],
          }),
        ],
      }),
    );
    renderView();

    const steps = await screen.findAllByTestId("reading-path-step");
    expect(steps.map((n) => n.textContent)).toEqual([
      expect.stringContaining("src/server.ts"),
      expect.stringContaining("src/api/public/index.ts"),
      expect.stringContaining("src/middleware/auth.ts"),
    ]);
    expect(within(steps[0]!).getByText("the whole lifecycle")).toBeInTheDocument();
  });

  it("lists critical paths with their one-line role", async () => {
    stubApi(
      view({
        sections: [
          section("critical_paths", {
            title: "Critical paths",
            files: [
              { path: "src/server.ts", note: "App bootstrap + middleware chain", percentile: 99 },
              { path: "src/lib/redis.ts", note: null, percentile: 70 },
            ],
          }),
        ],
      }),
    );
    renderView();

    expect(await screen.findByText("src/server.ts")).toBeInTheDocument();
    expect(screen.getByText("App bootstrap + middleware chain")).toBeInTheDocument();
    // A file the model wrote no note for still renders — the path is the value.
    expect(screen.getByText("src/lib/redis.ts")).toBeInTheDocument();
  });

  it("numbers the commands and shows their comments", async () => {
    stubApi(
      view({
        sections: [
          section("run_locally", {
            title: "How to run locally",
            commands: [
              { command: "pnpm install", comment: null },
              { command: "pnpm dev", comment: "http://localhost:3000" },
            ],
          }),
        ],
      }),
    );
    renderView();

    const rows = await screen.findAllByTestId("command-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("1")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("pnpm dev")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("http://localhost:3000")).toBeInTheDocument();
  });

  it("shows a stale badge when the index has moved on", async () => {
    stubApi(view({ stale: true }));
    renderView();
    expect(await screen.findByText(/out of date/i)).toBeInTheDocument();
  });

  it("shows the stored error with a retry that posts again", async () => {
    const fetchMock = stubApi(
      view({ status: "failed", sections: [], error: "model exploded", generatedAt: null }),
    );
    renderView();

    expect(await screen.findByText(/model exploded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
    });
  });

  it("builds the on-this-page list from the sections the server sent", async () => {
    stubApi(
      view({
        sections: [
          section("architecture", { title: "Architecture overview", body: "x" }),
          section("critical_paths", { title: "Critical paths" }),
          section("first_tasks", { title: "First tasks" }),
        ],
      }),
    );
    renderView();

    const toc = await screen.findByTestId("tour-toc");
    expect(within(toc).getByText("Architecture overview")).toBeInTheDocument();
    expect(within(toc).getByText("Critical paths")).toBeInTheDocument();
    expect(within(toc).getByText("First tasks")).toBeInTheDocument();
  });

  it("copies the page URL from the share button", async () => {
    stubApi(view());
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: /share link/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/link copied/i)).toBeInTheDocument();
  });

  it("states plainly when a section came back empty", async () => {
    stubApi(view({ sections: [section("first_tasks", { title: "First tasks" })] }));
    renderView();
    expect(await screen.findByText(/not enough signal/i)).toBeInTheDocument();
  });
});
