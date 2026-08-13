/* ConfigTab — the editable skill. Saving a changed body creates a version, so
   the change note is offered next to it rather than on a separate screen. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, TextInput, Textarea, SelectInput, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "../../../../../../../lib/hooks/skills";
import { ApiError } from "../../../../../../../lib/api";
import { MAX_SKILL_BODY_CHARS, SKILL_TYPES } from "../../constants";
import { ProjectContextSection } from "./_components/ProjectContextSection";
import { s } from "./styles";

export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [enabled, setEnabled] = React.useState(skill.enabled);
  const [body, setBody] = React.useState(skill.body);
  const [summary, setSummary] = React.useState("");

  // Re-seed when the user selects a different skill in the left column.
  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setEnabled(skill.enabled);
    setBody(skill.body);
    setSummary("");
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const bodyChanged = body !== skill.body;
  const dirty =
    bodyChanged ||
    name !== skill.name ||
    description !== skill.description ||
    type !== skill.type ||
    enabled !== skill.enabled;
  const overLimit = body.length > MAX_SKILL_BODY_CHARS;

  function save() {
    if (!dirty || overLimit) return;
    update.mutate(
      {
        id: skill.id,
        patch: {
          ...(name !== skill.name ? { name } : {}),
          ...(description !== skill.description ? { description } : {}),
          ...(type !== skill.type ? { type } : {}),
          ...(enabled !== skill.enabled ? { enabled } : {}),
          // A summary only means something alongside a new body — the server
          // drops it otherwise.
          ...(bodyChanged ? { body, ...(summary.trim() ? { summary: summary.trim() } : {}) } : {}),
        },
      },
      { onSuccess: () => setSummary("") },
    );
  }

  return (
    <div style={s.pane}>
      <div style={s.headRow}>
        <h2 style={s.heading}>{t("config.heading")}</h2>
        {dirty && <span style={s.unsaved}>{t("config.unsaved")}</span>}
      </div>

      <FormField label={t("config.nameLabel")} required>
        <TextInput value={name} onChange={setName} aria-label={t("config.nameLabel")} />
      </FormField>

      <FormField label={t("config.descriptionLabel")}>
        <TextInput
          value={description}
          onChange={setDescription}
          aria-label={t("config.descriptionLabel")}
        />
      </FormField>

      <FormField label={t("config.typeLabel")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={SKILL_TYPES.map((k) => ({ value: k, label: t(`listItem.type.${k}`) }))}
        />
      </FormField>

      <div style={s.enabledRow}>
        <span style={s.enabledLabel}>{t("config.enabled")}</span>
        <Toggle on={enabled} onChange={setEnabled} size={16} />
      </div>

      <FormField
        label={t("config.bodyLabel")}
        hint={t("config.bodyHint")}
        required
        right={
          <span style={s.counter(overLimit)}>
            {t("config.chars", { count: body.length, max: MAX_SKILL_BODY_CHARS })}
          </span>
        }
      >
        <Textarea value={body} onChange={setBody} rows={18} mono />
      </FormField>

      <FormField label={t("config.summaryLabel")} hint={t("config.summaryHint")}>
        <TextInput
          value={summary}
          onChange={setSummary}
          aria-label={t("config.summaryLabel")}
          disabled={!bodyChanged}
        />
      </FormField>

      {update.isError && (
        <div style={s.error}>
          {t("config.saveFailed")}
          {update.error instanceof ApiError ? ` — ${update.error.message}` : ""}
        </div>
      )}

      <div style={s.actions}>
        <Button
          kind="primary"
          size="sm"
          onClick={save}
          disabled={!dirty || overLimit || update.isPending}
        >
          {update.isPending ? t("config.saving") : t("config.save")}
        </Button>
      </div>

      {/* Below the Save row on purpose: attachments save on toggle, so nothing
          in this section is waiting for that button (AC-43). */}
      <ProjectContextSection skill={skill} />
    </div>
  );
}
