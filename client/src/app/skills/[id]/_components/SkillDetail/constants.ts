import type { IconName } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";

/**
 * The four detail tabs. There is deliberately no Evals tab — the `eval_*`
 * tables are empty, so it would have nothing to show.
 */
export const TABS: readonly { key: string; labelKey: string; icon: IconName }[] = [
  { key: "config", labelKey: "detail.tabs.config", icon: "Settings" },
  { key: "context", labelKey: "detail.tabs.context", icon: "FileText" },
  { key: "preview", labelKey: "detail.tabs.preview", icon: "Eye" },
  { key: "stats", labelKey: "detail.tabs.stats", icon: "BarChart" },
  { key: "versions", labelKey: "detail.tabs.versions", icon: "History" },
] as const;

export const VALID_TABS = TABS.map((t) => t.key);

/** Mirrors the server limit so the ceiling shows while typing, not as a 422. */
export const MAX_SKILL_BODY_CHARS = 20_000;

export const SKILL_TYPES: SkillType[] = ["rubric", "convention", "security", "custom"];
