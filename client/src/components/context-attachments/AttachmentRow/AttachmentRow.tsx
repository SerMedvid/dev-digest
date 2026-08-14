/* AttachmentRow — presentational. One project-context document, as either
   editor shows it.

   Shared between the agent's Context tab and the skill's, which drew the same
   row twice for a while: the cross-repository keying fix, the 409 handling and
   the per-run cap badge each had to be written into both copies, and drag
   reached only one of them. What the two genuinely do NOT share is row
   *semantics* — an agent row can be `inherited` from a linked skill, which is a
   kind a skill has no equivalent of — so this component takes booleans it
   renders and a `notes` slot it does not interpret, rather than a `kind` union
   one caller would never use.

   Three details are requirements rather than taste:

   - The checkbox is a real `<input type="checkbox">` wrapped in a `<label>`
     whose only text is the document's path, so its accessible name *is* the
     document (AC-42, AC-53). The vendored `Checkbox` is a
     `<button role="checkbox">` with a free `label` node, which cannot promise
     that.
   - The root segment rides in a chip whose text carries it; the tint is
     decoration (AC-53).
   - A row that cannot be detached here is a disabled checkbox rather than no
     checkbox, so it still reads as attached without offering an action it
     cannot perform (AC-50, AC-63). */
"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import { s } from "./styles";

/** The strings the row draws, supplied by the caller's own i18n namespace. */
export interface AttachmentRowLabels {
  /** Accessible name of the drag handle, for this path. */
  dragHandle: string;
  /** Accessible name of the preview button, for this path. */
  preview: string;
  /** Badge: attached but absent from the clone. */
  missing: string;
  /** Badge: stored and effective, but past the per-run read cap. */
  beyondCap: string;
}

export function AttachmentRow({
  path,
  root,
  attached,
  locked = false,
  inactive = false,
  missing = false,
  beyondReadCap = false,
  previewable,
  dragging = false,
  labels,
  notes,
  onToggle,
  onPreview,
  handleProps,
}: {
  path: string;
  /** Configured root segment that matched — shown as text, never colour alone. */
  root: string;
  attached: boolean;
  /** Checkbox disabled: attached, but not this editor's to detach. */
  locked?: boolean;
  /** Dimmed: belongs to a repository this editor is not looking at. */
  inactive?: boolean;
  missing?: boolean;
  beyondReadCap?: boolean;
  /** Defaults to "on disk and in this repository", which is when a preview works. */
  previewable?: boolean;
  dragging?: boolean;
  labels: AttachmentRowLabels;
  /**
   * Caller-owned trailing content — the agent's "inherited from <skill>" link,
   * the skill's owning-repository name. Rendered as given: this component does
   * not know what a skill is.
   */
  notes?: React.ReactNode;
  onToggle: (attached: boolean) => void;
  onPreview: () => void;
  /** Listeners/attributes from @dnd-kit; absent unless the row is draggable. */
  handleProps?: React.HTMLAttributes<HTMLButtonElement>;
}) {
  const canPreview = previewable ?? (!missing && !inactive);

  return (
    <div style={s.row(attached, inactive, dragging)}>
      {handleProps ? (
        <button type="button" aria-label={labels.dragHandle} style={s.handle} {...handleProps}>
          <Icon.Menu size={14} />
        </button>
      ) : (
        <span style={s.handleGap} />
      )}

      <label style={s.label}>
        <input
          type="checkbox"
          checked={attached}
          disabled={locked || inactive}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="mono" style={s.path}>
          {path}
        </span>
      </label>

      <span style={s.spacer} />

      {missing && <span style={s.missing}>{labels.missing}</span>}

      {/* Attached, ordered past the per-run cap, and therefore inert: the run
          names it unread and the footer does not bill it. Without this the row
          is indistinguishable from one that is injected on every review. */}
      {beyondReadCap && <span style={s.beyondCap}>{labels.beyondCap}</span>}

      {notes}

      <span style={s.rootChip}>{root}</span>

      {canPreview && (
        <button type="button" aria-label={labels.preview} style={s.preview} onClick={onPreview}>
          <Icon.Eye size={14} />
        </button>
      )}
    </div>
  );
}
