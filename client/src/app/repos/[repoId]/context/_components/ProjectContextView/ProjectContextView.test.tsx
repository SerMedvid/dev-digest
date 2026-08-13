/* ProjectContextView — the read-only Project Context screen, covering DocRow
   through it. The negative assertions are the point of half this file: the
   comps this screen was drawn from carry a `Preview | Edit` toggle, a chunk
   count and a coverage gauge, and none of the three has anything behind it
   (AC-37, AC-38). A test that only asserted the happy path would let all three
   back in. */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NAV, SHORTCUTS, Sidebar, resolveHref } from "@devdigest/ui";
import type { ContextDoc, ContextDocContent, ContextDocList } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/context.json";
import { ProjectContextView } from "./ProjectContextView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DOCS: ContextDoc[] = [
  {
    path: "specs/api-contract.md",
    root: "specs",
    size_bytes: 2048,
    token_estimate: 512,
    used_by_agents: 3,
  },
  {
    path: "server/docs/onion-layers.md",
    root: "docs",
    size_bytes: 1024,
    token_estimate: 256,
    used_by_agents: 1,
  },
  {
    path: "client/insights/ui-notes.md",
    root: "insights",
    size_bytes: 512,
    token_estimate: 128,
    used_by_agents: 0,
  },
];

const CONTENT: ContextDocContent = {
  path: "specs/api-contract.md",
  content: "# API contract\n\nThe canonical contract every endpoint answers to.",
  size_bytes: 2048,
  truncated: false,
};

function list(over: Partial<ContextDocList> = {}): ContextDocList {
  return {
    status: "ok",
    roots: ["specs", "docs", "insights"],
    docs: DOCS,
    omitted: 0,
    scanned_at: "2026-08-13T10:00:00.000Z",
    ...over,
  };
}

/** Discovery + one document, dispatched by URL. `/context/doc` is checked first
    — it also contains `/context`. */
function stubApi(payload: ContextDocList | (() => ContextDocList), content = CONTENT) {
  const fetchMock = vi.fn(async (url: string) => {
    const body = String(url).includes("/context/doc")
      ? content
      : typeof payload === "function"
        ? payload()
        : payload;
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
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ProjectContextView repoId="r1" repoName="payments-api" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ProjectContextView", () => {
  it("lists every document with its root and usage count, and footers the count and the scan time", async () => {
    stubApi(list());
    renderView();

    // One row per document: the path, the root as *text* (AC-53), the count (AC-58).
    for (const doc of DOCS) {
      const row = await screen.findByRole("button", { name: new RegExp(doc.path) });
      expect(within(row).getByText(doc.root)).toBeInTheDocument();
    }
    expect(screen.getByText("Used by 3 agents")).toBeInTheDocument();
    expect(screen.getByText("Used by 1 agent")).toBeInTheDocument();
    expect(screen.getByText("Used by 0 agents")).toBeInTheDocument();

    // AC-38: the footer states the count and the scan time — and the screen
    // carries neither of the two figures the comp invented.
    expect(screen.getByText(/^3 documents · scanned /)).toBeInTheDocument();
    expect(screen.queryAllByText(/chunk/i)).toHaveLength(0);
    expect(screen.queryAllByText(/coverage/i)).toHaveLength(0);

    // AC-37: read-only. No edit affordance, no save affordance, anywhere.
    expect(screen.queryAllByRole("button", { name: /edit|save/i })).toHaveLength(0);
  });

  it("renders the selected document's content in the detail panel", async () => {
    stubApi(list());
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: /specs\/api-contract\.md/ }));

    expect(await screen.findByText("The canonical contract every endpoint answers to.")).toBeInTheDocument();
    // Still read-only once a document is open.
    expect(screen.queryAllByRole("button", { name: /edit|save/i })).toHaveLength(0);
  });

  it("re-runs discovery on rescan and moves the footer timestamp", async () => {
    const stamps = ["2026-08-13T10:00:00.000Z", "2026-08-13T11:30:00.000Z"];
    let call = 0;
    const fetchMock = stubApi(() => list({ scanned_at: stamps[Math.min(call++, 1)]! }));

    renderView();
    const before = (await screen.findByText(/documents · scanned /)).textContent;

    fireEvent.click(screen.getByRole("button", { name: /rescan/i }));

    await waitFor(() =>
      expect(screen.getByText(/documents · scanned /).textContent).not.toBe(before),
    );
    expect(fetchMock.mock.calls.filter((c) => !String(c[0]).includes("/context/doc")).length)
      .toBeGreaterThan(1);
  });

  it("explains a repository that has no clone, and does not call it an error", async () => {
    stubApi(list({ status: "no_clone", docs: [] }));
    renderView();

    expect(await screen.findByText(/payments-api is not cloned/)).toBeInTheDocument();
    // ErrorState renders role="alert"; a missing clone is a 200 and an empty
    // state, never that (AC-40).
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names the roots it searched when a cloned repository has no documents", async () => {
    stubApi(list({ docs: [] }));
    renderView();

    expect(await screen.findByText("No documents found")).toBeInTheDocument();
    for (const root of ["specs", "docs", "insights"]) {
      expect(screen.getByText(root)).toBeInTheDocument();
    }
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the sidebar entry", () => {
  it("opens the active repository's Project Context page from the WORKSPACE group", () => {
    const workspace = NAV.find((g) => g.section === "WORKSPACE");
    expect(workspace?.items.map((i) => i.key)).toContain("context");

    render(<Sidebar ctx={{ repoId: "r1" }} />);
    const group = screen.getByText("WORKSPACE").parentElement!;
    const link = within(group).getByRole("link", { name: "Project Context" });
    expect(link).toHaveAttribute("href", "/repos/r1/context");

    const item = workspace!.items.find((i) => i.key === "context")!;
    expect(resolveHref(item.href, "r1")).toBe("/repos/r1/context");
    expect(SHORTCUTS.map((s) => s.keys)).toContain(`g ${item.gKey}`);
  });
});
