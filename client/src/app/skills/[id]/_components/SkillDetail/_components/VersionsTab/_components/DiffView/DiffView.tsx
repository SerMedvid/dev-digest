/* DiffView — unified line diff between an old body and the current one. */
"use client";

import React from "react";
import { toDiffRows } from "../../helpers";
import { s } from "./styles";

const PREFIX = { add: "+", del: "-", ctx: " " } as const;

export function DiffView({ from, to }: { from: string; to: string }) {
  const rows = toDiffRows(from, to);
  return (
    <div data-testid="diff-view" style={s.frame}>
      {rows.map((r, i) => (
        <span key={i} className="mono" style={s.row(r.kind)}>
          {PREFIX[r.kind]}
          {r.text}
        </span>
      ))}
    </div>
  );
}
