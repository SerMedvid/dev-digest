/* ContextTab — the skill's project-context attachments.

   A tab rather than a block inside Config, because the documents a skill
   carries are not part of its configuration: they are read at run time by every
   agent that links the skill, and the design gives them their own surface. It
   shipped nested under Config first, which put it below the Save row and out of
   sight on a long skill body. */
"use client";

import React from "react";
import type { Skill } from "@devdigest/shared";
import { ProjectContextSection } from "./_components/ProjectContextSection";
import { s } from "./styles";

export function ContextTab({ skill }: { skill: Skill }) {
  return (
    <div style={s.pane}>
      <ProjectContextSection skill={skill} />
    </div>
  );
}
