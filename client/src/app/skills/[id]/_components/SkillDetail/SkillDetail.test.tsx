/* SkillDetail — tab wiring only. The Context tab's behaviour is covered by
   ProjectContextSection's own suite; what is pinned here is that the tab exists
   at all, that the route will accept it in `?tab=`, and that it is a tab rather
   than a block inside Config.

   It shipped nested under Config first, which put the attachments below the
   Save row of a form whose body field grows to 20k characters — present in the
   DOM, effectively invisible, and with no URL that opened it. */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import { TABS, VALID_TABS } from "./constants";

// The Context tab's child reaches for the active repository and the API; this
// file is about the tab bar, so the section is stubbed to a marker.
vi.mock("./_components/ContextTab", () => ({
  ContextTab: () => <div data-testid="context-tab-body" />,
}));
vi.mock("./_components/ConfigTab", () => ({
  ConfigTab: () => <div data-testid="config-tab-body" />,
}));
vi.mock("./_components/PreviewTab", () => ({ PreviewTab: () => <div /> }));
vi.mock("./_components/StatsTab", () => ({ StatsTab: () => <div /> }));
vi.mock("./_components/VersionsTab", () => ({ VersionsTab: () => <div /> }));

import { SkillDetail } from "./SkillDetail";

afterEach(cleanup);

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Rubric for evaluating overall PR quality.",
  type: "rubric",
  body: "# rubric",
  enabled: true,
  version: 5,
  source: "manual",
} as Skill;

function renderDetail(tab: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillDetail skill={SKILL} tab={tab} onTab={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("SkillDetail", () => {
  it("offers Context as a tab of its own", () => {
    renderDetail("config");
    expect(screen.getByText("Context")).toBeInTheDocument();
    // Config renders the config body and nothing else — the attachments are no
    // longer smuggled in underneath it.
    expect(screen.getByTestId("config-tab-body")).toBeInTheDocument();
    expect(screen.queryByTestId("context-tab-body")).toBeNull();
  });

  it("renders the context body when the tab is selected", () => {
    renderDetail("context");
    expect(screen.getByTestId("context-tab-body")).toBeInTheDocument();
    expect(screen.queryByTestId("config-tab-body")).toBeNull();
  });

  /* The route filters `?tab=` through this list before handing it down, so a
     tab missing from it renders and cannot be opened. */
  it("accepts every rendered tab as a URL value", () => {
    for (const tab of TABS) {
      expect(VALID_TABS).toContain(tab.key);
    }
    expect(VALID_TABS).toContain("context");
  });
});
