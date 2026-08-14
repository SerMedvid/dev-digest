import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs. Evals/Stats/CI arrive with later lessons. */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
];

/**
 * The tab keys `?tab=` accepts, derived from `TABS` rather than repeated.
 *
 * The route used to carry its own hardcoded array, and adding the Context tab
 * here did not add it there: the tab rendered, the click wrote `?tab=context`,
 * the allowlist rejected the value and the route fell back to `config` — a tab
 * that looked present and could not be opened. Two lists that must agree is one
 * list too many, so the route imports this one. `SkillDetail` does the same.
 */
export const VALID_TABS: readonly string[] = TABS.map((tab) => tab.key);
