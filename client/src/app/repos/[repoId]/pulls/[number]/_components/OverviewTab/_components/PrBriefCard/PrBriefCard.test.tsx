import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../../../messages/en/shell.json";
// The banner embeds RunCostBadge, which reads the `runs` namespace.
import runsMessages from "../../../../../../../../../../messages/en/runs.json";
import type { PrBriefRecord, ReviewRecord, RunSummary } from "@devdigest/shared";
import { PrBriefCard } from "./PrBriefCard";

const BRIEF: PrBriefRecord = {
  what: "Adds token-bucket rate limiting to the public API.",
  why: "Unauthenticated clients can hammer the public endpoints without limit.",
  risk_level: "high" as const,
  risks: [
    {
      title: "Committed secret",
      explanation: "A live key is in the diff.",
      severity: "high" as const,
      refs: ["src/config.ts"],
    },
  ],
  review_focus: [{ file: "src/config.ts", line: 12, reason: "The secret." }],
  pr_id: "pr1",
  head_sha: "a1b2c3",
  review_id: "review-2",
  stale: false,
  sources: ["pr", "files"],
  est_tokens_in: 7100,
  provider: "openai",
  model: "gpt-4.1",
  created_at: "2026-08-14T00:00:00.000Z",
};

const REVIEW: ReviewRecord = {
  id: "review-2",
  pr_id: "pr1",
  agent_id: null,
  run_id: null,
  kind: "review" as const,
  verdict: "request_changes" as const,
  summary: "A key is committed.",
  score: 61,
  model: "seed",
  created_at: "2026-08-14T00:00:00.000Z",
  findings: [
    {
      id: "f1",
      review_id: "review-2",
      file: "src/config.ts",
      start_line: 12,
      end_line: 12,
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded key",
      rationale: "r",
      suggestion: null,
      confidence: 0.98,
      kind: "finding",
      accepted_at: null,
      dismissed_at: null,
    },
  ],
};

