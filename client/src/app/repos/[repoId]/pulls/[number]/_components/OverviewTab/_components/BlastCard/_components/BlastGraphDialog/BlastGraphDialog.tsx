"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@devdigest/ui";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { BlastGraph } from "../BlastGraph";
import { DIALOG_WIDTH, LEGEND } from "./constants";
import { s } from "./styles";

interface BlastGraphDialogProps {
  data: BlastRadiusResponse;
  headSha: string;
  repoFullName: string | null;
  onClose: () => void;
}

/**
 * The graph, over the card rather than inside it. The card behind keeps showing
 * the tree, so there is no view state to hold and no URL parameter — which view
 * you are looking at is presentation, not a shareable location.
 */
export function BlastGraphDialog({ data, headSha, repoFullName, onClose }: BlastGraphDialogProps) {
  const t = useTranslations("blast");

  return (
    <Modal
      width={DIALOG_WIDTH}
      title={t("graph.title")}
      subtitle={t("graph.subtitle")}
      onClose={onClose}
    >
      <div style={s.body}>
        <BlastGraph data={data} headSha={headSha} repoFullName={repoFullName} />
        <div style={s.legend}>
          {LEGEND.map(({ key, color }) => (
            <span key={key} style={s.legendItem}>
              <span style={s.swatch(color)} />
              <span>{t(`graph.legend.${key}`)}</span>
            </span>
          ))}
        </div>
      </div>
    </Modal>
  );
}
