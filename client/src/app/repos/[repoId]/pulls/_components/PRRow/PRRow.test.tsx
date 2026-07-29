/**
 * PRRow — the Findings column. Two things matter here and nowhere else:
 * a PR with `null` counts gets an EMPTY cell (no "0", no placeholder), and the
 * counters must not hijack the row's navigation — or be hijacked by it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
// The row also renders a RunCostBadge, which reads the `runs` namespace.
import runsMessages from "../../../../../../../messages/en/runs.json";
import { PRRow } from "./PRRow";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => push(...args) }),
}));

afterEach(() => {
  cleanup();
  push.mockReset();
});

function pr(o: Partial<PrMeta> = {}): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add rate limiting",
    author: "marisa.koch",
    branch: "feat/rl",
    base: "main",
    head_sha: "a1b2c3d4",
    additions: 84,
    deletions: 12,
    files_count: 5,
    status: "needs_review",
    opened_at: null,
    updated_at: null,
    score: 65,
    cost_usd: null,
    ...o,
  };
}

function renderRow(meta: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, runs: runsMessages }}>
      <PRRow pr={meta} repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

const trigger = () => screen.queryByRole("button", { name: /show findings breakdown/i });

describe("PRRow — findings column", () => {
  it("renders an empty cell when the counts are null", () => {
    renderRow(pr({ findings_by_severity: null, findings_preview: null }));
    expect(trigger()).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders an empty cell when the fields are absent entirely", () => {
    renderRow(pr());
    expect(trigger()).not.toBeInTheDocument();
  });

  it("renders the counters when the PR has findings", () => {
    renderRow(
      pr({
        findings_by_severity: { CRITICAL: 1, WARNING: 0, SUGGESTION: 0 },
        findings_preview: [
          {
            id: "f1",
            severity: "CRITICAL",
            category: "security",
            title: "Hardcoded Stripe secret key",
            file: "src/config.ts",
            start_line: 11,
            end_line: 11,
            confidence: 0.95,
            rationale_snippet: "A live Stripe key is committed in source.",
          },
        ],
      }),
    );
    expect(trigger()).toBeInTheDocument();
  });

  it("opens the card without navigating, and still navigates from the rest of the row", () => {
    renderRow(
      pr({
        // More findings than the preview carries — the header shows the true
        // total via totalOverride.
        findings_by_severity: { CRITICAL: 4, WARNING: 3, SUGGESTION: 0 },
        findings_preview: [
          {
            id: "f1",
            severity: "CRITICAL",
            category: "security",
            title: "Hardcoded Stripe secret key",
            file: "src/config.ts",
            start_line: 11,
            end_line: 11,
            confidence: 0.95,
            rationale_snippet: "A live Stripe key is committed in source.",
          },
        ],
      }),
    );

    fireEvent.click(trigger()!);
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("7 findings")).toBeInTheDocument();
    expect(screen.getByText("+6 more")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Hardcoded Stripe secret key"));
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Add rate limiting"));
    expect(push).toHaveBeenCalledWith("/repos/repo-1/pulls/482");
  });
});
