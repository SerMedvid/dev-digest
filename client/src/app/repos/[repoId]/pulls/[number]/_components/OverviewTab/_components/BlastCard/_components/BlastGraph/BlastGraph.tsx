"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { callerHref } from "../../helpers";
import { layoutBlastGraph, type GraphNode } from "./helpers";
import { GRAPH_WIDTH } from "./constants";
import { s, label, labelPrimary, nodeDot, sublabel } from "./styles";

interface BlastGraphProps {
  data: BlastRadiusResponse;
  headSha: string;
  repoFullName: string | null;
}

/**
 * The same response the tree renders, drawn as a three-column layered DAG:
 * changed symbols → callers → endpoints/crons. No second endpoint and no
 * refetch on toggle.
 *
 * React renders every element here; d3 only computed the numbers in
 * `helpers.ts`. The tree stays the accessible-first view, so this carries no
 * information the tree lacks.
 */
export function BlastGraph({ data, headSha, repoFullName }: BlastGraphProps) {
  const t = useTranslations("blast");

  const { nodes, edges, height } = React.useMemo(
    () =>
      layoutBlastGraph(
        data,
        (file, line) => callerHref(repoFullName, headSha, file, line),
        GRAPH_WIDTH,
      ),
    [data, headSha, repoFullName],
  );

  if (nodes.length === 0) {
    return <p style={{ margin: 0, fontSize: 13 }}>{t("graph.empty")}</p>;
  }

  return (
    <div style={s.scroller}>
      <svg
        role="img"
        aria-label={t("graph.ariaLabel")}
        width={GRAPH_WIDTH}
        height={height}
        viewBox={`0 0 ${GRAPH_WIDTH} ${height}`}
      >
        <g>
          {edges.map((e) => (
            <path key={e.id} d={e.path} style={s.edge} />
          ))}
        </g>
        <g>
          {nodes.map((n) => (
            <NodeMark key={n.id} node={n} />
          ))}
        </g>
      </svg>
    </div>
  );
}

function NodeMark({ node }: { node: GraphNode }) {
  const body = (
    <>
      <circle cx={node.x} cy={node.y} r={4} style={nodeDot[node.kind]} />
      <text
        x={node.x + 10}
        y={node.y + 3}
        style={node.kind === "symbol" ? labelPrimary : label}
      >
        {node.label}
      </text>
      {node.sub && (
        <text x={node.x + 10} y={node.y + 14} style={sublabel}>
          {node.sub}
        </text>
      )}
    </>
  );

  // Same rule as the tree: a node links only when we know where to point, so
  // an unknown repo yields plain text rather than a dead link. Endpoint and
  // cron nodes never link — there is no file behind them.
  return node.href ? (
    <a href={node.href} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  ) : (
    <g>{body}</g>
  );
}
