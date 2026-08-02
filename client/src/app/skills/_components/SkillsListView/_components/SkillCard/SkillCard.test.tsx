import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SkillWithUsage } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL: SkillWithUsage = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Rubric for overall PR quality",
  type: "rubric",
  source: "manual",
  body: "# PR Quality Rubric",
  enabled: true,
  version: 5,
  evidence_files: null,
  agent_count: 3,
};

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SkillCard", () => {
  it("renders name, type badge and how many agents use it", () => {
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("3 agents")).toBeInTheDocument();
  });

  it("says 'Not used yet' when no agent links it", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, agent_count: 0 }} />);
    expect(screen.getByText("Not used yet")).toBeInTheDocument();
  });

  it("reports toggle changes to the parent", () => {
    const onToggle = vi.fn();
    renderWithIntl(<SkillCard skill={SKILL} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});
