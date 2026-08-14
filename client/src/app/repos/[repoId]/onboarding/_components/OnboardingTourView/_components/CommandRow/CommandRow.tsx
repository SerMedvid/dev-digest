/* CommandRow — one shell command from the checkout, numbered, with the model's
   comment beside it and a copy button.

   The number is 1-based on screen and 0-based on the wire: the server keys the
   model's comments by array index, and renumbering that would be a bug the
   reader could not see. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { OnboardingCommandValue } from "@devdigest/shared";
import { s } from "./styles";

export function CommandRow({ command, index }: { command: OnboardingCommandValue; index: number }) {
  const t = useTranslations("onboarding");
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(command.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (insecure origin, denied permission) — no-op */
    }
  }

  return (
    <div style={s.row} data-testid="command-row">
      <span style={s.index}>{index + 1}</span>
      <code style={s.text}>{command.command}</code>
      {command.comment ? (
        <>
          {/* The hash is its own element so the comment text stands alone —
              a reader copies the command, not the annotation. */}
          <span style={s.hash} aria-hidden>
            #
          </span>
          <span style={s.comment}>{command.comment}</span>
        </>
      ) : null}
      <span style={s.spacer} />
      <button type="button" style={s.copy} onClick={copy} aria-label={t("copyCommand")}>
        {copied ? <Icon.Check size={14} /> : <Icon.Copy size={14} />}
      </button>
    </div>
  );
}
