/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import runsMessages from "../../../../../../../../messages/en/runs.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[], findingsByRun?: Map<string, FindingRecord[]>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, runs: runsMessages }}>
      <RunHistory runs={runs} onOpenTrace={() => {}} findingsByRun={findingsByRun} />
    </NextIntlClientProvider>,
  );
}

function finding(o: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    review_id: "rev-1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A live key is committed.",
    confidence: 0.9,
    accepted_at: null,
    dismissed_at: null,
    ...o,
  } as FindingRecord;
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — per-run findings counters", () => {
  it("shows the severity badges for the run's own findings", () => {
    renderRuns(
      [run({ status: "done", findings_count: 2, blockers: 1, score: 40 })],
      new Map([
        [
          "run-1",
          [
            finding({ id: "a", severity: "CRITICAL" }),
            finding({ id: "b", severity: "WARNING" }),
          ],
        ],
      ]),
    );
    expect(screen.getByRole("button", { name: /show findings breakdown/i })).toBeInTheDocument();
  });

  it("shows nothing extra for a run whose review was deleted (no map entry)", () => {
    renderRuns([run({ status: "done", findings_count: 2, blockers: 1, score: 40 })], new Map());
    expect(
      screen.queryByRole("button", { name: /show findings breakdown/i }),
    ).not.toBeInTheDocument();
    // The flat findings text stays, as today.
    expect(screen.getByText(/2 finding/)).toBeInTheDocument();
  });

  it("shows nothing extra when every finding on the run is dismissed", () => {
    renderRuns(
      [run({ status: "done", findings_count: 1, blockers: 0, score: 70 })],
      new Map([["run-1", [finding({ dismissed_at: "2026-07-29T00:00:00.000Z" })]]]),
    );
    expect(
      screen.queryByRole("button", { name: /show findings breakdown/i }),
    ).not.toBeInTheDocument();
  });
});
