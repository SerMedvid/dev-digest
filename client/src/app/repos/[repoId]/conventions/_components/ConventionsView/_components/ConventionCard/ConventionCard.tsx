/* ConventionCard — one extracted candidate: the rule, the evidence it was
   grounded against, and the three things a user can do with it (accept, reject,
   edit). It owns its own mutation, so the list stays a dumb map. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, ProgressBar, TextInput, Textarea } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { usePatchConvention, type ConventionPatch } from "@/lib/hooks/conventions";
import { s } from "./styles";

export function ConventionCard({
  repoId,
  candidate,
}: {
  repoId: string;
  candidate: ConventionCandidate;
}) {
  const t = useTranslations("conventions");
  const patch = usePatchConvention();

  const [editing, setEditing] = React.useState(false);
  const [rule, setRule] = React.useState(candidate.rule);
  const [line, setLine] = React.useState(String(candidate.evidence_line));
  const [path, setPath] = React.useState(candidate.evidence_path);
  const [invalid, setInvalid] = React.useState<string | null>(null);

  function send(body: ConventionPatch) {
    patch.mutate({ repoId, id: candidate.id, patch: body });
  }

  /**
   * Only changed fields go over the wire — an unchanged field is not an edit.
   * Bad input is refused out loud: silently dropping an unparseable line from
   * the patch leaves the user believing they changed something they did not.
   */
  function save() {
    if (!rule.trim()) {
      setInvalid(t("card.ruleRequired"));
      return;
    }
    const parsed = Number(line);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setInvalid(t("card.lineInvalid"));
      return;
    }
    setInvalid(null);

    const next: ConventionPatch = {};
    if (rule.trim() !== candidate.rule) next.rule = rule.trim();
    if (path.trim() && path.trim() !== candidate.evidence_path) next.evidence_path = path.trim();
    if (parsed !== candidate.evidence_line) next.evidence_line = parsed;
    if (Object.keys(next).length === 0) {
      setEditing(false);
      return;
    }
    patch.mutate(
      { repoId, id: candidate.id, patch: next },
      { onSuccess: () => setEditing(false) },
    );
  }

  function cancel() {
    setRule(candidate.rule);
    setLine(String(candidate.evidence_line));
    setPath(candidate.evidence_path);
    setInvalid(null);
    setEditing(false);
  }

  return (
    <div style={s.card(candidate.status)}>
      <div style={s.main}>
        {editing ? (
          <div style={s.editFields}>
            <FormField label={t("card.ruleLabel")}>
              <Textarea value={rule} onChange={setRule} rows={3} />
            </FormField>
            <div style={s.editRow}>
              <FormField label={t("card.pathLabel")}>
                <TextInput value={path} onChange={setPath} aria-label={t("card.pathLabel")} />
              </FormField>
              <FormField label={t("card.lineLabel")}>
                <TextInput value={line} onChange={setLine} aria-label={t("card.lineLabel")} />
              </FormField>
            </div>
          </div>
        ) : (
          <>
            <div style={s.ruleRow}>
              <p style={s.rule}>{candidate.rule}</p>
              <span style={s.category}>{t(`card.category.${candidate.category}`)}</span>
            </div>

            <div style={s.evidence}>
              <div style={s.evidenceHead}>
                <span className="mono">
                  {candidate.evidence_path}:{candidate.evidence_line}
                </span>
              </div>
              <pre className="mono" style={s.snippet}>
                {candidate.evidence_snippet}
              </pre>
            </div>

            <div style={s.confidenceRow}>
              <span style={s.confidenceLabel}>{t("card.confidence")}</span>
              <div style={s.confidenceBar}>
                {/* ProgressBar clamps to 0-100, not 0-1 — a raw confidence
                    renders as a 0.91%-wide sliver. */}
                <ProgressBar
                  value={candidate.confidence * 100}
                  color={candidate.confidence >= 0.85 ? "var(--ok)" : "var(--warn)"}
                />
              </div>
              <span className="mono tnum" style={s.confidenceLabel}>
                {Math.round(candidate.confidence * 100)}%
              </span>
            </div>
          </>
        )}

        {invalid && <div style={s.error}>{invalid}</div>}
        {patch.isError && <div style={s.error}>{t("card.saveFailed")}</div>}
      </div>

      <div style={s.actions}>
        {editing ? (
          <>
            <Button kind="primary" size="sm" onClick={save} disabled={patch.isPending}>
              {t("card.save")}
            </Button>
            <Button kind="ghost" size="sm" onClick={cancel}>
              {t("card.cancel")}
            </Button>
          </>
        ) : (
          <>
            {candidate.status === "accepted" ? (
              <Button kind="primary" size="sm" icon="Check" disabled>
                {t("card.accepted")}
              </Button>
            ) : (
              <Button
                kind="primary"
                size="sm"
                onClick={() => send({ status: "accepted" })}
                disabled={patch.isPending}
              >
                {t("card.accept")}
              </Button>
            )}
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              onClick={() => send({ status: "rejected" })}
              disabled={patch.isPending || candidate.status === "rejected"}
            >
              {t("card.reject")}
            </Button>
            <Button kind="ghost" size="sm" onClick={() => setEditing(true)}>
              {t("card.edit")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
