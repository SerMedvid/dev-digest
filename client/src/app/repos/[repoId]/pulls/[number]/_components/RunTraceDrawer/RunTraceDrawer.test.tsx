import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.0134, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

/** What the mocked `useRunTrace` hands back; a case re-points it before rendering. */
let traceData: RunTrace = TRACE;

vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: traceData, isLoading: false }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(() => {
  cleanup();
  traceData = TRACE;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });

  /* AC-35. The slot is fed from stored configuration now, so `(dynamic)` is
     actively false and the label has to say what the block is — attached specs —
     and that its contents are untrusted. The Prompt-assembly section is
     `defaultOpen={false}`, so it has to be opened before the block's label
     exists in the DOM at all. */
  it("names the project-context prompt block as attached, untrusted specs", () => {
    traceData = {
      ...TRACE,
      prompt_assembly: {
        ...TRACE.prompt_assembly,
        specs: '## Project context\n<untrusted source="spec-0">\n# API contract\n</untrusted>',
      },
    };
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);

    fireEvent.click(screen.getByText("Prompt assembly"));

    expect(screen.getByText("Project context — attached specs (untrusted)")).toBeInTheDocument();
    expect(screen.queryByText("Project context (dynamic)")).toBeNull();
  });

  /* AC-33: `RunTrace` gained no field, so an archived trace whose `specs_read` is
     the hardcoded empty array still renders — as "none", not as a crash or a gap.
     Scoped to the row, because "none" is not a unique string on this surface. */
  it("still renders an empty specs_read as none", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);

    const row = screen.getByText("Specs read").parentElement!;
    expect(within(row).getByText("none")).toBeInTheDocument();
  });

  /* The guard is real: no persisted specs block, no label. Without this the
     AC-35 assertion above could be satisfied by a label rendered unconditionally. */
  it("renders no project-context block when the trace has none", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);

    fireEvent.click(screen.getByText("Prompt assembly"));

    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.queryByText("Project context — attached specs (untrusted)")).toBeNull();
  });
});
