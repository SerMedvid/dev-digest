import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/conventions.json";
import { ConventionCard } from "./ConventionCard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const candidate: ConventionCandidate = {
  id: "c1",
  category: "error-handling",
  rule: "Always use async/await instead of .then() chains",
  evidence_path: "src/api/users.ts",
  evidence_line: 23,
  evidence_snippet: "const user = await db.users.find(id);",
  confidence: 0.91,
  status: "pending",
};

/** Captures the PATCH so the test can assert what the card sent. */
function stubPatch(response: Partial<ConventionCandidate> = {}) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ ...candidate, ...response }),
  }));
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

function renderCard(over: Partial<ConventionCandidate> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <ConventionCard repoId="r1" candidate={{ ...candidate, ...over }} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function body(mock: ReturnType<typeof stubPatch>, call = 0) {
  return JSON.parse(String(mock.mock.calls[call]![1]!.body));
}

describe("ConventionCard", () => {
  it("shows the rule, its evidence location, the snippet and the confidence", () => {
    stubPatch();
    renderCard();
    expect(screen.getByText(candidate.rule)).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:23")).toBeInTheDocument();
    expect(screen.getByText(candidate.evidence_snippet)).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("error handling")).toBeInTheDocument();
  });

  it("accepts the candidate", async () => {
    const mock = stubPatch({ status: "accepted" });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /^accept$/i }));
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(mock.mock.calls[0]![0]).toContain("/conventions/c1");
    expect(body(mock)).toEqual({ status: "accepted" });
  });

  it("rejects the candidate", async () => {
    const mock = stubPatch({ status: "rejected" });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(body(mock)).toEqual({ status: "rejected" });
  });

  it("marks an accepted candidate as accepted and offers to reject it", () => {
    stubPatch();
    renderCard({ status: "accepted" });
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
  });

  it("edits the rule and its evidence, sending only what changed", async () => {
    const mock = stubPatch();
    const { container } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    // The rule is a Textarea inside a FormField: no accessible name, so reach
    // for the node (see client/INSIGHTS.md).
    const textarea = container.querySelector("textarea")!;
    fireEvent.change(textarea, { target: { value: "Never chain .then()" } });
    fireEvent.change(screen.getByLabelText("Line"), { target: { value: "31" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(body(mock)).toEqual({ rule: "Never chain .then()", evidence_line: 31 });
  });

  it("leaves the candidate untouched when the edit is cancelled", () => {
    const mock = stubPatch();
    const { container } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(mock).not.toHaveBeenCalled();
    expect(screen.getByText(candidate.rule)).toBeInTheDocument();
  });

  it("does not send an empty rule, and says why", () => {
    const mock = stubPatch();
    const { container } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(mock).not.toHaveBeenCalled();
    expect(screen.getByText(/A rule cannot be empty/)).toBeInTheDocument();
  });

  it.each(["abc", "0", "-5", ""])(
    "refuses the line %o out loud instead of dropping it from the patch",
    (bad) => {
      const mock = stubPatch();
      const { container } = renderCard();
      fireEvent.click(screen.getByRole("button", { name: /edit/i }));
      // Edit the rule too: without the guard the rule would save and the bad
      // line would vanish silently, which is the failure being pinned here.
      fireEvent.change(container.querySelector("textarea")!, { target: { value: "Never chain" } });
      fireEvent.change(screen.getByLabelText("Line"), { target: { value: bad } });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(mock).not.toHaveBeenCalled();
      expect(screen.getByText(/Line must be a whole number greater than 0/)).toBeInTheDocument();
      expect(container.querySelector("textarea")!).toHaveValue("Never chain");
    },
  );

  it("surfaces a failed save without losing the user's text", async () => {
    stubFailure();
    const { container } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "Never chain" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/Could not save this convention/)).toBeInTheDocument();
    expect(container.querySelector("textarea")!).toHaveValue("Never chain");
  });
});
