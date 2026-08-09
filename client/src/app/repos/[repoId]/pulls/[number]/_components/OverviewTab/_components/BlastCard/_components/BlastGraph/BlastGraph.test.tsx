import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import messages from "../../../../../../../../../../../../messages/en/blast.json";
import { BlastGraph } from "./BlastGraph";
import { layoutBlastGraph } from "./helpers";
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
    const a = layoutBlastGraph(MAP, href, 720);
    const b = layoutBlastGraph(MAP, href, 720);
    expect(a).toEqual(b);
  });

  it("places the three columns at distinct, ascending x", () => {
    const { nodes } = layoutBlastGraph(MAP, href, 720);
    const xByCol = new Map<number, number>();
    for (const n of nodes) {
      const seen = xByCol.get(n.col);
      // Every node in a column shares one x — that is what makes it a column.
      if (seen !== undefined) expect(n.x).toBe(seen);
      else xByCol.set(n.col, n.x);
    }
    const xs = [xByCol.get(0)!, xByCol.get(1)!, xByCol.get(2)!];
    expect(xs[0]).toBeLessThan(xs[1]!);
    expect(xs[1]).toBeLessThan(xs[2]!);
  });

  it("stacks callers in the input's rank-descending order", () => {
    const { nodes } = layoutBlastGraph(MAP, href, 720);
    const callers = nodes.filter((n) => n.kind === "caller");
    expect(callers.map((n) => n.label)).toEqual([
      "src/api/public/index.ts",
      "src/api/public/webhooks.ts",
      "src/server.ts",
    ]);
    // Higher rank sits higher on the canvas, so the graph and the tree agree.
    const ys = callers.map((n) => n.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it("builds node hrefs with the same helper the tree uses", () => {
    const { nodes } = layoutBlastGraph(MAP, href, 720);
    const caller = nodes.find((n) => n.label === "src/api/public/index.ts")!;
    expect(caller.href).toBe(callerHref(REPO, HEAD, "src/api/public/index.ts", 23));
    // Endpoint and cron nodes have no file behind them, so they never link.
    for (const n of nodes.filter((x) => x.kind === "endpoint" || x.kind === "cron")) {
      expect(n.href).toBeNull();
    }
  });

  it("drops every href when the repo is unknown", () => {
    const { nodes } = layoutBlastGraph(MAP, () => null, 720);
    expect(nodes.every((n) => n.href === null)).toBe(true);
  });

  it("emits one edge per symbol→caller and caller→fact pair, deduped", () => {
    const { edges } = layoutBlastGraph(MAP, href, 720);
    // 3 symbol→caller, plus 3 callers × (1 endpoint + 1 cron).
    expect(edges).toHaveLength(9);
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
    for (const e of edges) expect(e.path.startsWith("M")).toBe(true);
  });

  it("grows in height with the tallest column", () => {
    const tall: BlastRadiusResponse = {
      ...MAP,
      changed_symbols: [
        {
          ...MAP.changed_symbols[0]!,
          callers: Array.from({ length: 20 }, (_, i) => ({
            file: `src/caller${i}.ts`,
            line: i + 1,
            symbol: `fn${i}`,
            rank: 1 - i / 100,
          })),
        },
      ],
    };
    expect(layoutBlastGraph(tall, href, 720).height).toBeGreaterThan(
      layoutBlastGraph(MAP, href, 720).height,
    );
  });
});

describe("BlastGraph", () => {
  it("renders an svg labelled for assistive tech", () => {
    renderGraph();
    const svg = screen.getByRole("img", { name: "Blast radius graph" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });

  it("links caller and symbol nodes, never endpoint or cron nodes", () => {
    renderGraph();
    const links = screen.getAllByRole("link");
    const labels = links.map((l) => l.textContent ?? "");
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
