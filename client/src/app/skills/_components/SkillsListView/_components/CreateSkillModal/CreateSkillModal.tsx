/* CreateSkillModal — the only two creation sources that exist: type it, or read
   a local .md file into the same body field. URL import and community search
   are deliberately absent; they have no server behind them.

   Both tabs write one shared draft, so a file can be picked and then edited on
   the Create tab without losing anything. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Tabs, FormField, TextInput, Textarea, SelectInput, Button, Icon } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../../../lib/hooks/skills";
import { ApiError } from "../../../../../../lib/api";
import {
  CREATE_SKILL_TABS,
  MAX_SKILL_BODY_CHARS,
  SKILL_FILE_ACCEPT,
  SKILL_TYPES,
  type CreateSkillTab,
} from "./constants";
import { deriveSkillName } from "./helpers";
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
  initialTab = "create",
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  initialTab?: CreateSkillTab;
}) {
  const t = useTranslations("skills");
  const create = useCreateSkill();

  const [tab, setTab] = React.useState<CreateSkillTab>(initialTab);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("rubric");
  const [body, setBody] = React.useState("");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [fileFocused, setFileFocused] = React.useState(false);

  if (!open) return null;

  const onFileTab = tab === "file";
  const overLimit = body.length > MAX_SKILL_BODY_CHARS;
  // Blank names are derived on the file tab only; on the Create tab the field is
  // the user's own input and stays required.
  const effectiveName = name.trim() || (onFileTab ? deriveSkillName(body, fileName ?? undefined) : "");
  const canSubmit = effectiveName.length > 0 && body.trim().length > 0 && !overLimit;

  /** Read the picked file in the browser. It is never uploaded anywhere. */
  async function takeFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setBody(await readText(file));
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    void takeFile(e.target.files?.[0]);
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragOver(false);
    void takeFile(e.dataTransfer.files?.[0]);
  }

  function submit() {
    if (!canSubmit) return;
    create.mutate(
      { name: effectiveName, description: description.trim(), type, body },
      { onSuccess: (skill) => onCreated(skill.id) },
    );
  }

  const nameField = (
    <FormField label={t("file.nameLabel")} hint={t("file.nameHint")} required={!onFileTab}>
      <TextInput
        value={name}
        onChange={setName}
        placeholder={onFileTab ? effectiveName || t("file.namePlaceholder") : t("file.namePlaceholder")}
        aria-label={t("file.nameLabel")}
      />
    </FormField>
  );

  const typeField = (
    <FormField label={t("file.typeLabel")}>
      <SelectInput
        value={type}
        onChange={(v) => setType(v as SkillType)}
        options={SKILL_TYPES.map((k) => ({ value: k, label: t(`listItem.type.${k}`) }))}
      />
    </FormField>
  );

  const bodyField = (rows: number) => (
    <FormField
      label={t("file.bodyLabel")}
      hint={onFileTab ? t("file.pickFileHint") : t("file.bodyHint")}
      required={!onFileTab}
      right={
        <span style={s.counter(overLimit)}>
          {t("file.chars", { count: body.length, max: MAX_SKILL_BODY_CHARS })}
        </span>
      }
    >
      <Textarea value={body} onChange={setBody} rows={rows} mono placeholder={t("file.bodyPlaceholder")} />
    </FormField>
  );

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
            {onFileTab
              ? create.isPending
                ? t("file.importing")
                : t("file.import")
              : create.isPending
                ? t("drawer.creating")
                : t("drawer.create")}
          </Button>
        </div>
      }
    >
      <Tabs
        pad={s.tabsPad}
        value={tab}
        onChange={(k) => setTab(k as CreateSkillTab)}
        tabs={CREATE_SKILL_TABS.map((k) => ({ key: k, label: t(`drawer.tabs.${k}`) }))}
      />

      <div style={s.body}>
        {onFileTab ? (
          <>
            {nameField}
            {typeField}

            <FormField label={t("file.fileLabel")} hint={t("file.pickFileHint")}>
              <label
                htmlFor="skill-file"
                style={s.dropzone({ hasFile: !!fileName, over: dragOver, focused: fileFocused })}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
              >
                {fileName ? <Icon.Check size={15} /> : <Icon.Upload size={15} />}
                <span style={s.dropzoneText}>
                  {fileName ? <span style={s.dropzoneFileName}>{fileName}</span> : t("file.dropzone")}
                </span>
                <span style={s.dropzoneAction}>{fileName ? t("file.replaceFile") : t("file.browse")}</span>
              </label>
              <input
                id="skill-file"
                type="file"
                accept={SKILL_FILE_ACCEPT}
                aria-label={t("file.pickFile")}
                onChange={onPickFile}
                onFocus={() => setFileFocused(true)}
                onBlur={() => setFileFocused(false)}
                style={s.hiddenFileInput}
              />
            </FormField>

            {/* Shown once there is something to vet, so the user sees what was read. */}
            {body.length > 0 && bodyField(8)}
          </>
        ) : (
          <>
            {nameField}

            <FormField label={t("file.descriptionLabel")} hint={t("file.descriptionHint")}>
              <TextInput
                value={description}
                onChange={setDescription}
                aria-label={t("file.descriptionLabel")}
              />
            </FormField>

            {typeField}
            {bodyField(12)}
          </>
        )}

        {create.isError && (
          <div style={s.error}>
            {onFileTab ? t("drawer.importFailed") : t("drawer.createFailed")}
            {create.error instanceof ApiError ? ` — ${create.error.message}` : ""}
          </div>
        )}
      </div>
    </Modal>
  );
}
