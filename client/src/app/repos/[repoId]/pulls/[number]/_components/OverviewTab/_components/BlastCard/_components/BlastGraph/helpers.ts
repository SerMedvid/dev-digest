import type { BlastRadiusResponse } from "@devdigest/shared";
import {
  CHAR_WIDTH,
  CHAR_WIDTH_PRIMARY,
  COLUMN_X,
  EDGE_ARRIVE,
  EDGE_GAP,
  GRAPH_WIDTH,
  LABEL_DX,
  MARGIN_BOTTOM,
  MARGIN_TOP,
  MAX_LABEL_CHARS,
  MIN_GRAPH_HEIGHT,
  ROW_PITCH,
  ROW_WIDTH,
} from "./constants";

/**
 * Layout for the blast graph. Plain arithmetic in, plain data out — this module
 * returns numbers and never touches a node, so React owns the DOM outright.
 *
 * **Layered columns, not a force simulation.** The response is a strictly
 * three-tier DAG — changed symbol → caller → what that caller exposes — which
 * is the shape a force-directed layout is worst at. The previous one settled
 * into a blob whose diameter grew with the node count (~1900px at 120 nodes)
 * inside a fixed 1120×620 box, and every node outside was clamped onto the box
 * border: at 72 nodes that put 100% of them on the border across 11 distinct y
 * values, which is what made the dialog unreadable. Rows cannot do that. Each
 * tier is a column, each node owns a row, and rows are `ROW_PITCH` apart, so
 * two labels can never overlap however large the map gets — the canvas grows
 * downwards and the dialog scrolls instead.
 *
 * Ordering is barycentric, the standard layered-graph crossing heuristic: the
 * caller column takes the reading order its parent symbols imply, then symbols
 * and facts are pulled to the mean row of the callers they connect to and
 * separated again where that would overlap. Nothing here is random or
 * iterative, so one response always produces one picture.
 */

export type GraphNodeKind = "symbol" | "caller" | "endpoint" | "cron";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  sub?: string;
  /** `null` when the repo is unknown, or for endpoint/cron nodes (never link). */
  href: string | null;
  /** Column index — 0 symbols, 1 callers, 2 endpoints and crons. */
  col: number;
  x: number;
  y: number;
  /** Where this row's outgoing edges leave: clear of its own label text. */
  outX: number;
}

export interface GraphEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Cubic bezier through the gutter, so the two columns read as connected. */
  path: string;
}

export interface BlastGraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

/** Pre-layout node: everything the data asserts, before it has a position. */
interface RawNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  sub?: string;
  href: string | null;
  col: number;
}

interface RawLink {
  id: string;
  source: string;
  target: string;
}

const COLUMN_OF: Record<GraphNodeKind, number> = {
  symbol: 0,
  caller: 1,
  endpoint: 2,
  cron: 2,
};

/** A long path would overrun its column; the tail is the identifying part. */
function truncate(label: string): string {
  if (label.length <= MAX_LABEL_CHARS) return label;
  return `…${label.slice(label.length - MAX_LABEL_CHARS + 1)}`;
}

/** Rounded so a float's last bit can never make two equal layouts compare unequal. */
function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * The graph the data asserts, before any geometry. Endpoints and crons hang off
 * the CALLER that exposes them, so an edge always means "reachable through that
 * caller"; facts the BFS widened past every individual caller stay out entirely,
 * because drawing them would assert a path the response does not claim.
 */
function buildGraph(
  data: BlastRadiusResponse,
  href: (file: string, line: number | null) => string | null,
): { nodes: RawNode[]; links: RawLink[] } {
  const nodes: RawNode[] = [];
  const links: RawLink[] = [];
  const seenNode = new Set<string>();
  const seenLink = new Set<string>();

  const addNode = (n: Omit<RawNode, "col">) => {
    if (seenNode.has(n.id)) return;
    seenNode.add(n.id);
    nodes.push({ ...n, col: COLUMN_OF[n.kind] });
  };
  const addLink = (source: string, target: string) => {
    const id = `${source}->${target}`;
    if (seenLink.has(id)) return;
    seenLink.add(id);
    links.push({ id, source, target });
  };

  for (const sym of data.changed_symbols) {
    const symId = `sym:${sym.file}:${sym.name}`;
    addNode({
      id: symId,
      kind: "symbol",
      label: truncate(sym.name),
      sub: sym.kind,
      href: href(sym.file, sym.line),
    });

    for (const c of sym.callers) {
      const callerId = `call:${c.file}:${c.line}`;
      addNode({
        id: callerId,
        kind: "caller",
        label: truncate(c.file),
        sub: `${c.symbol}:${c.line}`,
        href: href(c.file, c.line),
      });
      addLink(symId, callerId);

      for (const e of sym.endpoints) {
        const id = `ep:${e}`;
        addNode({ id, kind: "endpoint", label: truncate(e), href: null });
        addLink(callerId, id);
      }
      for (const cr of sym.crons) {
        const id = `cron:${cr}`;
        addNode({ id, kind: "cron", label: truncate(cr), href: null });
        addLink(callerId, id);
      }
    }
  }

  return { nodes, links };
}

