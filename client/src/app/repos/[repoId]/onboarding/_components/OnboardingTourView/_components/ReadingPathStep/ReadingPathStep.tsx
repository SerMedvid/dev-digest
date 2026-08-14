/* ReadingPathStep — one numbered stop on the guided reading path.

   The order is the server's, and it is file-rank order. Nothing here sorts,
   filters or renumbers: a client-side reorder would quietly replace the one
   thing this section is for. */
"use client";

import React from "react";
import type { OnboardingFileEntryValue } from "@devdigest/shared";
import { s } from "./styles";

export function ReadingPathStep({
  file,
  index,
}: {
  file: OnboardingFileEntryValue;
  index: number;
}) {
  return (
    <div style={s.step} data-testid="reading-path-step">
      <span style={s.num}>{index + 1}</span>
      <div style={s.body}>
        <span className="mono" style={s.path}>
          {file.path}
        </span>
        {file.note ? <span style={s.note}>{file.note}</span> : null}
      </div>
    </div>
  );
}
