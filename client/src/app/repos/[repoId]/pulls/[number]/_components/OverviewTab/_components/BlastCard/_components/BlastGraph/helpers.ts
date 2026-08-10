import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { BlastRadiusResponse } from "@devdigest/shared";
import {
  CHARGE_STRENGTH,
  COLLIDE_RADIUS,
  GRAPH_HEIGHT,
  GRAPH_WIDTH,
  LINK_DISTANCE,
  LINK_STRENGTH,
  MAX_LABEL_CHARS,
  NODE_MARGIN,
  SIMULATION_TICKS,
} from "./constants";

/**
 * Layout for the blast graph. **d3 does the maths, React owns the DOM** — this
 * module returns plain data and never touches a node, so there is no
 * d3-selection anywhere and no enter/exit lifecycle competing with React's.
 *
 * The simulation is run to completion synchronously rather than animated: the
 * nodes are seeded on a fixed spiral, ticked a fixed number of times, and read
 * once. Two renders of the same response therefore produce identical geometry,
 * and the layout is exercisable in jsdom with no rAF loop.
 */

export type GraphNodeKind = "symbol" | "caller" | "endpoint" | "cron";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  sub?: string;
  /** `null` when the repo is unknown, or for endpoint/cron nodes (never link). */
  href: string | null;
  x: number;
  y: number;
}

export interface GraphEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BlastGraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

/** What the simulation mutates: our fields plus d3's x/y/vx/vy. */
interface SimNode extends SimulationNodeDatum {
  id: string;
  kind: GraphNodeKind;
  label: string;
  sub?: string;
  href: string | null;
}

type SimLink = SimulationLinkDatum<SimNode> & { id: string };

/** A long path would overrun its node; the tail is the identifying part. */
function truncate(label: string): string {
  if (label.length <= MAX_LABEL_CHARS) return label;
  return `…${label.slice(label.length - MAX_LABEL_CHARS + 1)}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Rounded so a float's last bit can never make two equal layouts compare unequal. */
function round(v: number): number {
  return Math.round(v * 100) / 100;
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
): { nodes: SimNode[]; links: SimLink[] } {
  const nodes: SimNode[] = [];
  const links: SimLink[] = [];
  const seenNode = new Set<string>();
  const seenLink = new Set<string>();

  const addNode = (n: SimNode) => {
    if (seenNode.has(n.id)) return;
    seenNode.add(n.id);
    nodes.push(n);
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
      label: sym.name,
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
        addNode({ id, kind: "endpoint", label: e, href: null });
        addLink(callerId, id);
      }
      for (const cr of sym.crons) {
        const id = `cron:${cr}`;
        addNode({ id, kind: "cron", label: cr, href: null });
        addLink(callerId, id);
      }
    }
  }

  return { nodes, links };
}

/**
 * Seed positions on a golden-angle spiral around the centre. d3 would seed its
 * own phyllotaxis, but doing it here guarantees no two nodes ever start
 * coincident — the one place d3's forces reach for `Math.random()` (`jiggle`).
 */
function seed(nodes: SimNode[], width: number, height: number): void {
  const radius = Math.min(width, height) / 2 - NODE_MARGIN;
  nodes.forEach((n, i) => {
    const angle = i * 2.399963229728653; // golden angle, radians
    const r = radius * Math.sqrt((i + 1) / nodes.length);
    n.x = width / 2 + r * Math.cos(angle);
    n.y = height / 2 + r * Math.sin(angle);
  });
}

/** After `forceLink` runs, `source`/`target` are node objects, not ids. */
function endpointOf(v: SimLink["source"], nodes: Map<string, SimNode>): SimNode | undefined {
  return typeof v === "object" ? (v as SimNode) : nodes.get(String(v));
}

export function layoutBlastGraph(
  data: BlastRadiusResponse,
  href: (file: string, line: number | null) => string | null,
  width: number = GRAPH_WIDTH,
  height: number = GRAPH_HEIGHT,
): BlastGraphLayout {
  const { nodes: simNodes, links } = buildGraph(data, href);
  if (simNodes.length === 0) return { nodes: [], edges: [], width, height };

  seed(simNodes, width, height);

  const simulation = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(LINK_DISTANCE)
        .strength(LINK_STRENGTH),
    )
    .force("charge", forceManyBody().strength(CHARGE_STRENGTH))
    .force("center", forceCenter(width / 2, height / 2))
    .force("collide", forceCollide(COLLIDE_RADIUS))
    .stop();

  simulation.tick(SIMULATION_TICKS);

  const byId = new Map(simNodes.map((n) => [n.id, n]));
  for (const n of simNodes) {
    n.x = clamp(round(n.x ?? width / 2), NODE_MARGIN, width - NODE_MARGIN);
    n.y = clamp(round(n.y ?? height / 2), NODE_MARGIN, height - NODE_MARGIN);
  }

  const nodes: GraphNode[] = simNodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.label,
    ...(n.sub === undefined ? {} : { sub: n.sub }),
    href: n.href,
    x: n.x ?? 0,
    y: n.y ?? 0,
  }));

  const edges: GraphEdge[] = [];
  for (const l of links) {
    const a = endpointOf(l.source, byId);
    const b = endpointOf(l.target, byId);
    if (!a || !b) continue;
    edges.push({ id: l.id, x1: a.x ?? 0, y1: a.y ?? 0, x2: b.x ?? 0, y2: b.y ?? 0 });
  }

  return { nodes, edges, width, height };
}
