import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../../messages/en/blast.json";
import { BlastCard } from "./BlastCard";

const HEAD = "a1b2c3d4e5f6";

const OK_MAP = {
  status: "ok",
  reason: null,
  head_sha: HEAD,
  changed_symbols: [
    {
      name: "rateLimit",
      kind: "function",
      file: "src/middleware/ratelimit.ts",
      line: 12,
      callers: [
        { file: "src/api/public/index.ts", line: 23, symbol: "publicRouter", rank: 0.92 },
        { file: "src/api/public/webhooks.ts", line: 45, symbol: "handleWebhook", rank: 0.71 },
      ],
      endpoints: ["GET /api/public/items"],
      crons: [],
    },
  ],
  endpoints: ["GET /api/public/items", "GET /api/public/health"],
  crons: ["job:reset-rate-buckets"],
  summary: null,
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
      statusText: status < 400 ? "OK" : "Server Error",
      json: async () => body,
    })),
  );
}

/** GET returns `map`; POST (the Explain call) returns `onPost`. */
function stubFetchWithExplain(map: unknown, onPost: unknown) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.method === "POST" ? onPost : map;
    return { ok: true, status: 200, statusText: "OK", json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderCard(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

function card(props: Partial<React.ComponentProps<typeof BlastCard>> = {}) {
  return (
    <BlastCard prId="pr1" headSha={HEAD} repoFullName="acme/payments-api" {...props} />
  );
}

describe("BlastCard — data", () => {
  it("renders the symbol, its callers and its endpoint chip", async () => {
    stubFetch(200, OK_MAP);
    renderCard(card());

    expect(await screen.findByText("rateLimit")).toBeInTheDocument();
    expect(screen.getByText("src/middleware/ratelimit.ts:12")).toBeInTheDocument();
    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
    expect(screen.getByText("publicRouter")).toBeInTheDocument();
    expect(screen.getByText("GET /api/public/items")).toBeInTheDocument();
  });

  it("SHA-pins every caller link so the line number stays right", async () => {
    stubFetch(200, OK_MAP);
    renderCard(card());

    const link = await screen.findByRole("link", { name: "src/api/public/index.ts:23" });
    expect(link).toHaveAttribute(
      "href",
      `https://github.com/acme/payments-api/blob/${HEAD}/src/api/public/index.ts#L23`,
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders rows as plain text — never a dead link — when the repo is unknown", async () => {
    stubFetch(200, OK_MAP);
    renderCard(card({ repoFullName: null }));

    expect(await screen.findByText("src/api/public/index.ts:23")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("counts callers across symbols, and endpoints from the widened union", async () => {
    stubFetch(200, OK_MAP);
    renderCard(card());
    await screen.findByText("rateLimit");

    // Each counter is `<span><span>N</span><span>label</span></span>`.
    const counter = (label: string) => screen.getByText(label).parentElement;
    expect(counter("symbols")).toHaveTextContent("1symbols");
    expect(counter("callers")).toHaveTextContent("2callers");
    // 2, not 1: the top-level union is BFS-widened past the per-symbol chips.
    expect(counter("endpoints")).toHaveTextContent("2endpoints");
    expect(counter("cron/jobs")).toHaveTextContent("1cron/jobs");
  });
});

describe("BlastCard — states", () => {
  it("shows a skeleton first, keeping the card footprint", () => {
    stubFetch(200, OK_MAP);
    renderCard(card());
    expect(screen.getByText("Blast radius")).toBeInTheDocument();
    expect(screen.queryByText("rateLimit")).not.toBeInTheDocument();
  });

  it("surfaces a load error and retries the GET (not a paid POST)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: async () => ({ error: { message: "index unavailable" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderCard(card());

    expect(await screen.findByText("index unavailable")).toBeInTheDocument();
    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
    // Every call is the GET — retrying a failed read must not spend a model call.
    for (const [, init] of fetchMock.mock.calls as unknown as Array<[string, RequestInit?]>) {
      expect(init?.method ?? "GET").toBe("GET");
    }
  });

  it("partial still renders the tree, with a warning above it", async () => {
    stubFetch(200, { ...OK_MAP, status: "partial", reason: "index_stale" });
    renderCard(card());

    expect(await screen.findByText(/some callers may be missing/i)).toBeInTheDocument();
    expect(screen.getByText("rateLimit")).toBeInTheDocument();
  });

  it("degraded explains itself and renders no tree, no counters, no Explain", async () => {
    stubFetch(200, {
      status: "degraded",
      reason: "no_data",
      head_sha: HEAD,
      changed_symbols: [],
      endpoints: [],
      crons: [],
      summary: null,
    });
    renderCard(card());

    expect(await screen.findByText(/Index not usable/i)).toBeInTheDocument();
    // An empty tree beside a "0 callers" counter would read as an all-clear.
    expect(screen.queryByText(/cron\/jobs/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^explain$/i })).not.toBeInTheDocument();
  });

  it("ok-with-no-symbols is a true empty state, distinct from degraded", async () => {
    stubFetch(200, {
      status: "ok",
      reason: null,
      head_sha: HEAD,
      changed_symbols: [],
      endpoints: [],
      crons: [],
      summary: null,
    });
    renderCard(card());

    expect(await screen.findByText(/No indexed symbols in the changed files/i)).toBeInTheDocument();
    expect(screen.queryByText(/Index not usable/i)).not.toBeInTheDocument();
    // Counters are present — "0" here is a real measurement.
    expect(screen.getByText(/cron\/jobs/)).toBeInTheDocument();
  });
});

describe("BlastCard — Tree | Graph toggle", () => {
  it("starts on the tree and switches to the graph without a refetch", async () => {
    const fetchMock = stubFetchWithExplain(OK_MAP, {});
    renderCard(card());

    await screen.findByText("rateLimit");
    expect(screen.queryByRole("img", { name: /blast radius graph/i })).not.toBeInTheDocument();
    const before = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /^graph$/i }));
    expect(screen.getByRole("img", { name: /blast radius graph/i })).toBeInTheDocument();
    // Both views render the SAME response — toggling must cost no request.
    expect(fetchMock.mock.calls).toHaveLength(before);

    fireEvent.click(screen.getByRole("button", { name: /^tree$/i }));
    expect(screen.queryByRole("img", { name: /blast radius graph/i })).not.toBeInTheDocument();
  });

  it("marks the active view as pressed", async () => {
    stubFetch(200, OK_MAP);
    renderCard(card());
    await screen.findByText("rateLimit");

    expect(screen.getByRole("button", { name: /^tree$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: /^graph$/i }));
    expect(screen.getByRole("button", { name: /^graph$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("hides the toggle entirely on a degraded map", async () => {
    stubFetch(200, {
      status: "degraded",
      reason: "no_data",
      head_sha: HEAD,
      changed_symbols: [],
      endpoints: [],
      crons: [],
      summary: null,
    });
    renderCard(card());

    await screen.findByText(/Index not usable/i);
    expect(screen.queryByRole("button", { name: /^graph$/i })).not.toBeInTheDocument();
  });

  it("hides the toggle when there are no symbols to draw", async () => {
    stubFetch(200, {
      status: "ok",
      reason: null,
      head_sha: HEAD,
      changed_symbols: [],
      endpoints: [],
      crons: [],
      summary: null,
    });
    renderCard(card());

    await screen.findByText(/No indexed symbols/i);
    expect(screen.queryByRole("button", { name: /^graph$/i })).not.toBeInTheDocument();
  });
});

describe("BlastCard — Explain", () => {
  it("posts once and renders the returned paragraph", async () => {
    const fetchMock = stubFetchWithExplain(OK_MAP, {
      summary: "Touches the rate limiter every public route depends on.",
      head_sha: HEAD,
    });
    renderCard(card());

    fireEvent.click(await screen.findByRole("button", { name: /^explain$/i }));
    expect(
      await screen.findByText(/Touches the rate limiter every public route depends on/),
    ).toBeInTheDocument();

    const posts = (fetchMock.mock.calls as unknown as Array<[string, RequestInit?]>).filter(
      ([, init]) => init?.method === "POST",
    );
    expect(posts).toHaveLength(1);
  });

  it("hides the button once a summary is present — no paid re-run at the same head", async () => {
    stubFetch(200, { ...OK_MAP, summary: "Already explained." });
    renderCard(card());

    expect(await screen.findByText("Already explained.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^explain$/i })).not.toBeInTheDocument();
  });

  it("reports an Explain failure inline as an alert, next to the button", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return {
          ok: false,
          status: 422,
          statusText: "Unprocessable",
          json: async () => ({ error: { message: "Blast map is degraded" } }),
        };
      }
      return { ok: true, status: 200, statusText: "OK", json: async () => OK_MAP };
    });
    vi.stubGlobal("fetch", fetchMock);
    renderCard(card());

    fireEvent.click(await screen.findByRole("button", { name: /^explain$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Blast map is degraded");
    // The button stays, so the user can retry after fixing the cause.
    expect(screen.getByRole("button", { name: /^explain$/i })).toBeInTheDocument();
  });
});