/**
 * Stack rows down a column, honouring each node's preferred y but never letting
 * two come closer than `ROW_PITCH`. Input must already be in the order the
 * column should read; a later row is only ever pushed down, never reordered, so
 * the crossing-minimising order survives the separation pass.
 */
function stack(preferred: number[]): number[] {
  const out: number[] = [];
  let floor = MARGIN_TOP;
  for (const want of preferred) {
    const y = Math.max(want, floor);
    out.push(y);
    floor = y + ROW_PITCH;
  }
  return out;
}

/** Where a row's text ends, so an outgoing edge can start beyond it. */
function textEnd(n: RawNode): number {
  const perChar = n.col === 0 ? CHAR_WIDTH_PRIMARY : CHAR_WIDTH;
  const width = n.label.length * perChar;
  return Math.min(LABEL_DX + width + EDGE_GAP, ROW_WIDTH);
}

export function layoutBlastGraph(
  data: BlastRadiusResponse,
  href: (file: string, line: number | null) => string | null,
  width: number = GRAPH_WIDTH,
): BlastGraphLayout {
  const { nodes: raw, links } = buildGraph(data, href);
  if (raw.length === 0) return { nodes: [], edges: [], width, height: MIN_GRAPH_HEIGHT };

  const byId = new Map(raw.map((n) => [n.id, n]));
  const order = new Map(raw.map((n, i) => [n.id, i]));
  const childrenOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  for (const l of links) {
    push(childrenOf, l.source, l.target);
    push(parentsOf, l.target, l.source);
  }

  const inColumn = (col: number) => raw.filter((n) => n.col === col);
  const y = new Map<string, number>();

  // Column 1 — the spine. Callers read in the order their parent symbols do,
  // which is the order the server ranked those symbols in, and take a uniform
  // pitch. Everything else is positioned against these rows.
  const callers = inColumn(1).sort((a, b) => {
    const key = (n: RawNode) => mean((parentsOf.get(n.id) ?? []).map((p) => order.get(p) ?? 0));
    return key(a) - key(b) || order.get(a.id)! - order.get(b.id)!;
  });
  callers.forEach((n, i) => y.set(n.id, MARGIN_TOP + i * ROW_PITCH));

  const bottom = callers.length ? MARGIN_TOP + (callers.length - 1) * ROW_PITCH : MARGIN_TOP;

  /**
   * A column positioned against the spine: each node wants the mean row of the
   * neighbours it links to, and one with no neighbour at all — a symbol nothing
   * calls — is appended below rather than fighting for a row in the middle.
   */
  const place = (col: number, neighboursOf: Map<string, string[]>): RawNode[] => {
    const want = new Map<string, number>();
    for (const n of inColumn(col)) {
      const ys = (neighboursOf.get(n.id) ?? []).map((id) => y.get(id)).filter((v) => v !== undefined);
      want.set(n.id, ys.length ? mean(ys as number[]) : bottom + ROW_PITCH);
    }
    const ordered = inColumn(col).sort(
      (a, b) => want.get(a.id)! - want.get(b.id)! || order.get(a.id)! - order.get(b.id)!,
    );
    const ys = stack(ordered.map((n) => want.get(n.id)!));
    ordered.forEach((n, i) => y.set(n.id, ys[i]!));
    return ordered;
  };

  place(0, childrenOf);
  place(2, parentsOf);

  const nodes: GraphNode[] = raw.map((n) => {
    const x = COLUMN_X[n.col] ?? COLUMN_X[0];
    return {
      id: n.id,
      kind: n.kind,
      label: n.label,
      ...(n.sub === undefined ? {} : { sub: n.sub }),
      href: n.href,
      col: n.col,
      x,
      y: round(y.get(n.id) ?? MARGIN_TOP),
      outX: round(x + textEnd(n)),
    };
  });

  const positioned = new Map(nodes.map((n) => [n.id, n]));
  const edges: GraphEdge[] = [];
  for (const l of links) {
    const a = positioned.get(l.source);
    const b = positioned.get(l.target);
    if (!a || !b) continue;
    const x1 = a.outX;
    const x2 = b.x - EDGE_ARRIVE;
    const bend = round((x2 - x1) / 2);
    edges.push({
      id: l.id,
      x1,
      y1: a.y,
      x2: round(x2),
      y2: b.y,
      path: `M ${x1} ${a.y} C ${round(x1 + bend)} ${a.y}, ${round(x2 - bend)} ${b.y}, ${round(x2)} ${b.y}`,
    });
  }

  const lowest = nodes.reduce((m, n) => Math.max(m, n.y), MARGIN_TOP);
  const height = Math.max(MIN_GRAPH_HEIGHT, round(lowest + MARGIN_BOTTOM));

  return { nodes, edges, width, height };
}

/** Unused by the layout, exported for the header row the component draws. */
export const COLUMN_KEYS = ["symbol", "caller", "exposes"] as const;
