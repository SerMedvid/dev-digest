import { scalePoint } from "d3-scale";
import { linkHorizontal } from "d3-shape";
import type { BlastRadiusResponse } from "@devdigest/shared";
import {
  COLUMN_X,
  GRAPH_WIDTH,
  MAX_LABEL_CHARS,
  MIN_GRAPH_HEIGHT,
  PADDING_Y,
  ROW_HEIGHT,
} from "./constants";

/**
 * Layout for the blast graph. **d3 does the maths, React owns the DOM** — this
 * module returns plain data and never touches a node, so there is no
 * d3-selection anywhere and no enter/exit lifecycle competing with React's.
 * It is also why the layout is testable in jsdom without rendering.
 *
 * The layout is layered, not force-directed: every edge in the data flows
 * left-to-right (symbol → its callers → what those callers expose), so exact
 * column placement is possible and nothing has to be iterated or relaxed. Two
 * renders of the same response therefore produce identical geometry.
 */

export type GraphNodeKind = "symbol" | "caller" | "endpoint" | "cron";

export interface GraphNode {
  id: string;
  col: 0 | 1 | 2;
  label: string;
  sub?: string;
  x: number;
  y: number;
  /** `null` when the repo is unknown, or for endpoint/cron nodes (never links). */
  href: string | null;
  kind: GraphNodeKind;
}

export interface GraphEdge {
  id: string;
  /** SVG path `d`, from d3-shape's `linkHorizontal`. */
  path: string;
}

export interface BlastGraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  height: number;
}

/** A long path would overrun its column; the tail is the identifying part. */
function truncate(label: string): string {
  if (label.length <= MAX_LABEL_CHARS) return label;
  return `…${label.slice(label.length - MAX_LABEL_CHARS + 1)}`;
}

const link = linkHorizontal<
  { source: [number, number]; target: [number, number] },
  [number, number]
>()
  .source((d) => d.source)
  .target((d) => d.target);

/**
 * `scalePoint` over an explicit domain of ids, so a column's vertical order is
 * exactly the order the data carries — rank-descending callers, symbols in
 * response order. The graph and the tree therefore agree on prominence.
 */
function stack(ids: string[], height: number): Map<string, number> {
  const scale = scalePoint<string>()
    .domain(ids)
    .range([PADDING_Y, Math.max(PADDING_Y, height - PADDING_Y)])
    .padding(0.5);
  const out = new Map<string, number>();
  for (const id of ids) out.set(id, scale(id) ?? height / 2);
  return out;
}

export function layoutBlastGraph(
  data: BlastRadiusResponse,
  href: (file: string, line: number | null) => string | null,
  width: number = GRAPH_WIDTH,
): BlastGraphLayout {
  const symbolIds: string[] = [];
  const callerIds: string[] = [];
  const factIds: string[] = [];

  interface Pending {
    id: string;
    col: 0 | 1 | 2;
    label: string;
    sub?: string;
    href: string | null;
    kind: GraphNodeKind;
  }
  const pending: Pending[] = [];
  const edgePairs: Array<{ from: string; to: string }> = [];
  const seen = new Set<string>();

  const push = (n: Pending, bucket: string[]) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    pending.push(n);
    bucket.push(n.id);
  };

  for (const sym of data.changed_symbols) {
    const symId = `sym:${sym.file}:${sym.name}`;
    push(
      {
        id: symId,
        col: 0,
        label: sym.name,
        sub: sym.kind,
        href: href(sym.file, sym.line),
        kind: "symbol",
      },
      symbolIds,
    );

    for (const c of sym.callers) {
      const callerId = `call:${c.file}:${c.line}`;
      push(
        {
          id: callerId,
          col: 1,
          label: truncate(c.file),
          sub: `${c.symbol}:${c.line}`,
          href: href(c.file, c.line),
          kind: "caller",
        },
        callerIds,
      );
      edgePairs.push({ from: symId, to: callerId });

      // Endpoints and crons hang off the CALLER that exposes them, so an edge
      // in this column always means "reachable through that caller". Facts the
      // BFS widened past any individual caller stay out of the graph — the
      // header counters carry those, and inventing an edge for them would draw
      // a relationship the data does not assert.
      for (const e of sym.endpoints) {
        const factId = `ep:${e}`;
        push({ id: factId, col: 2, label: e, href: null, kind: "endpoint" }, factIds);
        edgePairs.push({ from: callerId, to: factId });
      }
      for (const cr of sym.crons) {
        const factId = `cron:${cr}`;
        push({ id: factId, col: 2, label: cr, href: null, kind: "cron" }, factIds);
        edgePairs.push({ from: callerId, to: factId });
      }
    }
  }

  const tallest = Math.max(symbolIds.length, callerIds.length, factIds.length);
  const height = Math.max(MIN_GRAPH_HEIGHT, tallest * ROW_HEIGHT + PADDING_Y * 2);

  const y = new Map<string, number>([
    ...stack(symbolIds, height),
    ...stack(callerIds, height),
    ...stack(factIds, height),
  ]);

  // Columns are fixed, but the last one is pinned inside `width` so a narrow
  // card does not push the endpoint labels off the canvas.
  const columnX: [number, number, number] = [
    COLUMN_X[0],
    COLUMN_X[1],
    Math.min(COLUMN_X[2], Math.max(COLUMN_X[1] + 120, width - 130)),
  ];

  const nodes: GraphNode[] = pending.map((n) => ({
    id: n.id,
    col: n.col,
    label: n.label,
    ...(n.sub === undefined ? {} : { sub: n.sub }),
    x: columnX[n.col],
    y: y.get(n.id) ?? height / 2,
    href: n.href,
    kind: n.kind,
  }));

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edgeSeen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const { from, to } of edgePairs) {
    const id = `${from}->${to}`;
    if (edgeSeen.has(id)) continue;
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b) continue;
    edgeSeen.add(id);
    const path = link({ source: [a.x, a.y], target: [b.x, b.y] });
    if (path) edges.push({ id, path });
  }

  return { nodes, edges, height };
}
