/**
 * FindingsTab — the `?finding=` deep link from
 * `client/specs/finding-deep-links.md` §5.
 *
 * The whole chain is exercised on purpose: resolving which review owns the
 * finding, opening that accordion, and expanding the card inside it are three
 * components deep and the interesting failures are at the seams. The load-
 * bearing case is that the target is in the SECOND review — the first is open
 * by default, so a passing test on the first would prove nothing.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
// The timeline's cost badge lives in its own namespace.
import runsMessages from "../../../../../../../../messages/en/runs.json";

vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsTab } from "./FindingsTab";

afterEach(cleanup);

beforeEach(() => {
  // jsdom implements no scrolling at all; without this the jump throws.
  Element.prototype.scrollIntoView = vi.fn();
});

function finding(o: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "WARNING",
    category: "bug",
    title: "A finding",
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "why",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  } as FindingRecord;
}

function review(id: string, agent: string, findings: FindingRecord[]): ReviewRecord {
  return {
    id,
    pr_id: "pr1",
    run_id: `run-${id}`,
    agent_name: agent,
    verdict: null,
    summary: null,
    score: null,
    created_at: "2026-08-01T10:00:00.000Z",
    findings,
  } as ReviewRecord;
}

const NEWEST = review("rev1", "newest-agent", [
  finding({ id: "new-1", title: "In the newest run", review_id: "rev1" }),
]);
const OLDER = review("rev2", "older-agent", [
  finding({
    id: "old-1",
    title: "In the older run",
    rationale: "the older run's rationale",
    review_id: "rev2",
    confidence: 0.2,
  }),
]);

function renderTab(targetFindingId: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, runs: runsMessages }}>
      <FindingsTab
        prId="pr1"
        liveRunIds={[]}
        reviewRunning={false}
        lethalTrifecta={[]}
        runs={[NEWEST, OLDER]}
        prRuns={[]}
        prCommits={[]}
        cancelMutation={{ mutate: vi.fn(), isPending: false } as never}
        repoFullName="acme/api"
        prNumber={128}
        targetFindingId={targetFindingId}
        onOpenTrace={vi.fn()}
        onDelete={vi.fn()}
        onRunDone={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("FindingsTab — ?finding= deep link", () => {
  it("opens only the newest run by default", () => {
    renderTab(null);
    expect(screen.getByText("In the newest run")).toBeInTheDocument();
    expect(screen.queryByText("In the older run")).not.toBeInTheDocument();
  });

  it("opens the run that owns the target finding, not the default-open one", () => {
    renderTab("old-1");
    expect(screen.getByText("In the older run")).toBeInTheDocument();
  });

  it("expands the targeted finding and scrolls to it", () => {
    renderTab("old-1");
    // The rationale only renders on an EXPANDED card, and this one is neither
    // first in its panel by luck nor open by default.
    expect(screen.getByText("the older run's rationale")).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("ignores an id no surviving review contains", () => {
    renderTab("deleted-finding");
    expect(screen.getByText("In the newest run")).toBeInTheDocument();
    expect(screen.queryByText("In the older run")).not.toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("re-scrolls when the same finding is asked for twice from the timeline", () => {
    renderTab(null);
    // The newest run's breakdown card, in the accordion header.
    fireEvent.click(screen.getAllByRole("button", { name: /show findings breakdown/i })[0]!);
    const jump = () => screen.getByText("In the newest run", { selector: "button" });

    fireEvent.click(jump());
    const first = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(first).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: /show findings breakdown/i })[0]!);
    fireEvent.click(jump());
    expect(
      (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThan(first);
  });
});
