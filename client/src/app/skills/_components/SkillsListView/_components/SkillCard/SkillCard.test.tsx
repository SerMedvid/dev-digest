import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SkillWithUsage } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { SkillCard } from "./SkillCard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

/** Records the delete call. Returns the spy so the test can read (url, init). */
function stubFetch() {
  // Params are declared so `mock.calls[0]` is typed as (url, init) rather than [].
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      ({ ok: true, status: 200, statusText: "OK", json: async () => ({ ok: true }) }) as Response,
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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

  it("deletes the skill once the confirm is accepted", async () => {
    const fetchMock = stubFetch();
    vi.stubGlobal("confirm", vi.fn(() => true));
    const onClick = vi.fn();
    renderWithIntl(<SkillCard skill={SKILL} onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete skill" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/skills/sk1");
    expect(init?.method).toBe("DELETE");
    // The row's own click handler must not fire — deleting is not selecting.
    expect(onClick).not.toHaveBeenCalled();
  });

  it("deletes nothing when the confirm is dismissed", () => {
    const fetchMock = stubFetch();
    vi.stubGlobal("confirm", vi.fn(() => false));
    renderWithIntl(<SkillCard skill={SKILL} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete skill" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
