/* FirstTaskCard — one starter task, with the file it was grounded in. */
"use client";

import React from "react";
import type { OnboardingTaskValue } from "@devdigest/shared";
import { s } from "./styles";

export function FirstTaskCard({ task }: { task: OnboardingTaskValue }) {
  return (
    <div style={s.task} data-testid="first-task">
      <h4 style={s.title}>{task.title}</h4>
      {task.body ? <p style={s.body}>{task.body}</p> : null}
      <span className="mono" style={s.path}>
        {task.path}
      </span>
    </div>
  );
}
