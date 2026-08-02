import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "../../../../../../../messages/en/skills.json";
import { CreateSkillModal } from "./CreateSkillModal";

afterEach(cleanup);

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

describe("CreateSkillModal", () => {
  it("blocks submit until name and body are filled", () => {
    renderWithIntl(<CreateSkillModal open onClose={() => {}} onCreated={() => {}} />);
    expect(screen.getByRole("button", { name: /import skill|create/i })).toBeDisabled();
  });

  it("fills the body from a dropped markdown file", async () => {
    renderWithIntl(<CreateSkillModal open onClose={() => {}} onCreated={() => {}} />);
    const file = new File(["# From file"], "rule.md", { type: "text/markdown" });
    const input = screen.getByLabelText(/import from file/i);
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByDisplayValue("# From file")).toBeInTheDocument();
  });
});
