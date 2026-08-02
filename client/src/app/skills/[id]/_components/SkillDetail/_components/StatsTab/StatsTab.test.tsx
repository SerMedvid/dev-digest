import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SkillStats } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";
import { StatsTab } from "./StatsTab";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubStats(stats: SkillStats) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => stats,
    })),
  );
}

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

describe("StatsTab", () => {
  it("shows the usage count and links each agent to its editor", async () => {
    stubStats({
      agent_count: 2,
      agents: [
        { id: "a1", name: "Security Reviewer", enabled: true },
        { id: "a2", name: "Performance Reviewer", enabled: false },
      ],
    });
    renderWithIntl(<StatsTab skillId="sk1" />);
    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Security Reviewer/ })).toHaveAttribute(
      "href",
      "/agents/a1",
    );
    expect(screen.getByText("disabled")).toBeInTheDocument();
  });

  it("shows an empty state when no agent uses the skill", async () => {
    stubStats({ agent_count: 0, agents: [] });
    renderWithIntl(<StatsTab skillId="sk1" />);
    expect(await screen.findByText("Not used by any agent yet")).toBeInTheDocument();
  });
});
