import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../../../../messages/en/blast.json";
import { PriorPrs } from "./PriorPrs";

const BODY = {
  prs: [
    {
      number: 478,
      title: "Rate-limit public routes",
      author: "sergii",
      status: "merged",
      overlap_count: 3,
      overlap_files: ["src/a.ts", "src/b.ts", "src/c.ts"],
      updated_at: "2026-08-01T00:00:00.000Z",
    },
  ],
  uncomparable_prs: 0,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stub(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status < 400,
      status,
      statusText: status < 400 ? "OK" : "Server Error",
      json: async () => body,
    })),
  );
}

function renderSection(repoFullName: string | null = "acme/payments-api") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <QueryClientProvider client={qc}>
        <PriorPrs prId="pr1" repoFullName={repoFullName} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("PriorPrs", () => {
  it("lists a prior PR with its overlap, linked to GitHub", async () => {
    stub(200, BODY);
    renderSection();

    const link = await screen.findByRole("link", { name: /Rate-limit public routes/ });
    expect(link).toHaveAttribute("href", "https://github.com/acme/payments-api/pull/478");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/3 shared files/)).toBeInTheDocument();
    expect(screen.getByText(/sergii/)).toBeInTheDocument();
  });

  it("renders plain text — never a dead link — when the repo is unknown", async () => {
    stub(200, BODY);
    renderSection(null);

    expect(await screen.findByText(/Rate-limit public routes/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says nothing touched these files when the comparison was complete", async () => {
    stub(200, { prs: [], uncomparable_prs: 0 });
    renderSection();

    expect(await screen.findByText(/No merged or closed PR has touched these files/i))
      .toBeInTheDocument();
    expect(screen.queryByText(/couldn't be compared/i)).not.toBeInTheDocument();
  });

  it("never claims an all-clear when PRs could not be compared", async () => {
    // The empty list is a lower bound, and saying so is the whole point of
    // carrying `uncomparable_prs` on the response.
    stub(200, { prs: [], uncomparable_prs: 12 });
    renderSection();

    expect(await screen.findByText(/12 other PRs/i)).toBeInTheDocument();
    expect(screen.queryByText(/No merged or closed PR has touched these files/i))
      .not.toBeInTheDocument();
  });

  it("reports a failed read inline without throwing", async () => {
    stub(500, { error: { message: "boom" } });
    renderSection();

    expect(await screen.findByText(/Couldn't load prior PRs/i)).toBeInTheDocument();
  });
});

describe("PriorPrs — disclosure", () => {
  it("opens on mount and collapses the list away, toggling aria-expanded", async () => {
    stub(200, BODY);
    renderSection();

    await screen.findByText(/Rate-limit public routes/);
    const header = screen.getByRole("button", { name: /Prior PRs touching these files/i });
    expect(header).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Rate-limit public routes/)).not.toBeInTheDocument();
    // The section itself must not vanish — collapsed is not gone.
    expect(screen.getByText(/Prior PRs touching these files/i)).toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Rate-limit public routes/)).toBeInTheDocument();
  });

  it("says how many PRs are folded away, so the collapsed header is not opaque", async () => {
    stub(200, BODY);
    renderSection();

    expect(await screen.findByText("1 PRs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Prior PRs touching these files/i }));
    // The count survives the collapse — it is the whole point of putting it
    // on the header rather than in the body.
    expect(screen.getByText("1 PRs")).toBeInTheDocument();
  });

  it("keeps the all-clear and its caveat together when collapsed", async () => {
    // Hiding the list while leaving "12 could not be compared" on screen would
    // strand the caveat; hiding the caveat alone would leave a false all-clear.
    stub(200, { prs: [], uncomparable_prs: 12 });
    renderSection();

    expect(await screen.findByText(/12 other PRs/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Prior PRs touching these files/i }));
    expect(screen.queryByText(/12 other PRs/i)).not.toBeInTheDocument();
  });
});
