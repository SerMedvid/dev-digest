/* ContextDocPreview — the read-only preview modal behind every "preview" control
   in the agent and skill editors. No route, no editor: it renders the same
   document body the Project Context page renders inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@devdigest/ui";
import { ContextDocBody } from "./ContextDocBody";
import { s } from "./styles";

export function ContextDocPreview({
  repoId,
  path,
  onClose,
}: {
  repoId: string;
  path: string;
  onClose: () => void;
}) {
  const t = useTranslations("context");
  return (
    <Modal title={t("preview.title")} subtitle={<span className="mono">{path}</span>} onClose={onClose}>
      <div style={s.modalBody}>
        <ContextDocBody repoId={repoId} path={path} />
      </div>
    </Modal>
  );
}
