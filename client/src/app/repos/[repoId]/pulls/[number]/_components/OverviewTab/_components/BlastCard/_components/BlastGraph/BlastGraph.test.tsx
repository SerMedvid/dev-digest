import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import messages from "../../../../../../../../../../../../messages/en/blast.json";
import { BlastGraph } from "./BlastGraph";
import { layoutBlastGraph } from "./helpers";
import { GRAPH_WIDTH, GRAPH_HEIGHT, NODE_MARGIN } from "./constants";
import { callerHref } from "../../helpers";

const HEAD = "a1b2c3d4e5f6";
const REPO = "acme/payments-api";

const MAP: BlastRadiusResponse = {
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
        { file: "src/server.ts", line: 88, symbol: "boot", rank: 0.55 },
      ],
      endpoints: ["GET /api/public/items"],
      crons: ["job:reset-rate-buckets"],
    },
  ],
  endpoints: ["GET /api/public/items"],
  crons: ["job:reset-rate-buckets"],
  summary: null,
};

const href = (file: string, line: number | null) => callerHref(REPO, HEAD, file, line);

afterEach(cleanup);

function renderGraph(repoFullName: string | null = REPO) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastGraph data={MAP} headSha={HEAD} repoFullName={repoFullName} />
    </NextIntlClientProvider>,
  );
}

describe("layoutBlastGraph", () => {
  it("is deterministic — same input, identical geometry", () => {
    // The simulation is seeded from a fixed spiral and run to completion, so
    // two renders of one response must produce the same picture.
    expect(layoutBlastGraph(MAP, href)).toEqual(layoutBlastGraph(MAP, href));
  });

  it("places every node inside the canvas", () => {
    const { nodes } = layoutBlastGraph(MAP, href);
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.x).toBeGreaterThanOrEqual(NODE_MARGIN);
      expect(n.x).toBeLessThanOrEqual(GRAPH_WIDTH - NODE_MARGIN);
      expect(n.y).toBeGreaterThanOrEqual(NODE_MARGIN);
      expect(n.y).toBeLessThanOrEqual(GRAPH_HEIGHT - NODE_MARGIN);
    }
  });

  it("emits one node per symbol, caller and fact, deduped", () => {
    const { nodes } = layoutBlastGraph(MAP, href);
    const byKind = (k: string) => nodes.filter((n) => n.kind === k).length;
    expect(byKind("symbol")).toBe(1);
    expect(byKind("caller")).toBe(3);
    expect(byKind("endpoint")).toBe(1);
    expect(byKind("cron")).toBe(1);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
  });

  it("emits one edge per symbol→caller and caller→fact pair, deduped", () => {
    const { edges } = layoutBlastGraph(MAP, href);
    // 3 symbol→caller, plus 3 callers × (1 endpoint + 1 cron).
    expect(edges).toHaveLength(9);
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
    for (const e of edges) {
      expect(Number.isFinite(e.x1)).toBe(true);
      expect(Number.isFinite(e.y2)).toBe(true);
    }
  });

  it("draws no node for a fact the BFS widened past every caller", () => {
    // The response's top-level unions are a SUPERSET of the per-symbol
    // attributions. Drawing the extra one would assert a path the data does
    // not claim, so it stays in the counters and out of the graph.
    const widened: BlastRadiusResponse = {
      ...MAP,
      endpoints: [...MAP.endpoints, "GET /api/public/health"],
    };
    const { nodes } = layoutBlastGraph(widened, href);
    expect(nodes.some((n) => n.label === "GET /api/public/health")).toBe(false);
  });

  it("builds node hrefs with the same helper the tree uses", () => {
    const { nodes } = layoutBlastGraph(MAP, href);
    const caller = nodes.find((n) => n.label === "src/api/public/index.ts")!;
    expect(caller.href).toBe(callerHref(REPO, HEAD, "src/api/public/index.ts", 23));
    // Endpoint and cron nodes have no file behind them, so they never link.
    for (const n of nodes.filter((x) => x.kind === "endpoint" || x.kind === "cron")) {
      expect(n.href).toBeNull();
    }
  });

  it("drops every href when the repo is unknown", () => {
    const { nodes } = layoutBlastGraph(MAP, () => null);
    expect(nodes.every((n) => n.href === null)).toBe(true);
  });
});

describe("BlastGraph", () => {
  it("renders an svg labelled for assistive tech", () => {
    renderGraph();
    const svg = screen.getByRole("img", { name: "Blast radius graph" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });

  it("draws one line per edge", () => {
    const { container } = renderGraph();
    expect(container.querySelectorAll("line")).toHaveLength(9);
  });

  it("links caller and symbol nodes, never endpoint or cron nodes", () => {
    renderGraph();
    const labels = screen.getAllByRole("link").map((l) => l.textContent ?? "");
    expect(labels.some((x) => x.includes("src/api/public/index.ts"))).toBe(true);
    expect(labels.some((x) => x.includes("GET /api/public/items"))).toBe(false);
    expect(labels.some((x) => x.includes("job:reset-rate-buckets"))).toBe(false);
  });

  it("renders no link at all when the repo is unknown", () => {
    renderGraph(null);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // The nodes are still drawn — losing the link must not lose the diagram.
    expect(screen.getByText("src/api/public/index.ts")).toBeInTheDocument();
  });
});
