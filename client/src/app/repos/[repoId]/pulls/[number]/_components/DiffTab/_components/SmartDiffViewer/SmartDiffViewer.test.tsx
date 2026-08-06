import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { SmartDiff, PrFile } from "@devdigest/shared";
import { ToastProvider } from "../../../../../../../../../lib/toast";
import prReviewMessages from "../../../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";
import { DiffTab } from "../../DiffTab";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Three groups, mirroring the seeded PR's shape: a finding-bearing core file
// (starts open — §6.2 rule 2), a plain wiring file, and a finding-bearing
// boilerplate lock file (starts collapsed anyway — §6.2 rule 1 wins over 2).
const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/middleware/ratelimit.ts",
          pseudocode_summary: null,
          additions: 84,
          deletions: 0,
          finding_lines: [10],
          finding_marks: [{ line: 10, severity: "CRITICAL", finding_id: "f1" }],
        },
        {
          path: "src/api/users.ts",
          pseudocode_summary: null,
          additions: 7,
          deletions: 2,
          finding_lines: [],
          finding_marks: [],
        },
      ],
    },
    {
      role: "wiring",
      files: [
        {
          path: "src/config.ts",
          pseudocode_summary: null,
          additions: 4,
          deletions: 0,
          finding_lines: [],
          finding_marks: [],
        },
      ],
    },
    {
      role: "boilerplate",
      files: [
        {
          path: "package-lock.json",
          pseudocode_summary: null,
          additions: 92,
          deletions: 24,
          finding_lines: [5],
          finding_marks: [{ line: 5, severity: "WARNING", finding_id: "f2" }],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 207, proposed_splits: [] },
};

const FILES: PrFile[] = [
  {
    path: "src/middleware/ratelimit.ts",
    additions: 84,
    deletions: 0,
    // Hunk starts the new side at line 10 — matches finding_marks[0].line.
    patch:
      "@@ -1,1 +10,3 @@\n-old limiter stub\n+const limiter = new Map();\n+const WINDOW_MS = 60000;\n context line",
  },
  {
    path: "src/api/users.ts",
    additions: 7,
    deletions: 2,
    patch: "@@ -1,1 +1,2 @@\n-const x = 1;\n+const x = 2;\n+const y = 3;",
  },
  {
    path: "src/config.ts",
    additions: 4,
    deletions: 0,
    patch: "@@ -1,1 +1,2 @@\n-const port = 3000;\n+const port = 3001;\n+const host = 'localhost';",
  },
  {
    path: "package-lock.json",
    additions: 92,
    deletions: 24,
    // New side starts at line 5 — matches finding_marks[0].line.
    patch: '@@ -1,1 +5,2 @@\n-old\n+"lockfileVersion": 3,\n+"packages": {}',
  },
];

function stubFetch(opts?: {
  postStatus?: number;
  postErrorMessage?: string;
}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (init?.method === "POST") {
      if (opts?.postStatus && opts.postStatus >= 400) {
        return {
          ok: false,
          status: opts.postStatus,
          statusText: "Error",
          json: async () => ({ error: { message: opts.postErrorMessage ?? "boom" } }),
        };
      }
      const body = init.body ? JSON.parse(init.body as string) : {};
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          pr_id: "pr1",
          path: body.path,
          head_sha: "sha-1",
          summary: "Rate-limits public API requests with a token bucket.",
          provider: "openrouter",
          model: "gpt-4.1-mini",
          created_at: "2026-08-06T00:00:00Z",
        }),
      };
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => SMART_DIFF };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function renderViewer(ui: React.ReactElement, { retry = false }: { retry?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry } } });
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
      <ToastProvider>
        <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("SmartDiffViewer", () => {
  it("renders all three groups, in fixed order, with their labels and file counts", async () => {
    stubFetch();
    const { container } = renderViewer(
      <SmartDiffViewer prId="pr1" files={FILES} onOpenFinding={vi.fn()} />,
    );

    await screen.findByText("Core");
    expect(screen.getByText("Wiring")).toBeInTheDocument();
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();
    // 2 core files, 1 wiring file, 1 boilerplate file.
    expect(screen.getAllByText("2 files")).toHaveLength(1);
    expect(screen.getAllByText("1 files")).toHaveLength(2);

    const text = container.textContent ?? "";
    expect(text.indexOf("Core")).toBeLessThan(text.indexOf("Wiring"));
    expect(text.indexOf("Wiring")).toBeLessThan(text.indexOf("Boilerplate"));
  });

  it("opens a finding-bearing core file by default (§6.2 rule 2)", async () => {
    stubFetch();
    renderViewer(<SmartDiffViewer prId="pr1" files={FILES} onOpenFinding={vi.fn()} />);

    expect(await screen.findByText("const limiter = new Map();")).toBeInTheDocument();
  });

  it("keeps a finding-bearing boilerplate file collapsed, but still shows its badge (§6.2 rule 1)", async () => {
    stubFetch();
    renderViewer(<SmartDiffViewer prId="pr1" files={FILES} onOpenFinding={vi.fn()} />);

    await screen.findByText("package-lock.json");
    expect(screen.queryByText('"packages": {}')).not.toBeInTheDocument();

    const header = screen.getByText("package-lock.json").closest("div")!;
    expect(within(header).getByText("1 findings")).toBeInTheDocument();
  });

  it("expands the boilerplate file and scrolls to its first marked line when its badge is clicked", async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    stubFetch();
    renderViewer(<SmartDiffViewer prId="pr1" files={FILES} onOpenFinding={vi.fn()} />);

    await screen.findByText("package-lock.json");
    const header = screen.getByText("package-lock.json").closest("div")!;
    fireEvent.click(within(header).getByText("1 findings"));

    await waitFor(() => expect(screen.getByText('"packages": {}')).toBeInTheDocument());
    expect(scrollSpy).toHaveBeenCalled();
  });

  it("navigates to the finding when a line's severity chip is clicked", async () => {
    stubFetch();
    const onOpenFinding = vi.fn();
    renderViewer(<SmartDiffViewer prId="pr1" files={FILES} onOpenFinding={onOpenFinding} />);

    await screen.findByText("const limiter = new Map();");
    fireEvent.click(screen.getByRole("button", { name: /critical finding/i }));

    expect(onOpenFinding).toHaveBeenCalledWith("f1");
  });

  it("summary pill: posts { path }, shows a pending label, then renders the sentence on success", async () => {
    const { fetchMock } = stubFetch();
    renderViewer(<SmartDiffViewer prId="pr1" files={FILES} onOpenFinding={vi.fn()} />);

    await screen.findByText("src/api/users.ts");
    const header = screen.getByText("src/api/users.ts").closest("div")!;
    const pill = within(header).getByText("✨ Summarize");
    fireEvent.click(pill);

    // Synchronous state update — no await needed before this assertion.
    expect(within(header).getByText("Summarizing…")).toBeInTheDocument();

    await waitFor(() =>
      expect(
        screen.getByText("Rate-limits public API requests with a token bucket."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("What this does:")).toBeInTheDocument();

    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    )!;
    expect(JSON.parse((postCall[1] as RequestInit).body as string)).toEqual({
      path: "src/api/users.ts",
    });
  });

  it("summary pill: toasts the error and returns to idle on failure", async () => {
    stubFetch({ postStatus: 500, postErrorMessage: "provider unavailable" });
    renderViewer(<SmartDiffViewer prId="pr1" files={FILES} onOpenFinding={vi.fn()} />, {
      retry: false,
    });

    await screen.findByText("src/api/users.ts");
    const header = screen.getByText("src/api/users.ts").closest("div")!;
    fireEvent.click(within(header).getByText("✨ Summarize"));

    expect(await screen.findByText("provider unavailable")).toBeInTheDocument();
    // Back to idle — the pending label is gone and the button is clickable again.
    expect(within(header).getByText("✨ Summarize")).toBeInTheDocument();
  });

  it("summary pill: surfaces the honest 'no diff to summarize' message on a 404, not the raw server text", async () => {
    stubFetch({
      postStatus: 404,
      // The server's own message for this case ("This file has no stored diff
      // to summarize") is deliberately NOT what should reach the toast — the
      // client owns its own i18n-catalogued copy for this specific case.
      postErrorMessage: "This file has no stored diff to summarize",
    });
    renderViewer(<SmartDiffViewer prId="pr1" files={FILES} onOpenFinding={vi.fn()} />, {
      retry: false,
    });

    await screen.findByText("src/api/users.ts");
    const header = screen.getByText("src/api/users.ts").closest("div")!;
    fireEvent.click(within(header).getByText("✨ Summarize"));

    expect(
      await screen.findByText("There's no diff to summarize for this file."),
    ).toBeInTheDocument();
    expect(within(header).getByText("✨ Summarize")).toBeInTheDocument();
  });
});

describe("DiffTab order toggle", () => {
  function stubCommentsFetch() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => [] })),
    );
  }

  function renderTab(ui: React.ReactElement) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
        <ToastProvider>
          <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
        </ToastProvider>
      </NextIntlClientProvider>,
    );
  }

  it("renders today's flat DiffViewer, with SmartDiffViewer absent, under ?order=original", async () => {
    stubCommentsFetch();
    renderTab(
      <DiffTab
        prId="pr1"
        filesCount={FILES.length}
        files={FILES}
        order="original"
        onSetOrder={vi.fn()}
        onOpenFinding={vi.fn()}
      />,
    );

    expect(await screen.findByText("src/config.ts")).toBeInTheDocument();
    expect(screen.queryByText("Smart Diff · grouped by role")).not.toBeInTheDocument();
  });
});
