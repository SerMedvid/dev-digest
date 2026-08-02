import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";
import skillMessages from "../../../../../../../../messages/en/skills.json";
import { SkillsTab } from "./SkillsTab";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

const skill = (id: string, name: string) => ({
  id,
  name,
  description: "",
  type: "rubric" as const,
  source: "manual" as const,
  body: "# rule",
  enabled: true,
  version: 1,
  evidence_files: null,
  agent_count: 0,
});

/**
 * Three skills in the workspace, one of them already linked. Returns the spy
 * that records `POST /agents/ag1/skills` bodies.
 */
function stubSkillsAndLinks() {
  const post = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      let json: unknown = [];
      if (init?.method === "POST") {
        post(url, body);
        json = [];
      } else if (url.endsWith("/skills") && url.includes("/agents/")) {
        json = [{ agent_id: "ag1", skill_id: "sk1", order: 0 }];
      } else if (url.endsWith("/skills")) {
        json = [
          skill("sk1", "pr-quality-rubric"),
          skill("sk2", "no-then-chains"),
          skill("sk3", "secret-leakage-gate"),
        ];
      }
      return { ok: true, status: 200, statusText: "OK", json: async () => json } as Response;
    }),
  );
  return post;
}

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: messages, skills: skillMessages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SkillsTab", () => {
  it("counts linked skills and pre-checks them", async () => {
    stubSkillsAndLinks();
    renderWithIntl(<SkillsTab agent={AGENT} />);
    expect(await screen.findByText("1 of 3 enabled")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /pr-quality-rubric/ })).toBeChecked();
  });

  it("posts the full ordered id list when a skill is linked", async () => {
    const post = stubSkillsAndLinks();
    renderWithIntl(<SkillsTab agent={AGENT} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /no-then-chains/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[1]).toEqual({ skill_ids: ["sk1", "sk2"] });
  });

  it("posts the shortened list when a skill is unlinked", async () => {
    const post = stubSkillsAndLinks();
    renderWithIntl(<SkillsTab agent={AGENT} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /pr-quality-rubric/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[1]).toEqual({ skill_ids: [] });
  });
});
