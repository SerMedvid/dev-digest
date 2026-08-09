"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "./_components/IntentCard";
import { BlastCard } from "./_components/BlastCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  headSha: string;
  /** `null` when the repo isn't resolved; blast rows then render unlinked. */
  repoFullName: string | null;
}

export function OverviewTab({ prBody, prId, headSha, repoFullName }: OverviewTabProps) {
  return (
    <>
      <IntentCard prId={prId} headSha={headSha} />
      <BlastCard prId={prId} headSha={headSha} repoFullName={repoFullName} />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
