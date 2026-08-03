import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill, SkillVersion } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";
import { VersionsTab } from "./VersionsTab";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Rubric for overall PR quality",
  type: "rubric",
  source: "manual",
  body: "# v2",
  enabled: true,
  version: 2,
  evidence_files: null,
};

const v = (version: number, summary: string | null): SkillVersion => ({
  skill_id: "sk1",
  version,
  summary,
  body: `# v${version}`,
  created_at: "2026-08-02T10:00:00.000Z",
});

function renderWithVersions(versions: SkillVersion[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => versions,
    })),
  );
  return renderTab();
}

/** A failing history load. `retry: false` is what makes the error state reachable. */
function renderWithFailure() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ error: { message: "boom" } }),
    })),
  );
  return renderTab();
}

function renderTab() {
  // Without this the query retries 3× with backoff and the error state never
  // arrives inside waitFor's window.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <VersionsTab skill={SKILL} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("VersionsTab", () => {
  it("marks the newest version Current and gives it no Restore button", async () => {
    renderWithVersions([v(2, "Tightened"), v(1, null)]);
    expect(await screen.findByText("Current")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /restore/i })).toHaveLength(1);
  });

  it("toggles a diff open for an older version", async () => {
    renderWithVersions([v(2, "Tightened"), v(1, null)]);
    fireEvent.click(await screen.findByRole("button", { name: /^diff$/i }));
    expect(screen.getByTestId("diff-view")).toBeInTheDocument();
  });

  it("offers a retry when the history load fails", async () => {
    renderWithFailure();
    expect(await screen.findByText("Could not load the version history.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
