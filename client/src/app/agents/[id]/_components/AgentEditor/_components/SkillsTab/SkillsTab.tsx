/* SkillsTab — attach, detach and order the rules this agent reviews with.
   No Save button: every change posts the full ordered id list immediately.

   Ordering model (a deliberate deviation from the mock, which interleaves):
   linked skills sit at the top in their stored order and are the only
   draggable rows; unlinked skills sit below them, alphabetically. What is on
   screen is therefore always exactly what is stored — interleaving would have
   to invent an order for rows that have none, and lose it on reload. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EmptyState, ErrorState, Skeleton, TextInput } from "@devdigest/ui";
import type { Agent, SkillWithUsage } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills } from "../../../../../../../lib/hooks/agents";
import { useSkills } from "../../../../../../../lib/hooks/skills";
import { SkillRow } from "./_components/SkillRow";
import { moveLinked, orderRows } from "./helpers";
import { s } from "./styles";

/** A linked row, wrapped so @dnd-kit can drag it by its handle. */
function SortableSkillRow({
  skill,
  onToggle,
}: {
  skill: SkillWithUsage;
  onToggle: (linked: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: skill.id,
  });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <SkillRow
        skill={skill}
        linked
        dragging={isDragging}
        onToggle={onToggle}
        handleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const { data: links } = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills();
  const [filter, setFilter] = React.useState("");
  // Optimistic order; null means "trust the server data".
  const [pending, setPending] = React.useState<string[] | null>(null);
  const sensors = useSensors(useSensor(PointerSensor));

  const serverIds = React.useMemo(
    () => [...(links ?? [])].sort((a, b) => a.order - b.order).map((l) => l.skill_id),
    [links],
  );
  const linkedIds = pending ?? serverIds;

  function save(next: string[]) {
    const previous = linkedIds;
    setPending(next);
    setSkills.mutate(
      { agentId: agent.id, skillIds: next },
      { onSuccess: () => setPending(null), onError: () => setPending(previous) },
    );
  }

  if (isLoading) return <Skeleton height={220} />;
  if (isError || !skills) {
    return <ErrorState body={t("skillsTab.loadError")} onRetry={() => refetch()} />;
  }
  if (skills.length === 0) {
    return <EmptyState icon="Sparkles" title={t("skillsTab.empty")} body={t("skillsTab.emptyCta")} />;
  }

  const rows = orderRows(skills, linkedIds);
  const q = filter.trim().toLowerCase();
  const visible = q ? rows.filter((r) => r.skill.name.toLowerCase().includes(q)) : rows;
  const linkedRows = visible.filter((r) => r.linked);
  const unlinkedRows = visible.filter((r) => !r.linked);

  const toggle = (id: string, linked: boolean) =>
    save(linked ? [...linkedIds, id] : linkedIds.filter((x) => x !== id));

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = linkedIds.indexOf(String(active.id));
    const to = linkedIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    save(moveLinked(linkedIds, from, to));
  }

  return (
    <div style={s.pane}>
      <div style={s.headRow}>
        <h2 style={s.heading}>{t("skillsTab.heading")}</h2>
        <span style={s.counter}>
          {t("skillsTab.counter", { linked: linkedIds.length, total: skills.length })}
        </span>
      </div>
      <p style={s.hint}>{t("skillsTab.hint")}</p>

      <div style={s.filter}>
        <TextInput
          value={filter}
          onChange={setFilter}
          placeholder={t("skillsTab.filterPlaceholder")}
          aria-label={t("skillsTab.filterPlaceholder")}
        />
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={linkedRows.map((r) => r.skill.id)}
          strategy={verticalListSortingStrategy}
        >
          {linkedRows.map((r) => (
            <SortableSkillRow
              key={r.skill.id}
              skill={r.skill}
              onToggle={(linked) => toggle(r.skill.id, linked)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {unlinkedRows.map((r) => (
        <SkillRow
          key={r.skill.id}
          skill={r.skill}
          linked={false}
          onToggle={(linked) => toggle(r.skill.id, linked)}
        />
      ))}

      {setSkills.isError && <div style={s.error}>{t("skillsTab.saveFailed")}</div>}
    </div>
  );
}
