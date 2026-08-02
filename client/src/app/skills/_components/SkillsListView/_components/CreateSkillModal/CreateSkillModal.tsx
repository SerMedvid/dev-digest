/* CreateSkillModal — the only two creation sources that exist: type it, or read
   a local .md file into the same body field. URL import and community search
   are deliberately absent; they have no server behind them. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, FormField, TextInput, Textarea, SelectInput, Button } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../../../lib/hooks/skills";
import { ApiError } from "../../../../../../lib/api";
import { MAX_SKILL_BODY_CHARS, SKILL_TYPES } from "./constants";
import { s } from "./styles";

/**
 * Read a picked file as text. `FileReader` rather than `Blob.text()`: jsdom 25
 * ships `File` without `.text()`, so the tidier call is untestable here.
 */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function CreateSkillModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations("skills");
  const create = useCreateSkill();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("rubric");
  const [body, setBody] = React.useState("");

  if (!open) return null;

  const overLimit = body.length > MAX_SKILL_BODY_CHARS;
  const canSubmit = name.trim().length > 0 && body.trim().length > 0 && !overLimit;

  /** Read the picked file in the browser. It is never uploaded anywhere. */
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBody(await readText(file));
    setName((current) => current || file.name.replace(/\.mdx?$/i, ""));
  }

  function submit() {
    if (!canSubmit) return;
    create.mutate(
      { name: name.trim(), description: description.trim(), type, body },
      { onSuccess: (skill) => onCreated(skill.id) },
    );
  }

  return (
    <Modal
      title={t("drawer.title")}
      subtitle={t("drawer.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" size="sm" onClick={onClose}>
            {t("file.cancel")}
          </Button>
          <Button kind="primary" size="sm" onClick={submit} disabled={!canSubmit || create.isPending}>
            {create.isPending ? t("file.importing") : t("file.import")}
          </Button>
        </div>
      }
    >
      <FormField label={t("file.nameLabel")} hint={t("file.nameHint")} required>
        <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} />
      </FormField>

      <FormField label={t("file.descriptionLabel")} hint={t("file.descriptionHint")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>

      <FormField label={t("file.typeLabel")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={SKILL_TYPES.map((k) => ({ value: k, label: t(`listItem.type.${k}`) }))}
        />
      </FormField>

      <div style={s.fileRow}>
        <label htmlFor="skill-file" style={s.fileInput}>
          {t("file.pickFile")}
        </label>
        <input
          id="skill-file"
          ref={fileRef}
          type="file"
          accept=".md,text/markdown"
          aria-label={t("file.pickFile")}
          onChange={onPickFile}
          style={s.fileInput}
        />
      </div>

      <FormField
        label={t("file.bodyLabel")}
        hint={t("file.pickFileHint")}
        required
        right={
          <span style={s.counter(overLimit)}>
            {t("file.chars", { count: body.length, max: MAX_SKILL_BODY_CHARS })}
          </span>
        }
      >
        <Textarea value={body} onChange={setBody} rows={12} mono placeholder={t("file.bodyPlaceholder")} />
      </FormField>

      {create.isError && (
        <div style={s.error}>
          {t("drawer.importFailed")}
          {create.error instanceof ApiError ? ` — ${create.error.message}` : ""}
        </div>
      )}
    </Modal>
  );
}
