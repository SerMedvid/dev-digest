"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { callerHref } from "../../helpers";
import { layoutBlastGraph, type GraphNode } from "./helpers";
import { GRAPH_HEIGHT, GRAPH_WIDTH } from "./constants";
import { s, label, labelPrimary, nodeDot, sublabel } from "./styles";

interface BlastGraphProps {
  data: BlastRadiusResponse;
  headSha: string;
  repoFullName: string | null;
}

/**
 * The same response the tree renders, drawn as a force-directed node-link
 * diagram: changed symbols, their callers, and what those callers expose.
 *
 * React renders every element here; d3 only computed the numbers in
 * `helpers.ts`, synchronously and once. The tree stays the accessible-first
 * view, so this carries no information the tree lacks.
 */
export function BlastGraph({ data, headSha, repoFullName }: BlastGraphProps) {
  const t = useTranslations("blast");

  const { nodes, edges } = React.useMemo(
    () => layoutBlastGraph(data, (file, line) => callerHref(repoFullName, headSha, file, line)),
    [data, headSha, repoFullName],
  );

  if (nodes.length === 0) {
    return <p style={{ margin: 0, fontSize: 13 }}>{t("graph.empty")}</p>;
  }

  return (
    <svg
      role="img"
      aria-label={t("graph.ariaLabel")}
      viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
      style={s.svg}
    >
      <g>
        {edges.map((e) => (
          <line key={e.id} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} style={s.edge} />
        ))}
      </g>
      <g>
        {nodes.map((n) => (
          <NodeMark key={n.id} node={n} />
        ))}
      </g>
    </svg>
  );
}

function NodeMark({ node }: { node: GraphNode }) {
  const body = (
    <>
      <circle
        cx={node.x}
        cy={node.y}
        r={node.kind === "symbol" ? 7 : 5}
        style={nodeDot[node.kind]}
      />
      <text
        x={node.x}
        y={node.y + 20}
        textAnchor="middle"
        style={node.kind === "symbol" ? labelPrimary : label}
      >
        {node.label}
      </text>
      {node.sub && (
        <text x={node.x} y={node.y + 32} textAnchor="middle" style={sublabel}>
          {node.sub}
        </text>
      )}
    </>
  );

  // Same rule as the tree: a node links only when we know where to point, so an
  // unknown repo yields plain text rather than a dead link. Endpoint and cron
  // nodes never link — there is no file behind them.
  return node.href ? (
    <a href={node.href} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  ) : (
    <g>{body}</g>
  );
}
