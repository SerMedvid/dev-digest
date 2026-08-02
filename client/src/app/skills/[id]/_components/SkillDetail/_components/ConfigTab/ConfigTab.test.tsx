import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";
import { ConfigTab } from "./ConfigTab";

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
  body: "# PR Quality Rubric",
  enabled: true,
  version: 5,
  evidence_files: null,
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

/**
 * `apiFetch` is the only thing in the client that touches `fetch`, so stubbing
 * it is enough — there is no MSW here. Records (url, parsed body) per call.
 */
function makeFetchMock(record: (url: string, body: unknown) => unknown) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = init?.body ? JSON.parse(String(init.body)) : undefined;
    const json = record(url, parsed);
    return { ok: true, status: 200, statusText: "OK", json: async () => json } as Response;
  });
}

/**
 * The body field is queried through the container: the vendored `Textarea`
 * forwards no props and `FormField`'s label is not associated with its control,
 * so there is no accessible name to query by. ConfigTab renders exactly one.
 */
const bodyField = (c: HTMLElement) => c.querySelector("textarea")!;

describe("ConfigTab", () => {
  it("marks the body as unsaved once it is edited", () => {
    const { container } = renderWithIntl(<ConfigTab skill={SKILL} />);
    fireEvent.change(bodyField(container), { target: { value: "# changed" } });
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });

  it("saves name, body and the change note together", async () => {
    const put = vi.fn().mockReturnValue({ ...SKILL, body: "# changed", version: 6 });
    vi.stubGlobal("fetch", makeFetchMock(put));

    const { container } = renderWithIntl(<ConfigTab skill={SKILL} />);
    fireEvent.change(bodyField(container), { target: { value: "# changed" } });
    fireEvent.change(screen.getByLabelText(/change note/i), { target: { value: "Tightened" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]?.[1]).toMatchObject({ body: "# changed", summary: "Tightened" });
  });
});
