/* ScanHeader — where the candidates came from, and the button that throws them
   away. A re-scan is replace-all, so it confirms and names the count first;
   losing hand-made decisions silently is worse than an extra click. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { ConventionScan } from "@devdigest/shared";
import { relativeTime } from "./helpers";
import { s } from "./styles";

export function ScanHeader({
  scan,
  accepted,
  rejected,
  busy,
  onRescan,
}: {
  scan: ConventionScan | null;
  accepted: number;
  rejected: number;
  busy: boolean;
  onRescan: () => void;
}) {
  const t = useTranslations("conventions");
  const [confirming, setConfirming] = React.useState(false);

  const decisions = accepted + rejected;
  const inFlight = busy || scan?.status === "queued" || scan?.status === "running";

  function requestRescan() {
    if (decisions === 0) {
      onRescan();
      return;
    }
    setConfirming(true);
  }

  function confirm() {
    setConfirming(false);
    onRescan();
  }

  return (
    <div>
      <div style={s.row}>
        <p style={s.meta}>
          {inFlight
            ? t("scan.inFlight", { sampled: scan?.sample_count ?? 0 })
            : scan
              ? [
                  t("scan.detected", { count: scan.sample_count }),
                  scan.finished_at
                    ? t("scan.lastScan", { ago: relativeTime(scan.finished_at, new Date()) })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : t("scan.never")}
          {scan?.model ? (
            <>
              {" · "}
              <span className="mono" style={s.model}>
                {t("scan.model", { provider: scan.provider ?? "", model: scan.model })}
              </span>
            </>
          ) : null}
        </p>

        <Button kind="ghost" size="sm" icon="RefreshCw" onClick={requestRescan} disabled={inFlight}>
          {scan ? t("page.rescan") : t("page.runExtraction")}
        </Button>
      </div>

      {confirming && (
        <div style={s.confirm} role="alertdialog" aria-label={t("scan.confirmTitle")}>
          <p style={s.confirmTitle}>{t("scan.confirmTitle")}</p>
          <p style={s.confirmBody}>{t("scan.confirmBody", { accepted, rejected })}</p>
          <div style={s.confirmActions}>
            <Button kind="primary" size="sm" onClick={confirm}>
              {t("scan.confirmCta")}
            </Button>
            <Button kind="ghost" size="sm" onClick={() => setConfirming(false)}>
              {t("scan.confirmCancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
