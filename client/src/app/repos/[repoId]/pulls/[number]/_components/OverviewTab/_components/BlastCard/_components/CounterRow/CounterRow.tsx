"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Button, type IconName } from "@devdigest/ui";
import { s } from "./styles";

interface CounterRowProps {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
  /** `null` hides the button entirely — there is no map to draw. */
  onOpenGraph: (() => void) | null;
}

/**
 * The card's header line: what the map contains, and the way into the graph.
 *
 * Every counter renders including zeros. Under `status: ok` a zero is a real
 * measurement; `partial` and `degraded` are what say "we could not see", and
 * suppressing the zero would collapse that distinction.
 */
export function CounterRow({ symbols, callers, endpoints, crons, onOpenGraph }: CounterRowProps) {
  const t = useTranslations("blast");

  const counters: Array<{ icon: IconName; value: number; label: string }> = [
    { icon: "Code", value: symbols, label: t("stat.symbols") },
    { icon: "CornerDownRight", value: callers, label: t("stat.callers") },
    { icon: "Globe", value: endpoints, label: t("stat.endpoints") },
    { icon: "Clock", value: crons, label: t("stat.crons") },
  ];

  return (
    <div style={s.row}>
      {counters.map(({ icon, value, label }) => {
        const I = Icon[icon];
        return (
          <span key={label} style={s.counter}>
            <I size={13} style={s.icon} />
            <span style={s.value}>{value}</span>
            <span>{label}</span>
          </span>
        );
      })}
      {onOpenGraph && (
        <span style={s.spacer}>
          <Button size="sm" kind="tertiary" icon="Workflow" onClick={onOpenGraph}>
            {t("viewGraph")}
          </Button>
        </span>
      )}
    </div>
  );
}
