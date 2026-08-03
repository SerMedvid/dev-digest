import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "../../../../../../../../../messages/en/conventions.json";
import { CreateConventionSkillModal } from "./CreateConventionSkillModal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DRAFT = {
  name: "payments-api-conventions",
  description: "3 house conventions extracted from payments-api",
  type: "convention",
  body: "# payments-api-conventions\n\nAlways use async/await.",
  token_estimate: 187,
};

const AGENTS = [
  { id: "a1", name: "API Contract Reviewer", version: 3 },
  { id: "a2", name: "Security Reviewer", version: 1 },
];

/** Routes each stubbed request by URL: draft (GET), agents (GET), create (POST). */
function stubApi(opts: { draftFails?: boolean; createFails?: boolean } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/skill-draft")) {
      return opts.draftFails
        ? {
            ok: false,
            status: 409,
            statusText: "Conflict",
            json: async () => ({ error: { message: "nothing accepted" } }),
          }
        : { ok: true, status: 200, statusText: "OK", json: async () => DRAFT };
    }
    if (String(url).includes("/agents")) {
      return { ok: true, status: 200, statusText: "OK", json: async () => AGENTS };
    }
    if (init?.method === "POST") {
      return opts.createFails
        ? {
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
            json: async () => ({ error: { message: "boom" } }),
          }
        : { ok: true, status: 201, statusText: "Created", json: async () => ({ id: "sk9" }) };
    }
    throw new Error(`unstubbed ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderModal(
  props: Partial<React.ComponentProps<typeof CreateConventionSkillModal>> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <CreateConventionSkillModal
          repoId="r1"
          repoName="payments-api"
          acceptedCount={3}
          onClose={() => {}}
          onCreated={() => {}}
          {...props}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function postBody(mock: ReturnType<typeof stubApi>) {
  const call = mock.mock.calls.find((c) => c[1]?.method === "POST")!;
  return JSON.parse(String(call[1]!.body));
}

/** The vendored SelectInput forwards no aria-label, so the agent picker is
    found through the option only it has (see client/INSIGHTS.md). */
function agentSelect(): HTMLSelectElement {
  return screen.getByRole("option", { name: "Don't link yet" }).closest("select")!;
}

describe("CreateConventionSkillModal", () => {
  it("prefills name, description and body from the server draft", async () => {
    stubApi();
    const { container } = renderModal();
    expect(await screen.findByDisplayValue("payments-api-conventions")).toBeInTheDocument();
    expect(screen.getByDisplayValue(DRAFT.description)).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector("textarea")).toHaveValue(DRAFT.body));
  });

  it("says what the body was merged from and how big it is", async () => {
    stubApi();
    renderModal();
    expect(
      await screen.findByText(/Merged from 3 accepted conventions in payments-api/),
    ).toBeInTheDocument();
    // The banner is static, so it renders before the draft lands — the token
    // count is the part that has to wait for it.
    expect(await screen.findByText("187 tokens")).toBeInTheDocument();
  });

  it("creates the skill with the edited body", async () => {
    const mock = stubApi();
    const { container } = renderModal();
    await waitFor(() => expect(container.querySelector("textarea")).toHaveValue(DRAFT.body));
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "edited body" } });
    fireEvent.click(screen.getByRole("button", { name: /^create skill$/i }));

    await waitFor(() => expect(postBody(mock).body).toBe("edited body"));
    expect(postBody(mock).name).toBe("payments-api-conventions");
    expect(postBody(mock).type).toBe("convention");
  });

  it("links the chosen agent, and sends no agent when none is chosen", async () => {
    const mock = stubApi();
    renderModal();
    await screen.findByDisplayValue("payments-api-conventions");

    fireEvent.click(screen.getByRole("button", { name: /^create skill$/i }));
    await waitFor(() => expect(postBody(mock)).not.toHaveProperty("agent_id"));

    cleanup();
    const mock2 = stubApi();
    renderModal();
    await screen.findByDisplayValue("payments-api-conventions");
    await waitFor(() => expect(screen.getByRole("option", { name: AGENTS[0]!.name })).toBeTruthy());
    fireEvent.change(agentSelect(), { target: { value: "a1" } });
    fireEvent.click(screen.getByRole("button", { name: /^create skill$/i }));
    await waitFor(() => expect(postBody(mock2).agent_id).toBe("a1"));
  });

  it("hands the new skill id back to the caller", async () => {
    stubApi();
    const onCreated = vi.fn();
    renderModal({ onCreated });
    await screen.findByDisplayValue("payments-api-conventions");
    fireEvent.click(screen.getByRole("button", { name: /^create skill$/i }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("sk9"));
  });

  it("cannot submit with an empty name", async () => {
    stubApi();
    renderModal();
    const name = await screen.findByDisplayValue("payments-api-conventions");
    fireEvent.change(name, { target: { value: "  " } });
    expect(screen.getByRole("button", { name: /^create skill$/i })).toBeDisabled();
  });

  it("explains a draft that could not be built", async () => {
    stubApi({ draftFails: true });
    renderModal();
    expect(await screen.findByText(/Could not build the skill draft/)).toBeInTheDocument();
  });

  it("surfaces a failed creation", async () => {
    stubApi({ createFails: true });
    renderModal();
    await screen.findByDisplayValue("payments-api-conventions");
    fireEvent.click(screen.getByRole("button", { name: /^create skill$/i }));
    expect(await screen.findByText(/Could not create the skill/)).toBeInTheDocument();
  });
});
