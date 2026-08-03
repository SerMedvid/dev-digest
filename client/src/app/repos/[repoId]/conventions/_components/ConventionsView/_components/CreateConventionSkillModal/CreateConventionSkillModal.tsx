/* CreateConventionSkillModal — the accepted candidates, merged server-side into
   one skill body, then handed to the user to edit before it is saved. That
   review step is the whole trust boundary for `source: 'extracted'` (design §7),
   so the full body is always visible and always editable here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  FormField,
  Icon,
  Modal,
  SelectInput,
  TextInput,
  Textarea,
  Toggle,
} from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useAgents } from "@/lib/hooks/agents";
import { useConventionSkillDraft, useCreateConventionSkill } from "@/lib/hooks/conventions";
import { MAX_SKILL_BODY_CHARS, SKILL_TYPES } from "./constants";
import { s } from "./styles";

export function CreateConventionSkillModal({
  repoId,
  repoName,
  acceptedCount,
  onClose,
  onCreated,
}: {
  repoId: string;
  repoName: string;
  acceptedCount: number;
  onClose: () => void;
  onCreated: (skillId: string) => void;
}) {
  const t = useTranslations("conventions");
  const draft = useConventionSkillDraft(repoId, true);
  const agents = useAgents();
  const create = useCreateConventionSkill();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("convention");
  const [enabled, setEnabled] = React.useState(true);
  const [body, setBody] = React.useState("");
  const [agentId, setAgentId] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  // Adopt the draft once. After that the fields are the user's, and a refetch
  // must not overwrite what they typed.
  const adopted = React.useRef(false);
  React.useEffect(() => {
    if (adopted.current || !draft.data) return;
    adopted.current = true;
    setName(draft.data.name);
    setDescription(draft.data.description);
    setType(draft.data.type);
    setBody(draft.data.body);
  }, [draft.data]);

  const overLimit = body.length > MAX_SKILL_BODY_CHARS;
  const canSubmit = name.trim().length > 0 && body.trim().length > 0 && !overLimit;

  function submit() {
    if (!canSubmit) return;
    create.mutate(
      {
        repoId,
        input: {
          name: name.trim(),
          description: description.trim(),
          type,
          body,
          enabled,
          ...(agentId ? { agent_id: agentId } : {}),
        },
      },
      { onSuccess: (skill) => onCreated(skill.id) },
    );
  }

  return (
    <Modal
      title={t("modal.title")}
      subtitle={name || repoName}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <span style={s.footerNote}>{t("modal.footerNote")}</span>
          <div style={s.footerActions}>
            <Button kind="ghost" size="sm" onClick={onClose}>
              {t("modal.cancel")}
            </Button>
            <Button
              kind="primary"
              size="sm"
              icon="Sparkles"
              onClick={submit}
              disabled={!canSubmit || create.isPending}
            >
              {create.isPending ? t("modal.creating") : t("modal.create")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.banner}>
          <Icon.Sparkles size={15} />
          <span>{t("modal.mergedFrom", { count: acceptedCount, repo: repoName })}</span>
        </div>

        {draft.isError && <div style={s.error}>{t("modal.draftFailed")}</div>}

        <FormField label={t("modal.nameLabel")} required>
          <TextInput
            value={name}
            onChange={(v) => {
              setName(v);
              setTouched(true);
            }}
            aria-label={t("modal.nameLabel")}
          />
        </FormField>

        <FormField label={t("modal.descriptionLabel")}>
          <TextInput
            value={description}
            onChange={setDescription}
            aria-label={t("modal.descriptionLabel")}
          />
        </FormField>

        <div style={s.twoUp}>
          <FormField label={t("modal.typeLabel")}>
            <SelectInput
              value={type}
              onChange={(v) => setType(v as SkillType)}
              options={SKILL_TYPES.map((k) => ({ value: k, label: k }))}
            />
          </FormField>
          <div style={s.toggleWrap}>
            <FormField label={t("modal.enabledLabel")}>
              <Toggle on={enabled} onChange={setEnabled} />
            </FormField>
            <span style={s.toggleHint}>{t("modal.enabledHint")}</span>
          </div>
        </div>

        {/* SelectInput forwards no aria-label (see client/INSIGHTS.md), so this
            picker is identified by its "don't link yet" option, not by a name. */}
        <FormField label={t("modal.agentLabel")} hint={t("modal.agentHint")}>
          <SelectInput
            value={agentId}
            onChange={setAgentId}
            options={[
              { value: "", label: t("modal.agentNone") },
              ...(agents.data ?? []).map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
        </FormField>

        <FormField label={t("modal.bodyLabel")} required>
          <div style={s.bodyHead}>
            <span className="mono">
              {name || repoName}.md{" "}
              {touched || body !== (draft.data?.body ?? "") ? (
                <span style={s.unsaved}>{t("modal.unsaved")}</span>
              ) : null}
            </span>
            <span className="mono tnum">
              {t("modal.tokens", { count: draft.data?.token_estimate ?? 0 })}
            </span>
          </div>
          <Textarea value={body} onChange={setBody} rows={12} mono />
        </FormField>

        {create.isError && <div style={s.error}>{t("modal.createFailed")}</div>}
      </div>
    </Modal>
  );
}
