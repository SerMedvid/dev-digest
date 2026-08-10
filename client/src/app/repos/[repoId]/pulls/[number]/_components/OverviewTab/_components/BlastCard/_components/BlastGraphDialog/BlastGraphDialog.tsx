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
        {/* Above the diagram, not below it: the canvas grows with the map and
            the modal body is what scrolls, so a legend underneath would be off
            screen on exactly the large maps that need it most. */}
        <div style={s.legend}>
          {LEGEND.map(({ key, color }) => (
            <span key={key} style={s.legendItem}>
              <span style={s.swatch(color)} />
              <span>{t(`graph.legend.${key}`)}</span>
            </span>
          ))}
        </div>
        <BlastGraph data={data} headSha={headSha} repoFullName={repoFullName} />
      </div>
    </Modal>
  );
}