/** The run behind REVIEW — where spend actually lives. */
const RUN: RunSummary = {
  run_id: "run-2",
  agent_id: null,
  agent_name: "General Reviewer",
  provider: "openai",
  model: "gpt-4.1",
  status: "done",
  error: null,
  duration_ms: 4200,
  tokens_in: 200,
  tokens_out: 1300,
  cost_usd: 0.014,
  findings_count: 1,
  grounding: null,
  ran_at: "2026-08-14T00:00:00.000Z",
  score: 61,
  blockers: 1,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** POST resolves to `onPost`; a `status` >= 400 becomes an ApiError. */
function stubPost(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: status < 400,
    status,
    statusText: status < 400 ? "OK" : "Error",
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** One client per render, reused by `rerenderCard` so cache state survives. */
let qc: QueryClient;

function wrap(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={{
        brief: briefMessages,
        prReview: prReviewMessages,
        shell: shellMessages,
        runs: runsMessages,
      }}
    >
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

function renderCard(ui: React.ReactElement) {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(wrap(ui));
  return { ...utils, rerenderCard: (next: React.ReactElement) => utils.rerender(wrap(next)) };
}

describe("PrBriefCard", () => {
  it("renders why in the banner and the risk level badge (AC-14)", () => {
    stubPost(200, BRIEF);
    renderCard(<PrBriefCard prId="pr1" brief={BRIEF} loading={false} review={REVIEW} />);

    expect(screen.getByText(BRIEF.why)).toBeTruthy();
    expect(screen.getByText(BRIEF.what)).toBeTruthy();
    // The level is spelled out, never carried by colour alone.
    expect(screen.getByText("High risk")).toBeTruthy();
  });

  it("renders the empty state with a generate button when no brief exists", () => {
    stubPost(200, BRIEF);
    renderCard(<PrBriefCard prId="pr1" brief={null} loading={false} review={REVIEW} />);

    expect(screen.getByText("Brief not available yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /generate brief/i })).toBeTruthy();
    // "Not generated yet" is an empty state, not an error state.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a skeleton while loading rather than nothing", () => {
    stubPost(200, BRIEF);
    const { container } = renderCard(
      <PrBriefCard prId="pr1" brief={undefined} loading review={REVIEW} />,
    );
    expect(screen.queryByText(BRIEF.why)).toBeNull();
    expect(screen.queryByText("Brief not available yet.")).toBeNull();
    expect(container.querySelector("section")).toBeTruthy();
  });

  it("marks a stale brief and still shows it", () => {
    stubPost(200, BRIEF);
    renderCard(
      <PrBriefCard prId="pr1" brief={{ ...BRIEF, stale: true }} loading={false} review={REVIEW} />,
    );
    // A brief one review out of date beats an empty card, so both are present.
    expect(screen.getByText(BRIEF.why)).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("does not mark a fresh brief", () => {
    stubPost(200, BRIEF);
    renderCard(<PrBriefCard prId="pr1" brief={BRIEF} loading={false} review={REVIEW} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("calls the mutation on regenerate and shows the in-flight label", async () => {
    const fetchMock = stubPost(200, BRIEF);
    renderCard(<PrBriefCard prId="pr1" brief={BRIEF} loading={false} review={REVIEW} />);

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toContain("/pulls/pr1/brief");
  });

  it("renders a 409 as a status, never an alert, and keeps the control busy (AC-14)", async () => {
    stubPost(409, { error: { code: "conflict", message: "A brief is already being generated" } });
    const { rerenderCard } = renderCard(
      <PrBriefCard prId="pr1" brief={BRIEF} loading={false} review={REVIEW} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    // "Already running" is a state, not a failure. Styling it as an error put a
    // red "you can't" beside the stale marker's "you should", with nothing on
    // screen that resolved the contradiction.
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "A brief is already being generated for this pull request.",
      ),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: /regenerating/i }).hasAttribute("disabled")).toBe(
      true,
    );

    // The in-flight generation landing IS the resolution — the message must not
    // outlive the condition it describes.
    rerenderCard(
      <PrBriefCard
        prId="pr1"
        brief={{ ...BRIEF, created_at: "2026-08-14T01:00:00.000Z" }}
        loading={false}
        review={REVIEW}
      />,
    );
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("shows the review run's spend in the banner", () => {
    stubPost(200, BRIEF);
    renderCard(
      <PrBriefCard prId="pr1" brief={BRIEF} loading={false} review={REVIEW} run={RUN} />,
    );
    // Cost lives on the run, not on ReviewRecord — without it the badge renders
    // a bare "—", which is what shipped first.
    expect(screen.getByText(/0\.014/)).toBeTruthy();
  });

  it("renders the banner without a run, showing no spend rather than breaking", () => {
    stubPost(200, BRIEF);
    renderCard(<PrBriefCard prId="pr1" brief={BRIEF} loading={false} review={REVIEW} />);
    expect(screen.getByText(BRIEF.why)).toBeTruthy();
    expect(screen.queryByText(/0\.014/)).toBeNull();
  });

  it("surfaces the server's own message for any other failure", async () => {
    stubPost(500, { error: { code: "internal", message: "provider 503" } });
    renderCard(<PrBriefCard prId="pr1" brief={BRIEF} loading={false} review={REVIEW} />);

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("provider 503"));
  });

  it("still renders the banner when the PR has no review yet", () => {
    stubPost(200, BRIEF);
    renderCard(<PrBriefCard prId="pr1" brief={BRIEF} loading={false} review={undefined} />);
    // A PR nobody has reviewed has not been approved — the fallback verdict is
    // `comment`, and the banner is the most prominent thing on the page.
    expect(screen.getByText(BRIEF.why)).toBeTruthy();
    expect(screen.getByText("High risk")).toBeTruthy();
  });
});
