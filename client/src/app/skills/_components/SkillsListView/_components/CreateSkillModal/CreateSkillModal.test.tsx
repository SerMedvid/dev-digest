import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "../../../../../../../messages/en/skills.json";
import { CreateSkillModal } from "./CreateSkillModal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

function openModal(initialTab?: "create" | "file") {
  return renderWithIntl(
    <CreateSkillModal open onClose={() => {}} onCreated={() => {}} {...(initialTab ? { initialTab } : {})} />,
  );
}

/** The body textarea has no accessible name (FormField renders no `htmlFor`). */
const bodyBox = () => screen.getByPlaceholderText(/describe the rule/i);

describe("CreateSkillModal", () => {
  it("opens on the Create tab and blocks submit until name and body are filled", () => {
    openModal();
    const submit = screen.getByRole("button", { name: "Create skill" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Skill name"), { target: { value: "Async convention" } });
    expect(submit).toBeDisabled();

    fireEvent.change(bodyBox(), { target: { value: "Require async/await" } });
    expect(submit).toBeEnabled();
  });

  it("opens on the requested tab, with no body field until a file is picked", () => {
    openModal("file");
    expect(screen.getByLabelText(/import from file/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import skill" })).toBeInTheDocument();
    // An empty textarea before a file is chosen reads as "type here" — it isn't.
    expect(screen.queryByPlaceholderText(/describe the rule/i)).not.toBeInTheDocument();
  });

  it("shows the reason a creation failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: async () => ({ error: { message: 'A skill named "dupe" already exists' } }),
      })),
    );

    openModal();
    fireEvent.change(screen.getByLabelText("Skill name"), { target: { value: "dupe" } });
    fireEvent.change(bodyBox(), { target: { value: "# Rule" } });
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    expect(await screen.findByText(/Could not create this skill/)).toHaveTextContent(
      'A skill named "dupe" already exists',
    );
  });

  it("fills the body from a picked markdown file and derives the name from its heading", async () => {
    openModal();
    fireEvent.click(screen.getByRole("button", { name: "From file" }));

    const file = new File(["# From file"], "rule.md", { type: "text/markdown" });
    fireEvent.change(screen.getByLabelText(/import from file/i), { target: { files: [file] } });

    expect(await screen.findByDisplayValue("# From file")).toBeInTheDocument();
    expect(screen.getByText("rule.md")).toBeInTheDocument();
    // Name left blank — derived, so import is allowed.
    expect(screen.getByRole("button", { name: "Import skill" })).toBeEnabled();
  });

  it("keeps the draft when switching tabs", () => {
    openModal();
    fireEvent.change(bodyBox(), { target: { value: "# Kept" } });

    fireEvent.click(screen.getByRole("button", { name: "From file" }));
    expect(screen.getByDisplayValue("# Kept")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByDisplayValue("# Kept")).toBeInTheDocument();
  });
});
