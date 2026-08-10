import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import messages from "../../../../../../../../../../../../messages/en/blast.json";
import { BlastGraph } from "./BlastGraph";
import { layoutBlastGraph } from "./helpers";
import { COLUMN_X, GRAPH_WIDTH, LABEL_DX, ROW_PITCH } from "./constants";
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

/** A map the size a real PR produces — the case the fixed viewBox could not hold. */
function bigMap(symbols: number, callersEach: number): BlastRadiusResponse {
  return {
    ...MAP,
    changed_symbols: Array.from({ length: symbols }, (_, i) => ({
      name: `symbol${i}`,
      kind: "method",
      file: `src/modules/thing${i}/service.ts`,
      line: 10 + i,
      callers: Array.from({ length: callersEach }, (_, j) => ({
        file: `src/modules/caller${(i * callersEach + j) % 40}/routes.ts`,
        line: 100 + j,
        symbol: `caller${j}`,
        rank: 0.5,
      })),
      endpoints: i % 4 === 0 ? [`GET /api/thing${i}`] : [],
      crons: [],
    })),
  };
}

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

  it("places every node inside the canvas it reports", () => {
    const { nodes, width, height } = layoutBlastGraph(MAP, href);
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(width);
      expect(n.y).toBeGreaterThan(0);
      expect(n.y).toBeLessThan(height);
    }
  });

  it("lays symbols, callers and facts out in three left-to-right columns", () => {
    const { nodes } = layoutBlastGraph(MAP, href);
    const xOf = (k: string) => new Set(nodes.filter((n) => n.kind === k).map((n) => n.x));
    // Every node of a kind shares one x, and the kinds read in flow order.
    expect([...xOf("symbol")]).toEqual([COLUMN_X[0]]);
    expect([...xOf("caller")]).toEqual([COLUMN_X[1]]);
    expect([...xOf("endpoint")]).toEqual([COLUMN_X[2]]);
    expect([...xOf("cron")]).toEqual([COLUMN_X[2]]);
    expect(COLUMN_X[0]).toBeLessThan(COLUMN_X[1]);
    expect(COLUMN_X[1]).toBeLessThan(COLUMN_X[2]);
  });

  it("never lets two labels share a band, however large the map", () => {
    // The old force layout clamped every out-of-box node onto the border, which
    // stacked 72 nodes onto 11 distinct y values. Rows are the fix: two nodes
    // may share a y only if they sit in different columns.
    const { nodes } = layoutBlastGraph(bigMap(25, 5), href);
    expect(nodes.length).toBeGreaterThan(60);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        if (a.x !== b.x) continue;
        expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(ROW_PITCH);
      }
    }
  });

  it("grows the canvas with the map rather than packing nodes tighter", () => {
    const small = layoutBlastGraph(MAP, href);
    const large = layoutBlastGraph(bigMap(25, 5), href);
    expect(large.height).toBeGreaterThan(small.height * 3);
    // Width is fixed — the columns are what the dialog is sized for; only the
    // row count grows, and the modal body scrolls.
    expect(large.width).toBe(GRAPH_WIDTH);
    expect(small.width).toBe(GRAPH_WIDTH);
  });

  it("starts an outgoing edge clear of its own label", () => {
    // An edge leaving from the dot would be drawn straight through the label
    // text sitting beside it.
    const { nodes } = layoutBlastGraph(MAP, href);
    for (const n of nodes) {
      expect(n.outX).toBeGreaterThan(n.x + LABEL_DX);
    }
  });

  it("orders callers to follow the symbol that calls them", () => {
    // Crossing reduction: with one symbol per caller the caller column must
    // come out in the symbols' own order, not the order the ids hash to.
    const data: BlastRadiusResponse = {
      ...MAP,
      changed_symbols: ["alpha", "beta", "gamma"].map((name, i) => ({
        name,
        kind: "function",
        file: `src/${name}.ts`,
        line: 1,
        callers: [{ file: `src/callers/${name}-caller.ts`, line: 5, symbol: "use", rank: 0.5 }],
        endpoints: [],
        crons: [],
      })),
    };
    const { nodes } = layoutBlastGraph(data, href);
    const callers = nodes.filter((n) => n.kind === "caller").sort((a, b) => a.y - b.y);
    expect(callers.map((c) => c.label)).toEqual([
      "src/callers/alpha-caller.ts",
      "src/callers/beta-caller.ts",
      "src/callers/gamma-caller.ts",
    ]);
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

  it("draws one curve per edge", () => {
    const { container } = renderGraph();
    // Edges are paths; the one `line` in the drawing is the header rule.
    expect(container.querySelectorAll("path")).toHaveLength(9);
  });

  it("heads each column so the diagram reads without the legend", () => {
    renderGraph();
    for (const heading of ["Changed symbols", "Callers", "Exposes"]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
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
