/* AttachmentList — the drag-to-reorder scaffolding both Context editors use.

   Order is a real edit, not a display preference: the stored order is the order
   a review run assembles the documents in, so a drag commits a replace. Only
   rows the editor actually owns can move — everything else (inherited,
   cross-repository, merely discovered) has no stored position — so the caller
   passes the sortable ids and renders the rest itself.

   This owns the dnd-kit wiring and nothing else. It does not know what a row
   looks like: `renderItem` draws it, which is what lets one list serve two
   editors whose rows carry different semantics. */
"use client";

import React from "react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** What `renderItem` is handed for a sortable row. */
export interface SortableItemProps {
  dragging: boolean;
  handleProps: React.HTMLAttributes<HTMLButtonElement>;
}

function SortableItem({
  id,
  render,
}: {
  id: string;
  render: (props: SortableItemProps) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      {render({
        dragging: isDragging,
        handleProps: { ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>,
      })}
    </div>
  );
}

export function AttachmentList({
  ids,
  renderItem,
  onReorder,
}: {
  /** Sortable row ids, in stored order — repo-relative paths in both editors. */
  ids: string[];
  renderItem: (id: string, props: SortableItemProps) => React.ReactNode;
  /**
   * The moved row and the one it was dropped onto, **as ids**, never as indices
   * into `ids`. A filter can make this list a subset of what the editor stores,
   * so an index here would not be an index there — and the replace is computed
   * against the stored list. The caller resolves both against its own.
   */
  onReorder: (activeId: string, overId: string) => void;
}) {
  /* PointerSensor only, inherited from `SkillsTab`. A KeyboardSensor belongs to
     every drag surface or none (spec Open question 5), not to this one alone. */
  const sensors = useSensors(useSensor(PointerSensor));

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    onReorder(String(active.id), String(over.id));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {ids.map((id) => (
          <SortableItem key={id} id={id} render={(props) => renderItem(id, props)} />
        ))}
      </SortableContext>
    </DndContext>
  );
}
