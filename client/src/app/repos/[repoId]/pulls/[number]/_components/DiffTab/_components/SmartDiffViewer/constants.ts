import type { SmartDiffRole } from "@devdigest/shared";

/** i18n key (under `prReview.smartDiff.`) for a role's heading label. */
export const GROUP_LABEL_KEY: Record<SmartDiffRole, string> = {
  core: "coreLabel",
  wiring: "wiringLabel",
  boilerplate: "boilerplateLabel",
};

/** i18n key (under `prReview.smartDiff.`) for a role's one-line description
 *  — design §2.1. */
export const GROUP_DESC_KEY: Record<SmartDiffRole, string> = {
  core: "coreDesc",
  wiring: "wiringDesc",
  boilerplate: "boilerplateDesc",
};

/**
 * Mirrors `components/diff-viewer`'s own `AUTO_EXPAND_MAX_LINES` — design
 * §6.2 rule 3 ("otherwise today's `AUTO_EXPAND_MAX_LINES` applies unchanged")
 * means this precedence has to end on the exact same threshold FileCard's
 * uncontrolled mode already defaults to. Restated here rather than imported
 * because this task's file list doesn't touch `components/diff-viewer`; if
 * that value ever changes, this one has to move with it. See the task-8
 * report for the tradeoff.
 */
export const AUTO_EXPAND_MAX_LINES = 200;
