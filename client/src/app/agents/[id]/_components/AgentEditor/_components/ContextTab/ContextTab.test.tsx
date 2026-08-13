/* ContextTab — the agent editor's project-context surface.

   Everything here is queried by **accessible name** on purpose (AC-53): the row
   markup carries no test ids, and a checkbox that a screen reader cannot name is
   the defect this file exists to catch. The three counts and the token figure are
   asserted as the server sent them — recomputing any of them in the client would
   let the badge and the footer drift from what the run actually injects
   (AC-64, AC-66, AC-67). */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  Agent,
  ContextAttachmentRow,
  ContextAttachmentsView,
  ContextDoc,
  ContextDocContent,
  ContextDocList,
  Repo,
} from "@devdigest/shared";
import agentMessages from "../../../../../../../../messages/en/agents.json";
import contextMessages from "../../../../../../../../messages/en/context.json";
import { RepoProvider } from "@/lib/repo-context";
import { ContextTab } from "./ContextTab";

vi.mock("next/navigation", () => ({ usePathname: () => "/agents/ag1" }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

const repo = (id: string, name: string): Repo => ({
  id,
  workspace_id: "ws1",
  owner: "acme",
  name,
  full_name: `acme/${name}`,
  default_branch: "main",
  clone_path: `/clones/${name}`,
  last_polled_at: null,
  created_by: null,
});

/** r1 is first, so the shell's active repository is r1 with no URL segment. */
const REPOS: Repo[] = [
  repo("r1", "payments-api"),
  repo("r2", "billing-service"),
  repo("r3", "ledger-worker"),
];

const DOCS: ContextDoc[] = [
  { path: "specs/api-contract.md", root: "specs", size_bytes: 2048, token_estimate: 512, used_by_agents: 1 },
  { path: "specs/billing/rules.md", root: "specs", size_bytes: 1024, token_estimate: 256, used_by_agents: 0 },
  { path: "docs/onion-layers.md", root: "docs", size_bytes: 1024, token_estimate: 256, used_by_agents: 2 },
  { path: "insights/ui-notes.md", root: "insights", size_bytes: 512, token_estimate: 128, used_by_agents: 0 },
];

const DOC_LIST: ContextDocList = {
  status: "ok",
  roots: ["specs", "docs", "insights"],
  docs: DOCS,
  omitted: 0,
  scanned_at: "2026-08-13T10:00:00.000Z",
};

/** Carried by an enabled linked skill: rendered, named, and not detachable here. */
const INHERITED: ContextAttachmentRow = {
  path: "docs/onion-layers.md",
  root: "docs",
  size_bytes: 1024,
  token_estimate: 256,
  repo_id: "r1",
  source: "inherited",
  skill_id: "sk1",
  skill_name: "secret-leakage-gate",
  missing: false,
};

/** Attached for another repository: inert, outside every count. The same path is
    attached in two of them — the view keys these rows by repository *and* path,
    so both come back and both must render. */
const ELSEWHERE: ContextAttachmentRow = {
  path: "guides/billing-notes.md",
  root: "guides",
  size_bytes: 0,
  token_estimate: 0,
  repo_id: "r2",
  source: "direct",
  skill_id: null,
  skill_name: null,
  missing: false,
};

const ELSEWHERE_OTHER_REPO: ContextAttachmentRow = { ...ELSEWHERE, repo_id: "r3" };

const START = ["specs/api-contract.md", "specs/gone.md"];

/** The view the server would recompute for a given direct set — counts and token
    total included, so the test never asserts a figure the client invented.

    `version` is the concurrency token (LU). It is the agent's, so it moves on
    every accepted replace, and the stub bumps it exactly there.

    `beyondReadCap` names the direct paths the server ordered past the per-run
    cap (R2): still stored and still rows, but dropped by the run and therefore
    excluded from `token_estimate` — the same arithmetic the server does. */
function viewFor(
  direct: string[],
  { version = "1", beyondReadCap = [] as string[] } = {},
): ContextAttachmentsView {
  const directRows: ContextAttachmentRow[] = direct.map((path) => {
    const found = DOCS.find((d) => d.path === path);
    return {
      path,
      root: found?.root ?? path.split("/")[0]!,
      size_bytes: found?.size_bytes ?? 0,
      token_estimate: found?.token_estimate ?? 0,
      repo_id: "r1",
      source: "direct",
      skill_id: null,
      skill_name: null,
      missing: found === undefined,
      beyond_read_cap: beyondReadCap.includes(path),
    };
  });
  const effective = [...directRows, INHERITED];
  return {
    direct_count: directRows.length,
    effective_count: effective.length,
    discovered_count: DOCS.length,
    token_estimate: effective
      .filter((r) => r.beyond_read_cap !== true)
      .reduce((n, r) => n + r.token_estimate, 0),
    version,
    rows: [...effective, ELSEWHERE, ELSEWHERE_OTHER_REPO],
  };
}

const CONTENT: ContextDocContent = {
  path: "specs/api-contract.md",
  content: "# API contract\n\nThe canonical contract every endpoint answers to.",
  size_bytes: 2048,
  truncated: false,
};

const ok = (json: unknown) =>
  ({ ok: true, status: 200, statusText: "OK", json: async () => json }) as Response;

/** A replace body as it goes on the wire — `expected_version` included (LU). */
interface PutBody {
  repo_id: string;
  paths: string[];
  expected_version?: string;
}

interface Api {
  /** Bodies of every `PUT /agents/ag1/context`, in call order. */
  puts: PutBody[];
  fetch: ReturnType<typeof vi.fn>;
  /** Change what the GET returns, as another client's write would — which also
      moves the concurrency token, exactly as the real write does. */
  setServerDirect: (paths: string[]) => void;
}

/** The whole API surface this tab touches, dispatched by URL. `/context/doc`
    is matched before `/repos/:id/context` — it also contains that prefix.

    `putConflicts` is the LU rejection: the write is refused with a 409 *and* the
    stored state is the one that moved on, so a client that merely dropped its
    optimistic list would still be showing something stale. */
function stubApi({
  putFails = false,
  putConflicts = null,
  beyondReadCap = [] as string[],
}: {
  putFails?: boolean;
  putConflicts?: string[] | null;
  beyondReadCap?: string[];
} = {}): Api {
  const puts: PutBody[] = [];
  let direct = START;
  // The agent's `version`, bumped by every accepted replace and by any other
  // write to the agent — which is what a following replace has to echo back.
  let version = 1;
  const current = () => viewFor(direct, { version: String(version), beyondReadCap });

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "PUT" && u.includes("/agents/ag1/context")) {
      const body = JSON.parse(String(init.body)) as PutBody;
      puts.push(body);
      if (putFails) {
        return {
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          json: async () => ({ error: { message: "replace failed" } }),
        } as Response;
      }
      if (putConflicts) {
        // Whoever won the race already stored their list and moved the token.
        direct = putConflicts;
        version += 1;
        return {
          ok: false,
          status: 409,
          statusText: "Conflict",
          json: async () => ({
            error: {
              code: "conflict",
              message:
                "This context set changed since it was loaded. Reload it and apply the change again.",
            },
          }),
        } as Response;
      }
      direct = body.paths;
      version += 1;
      return ok(current());
    }
    if (u.includes("/context/doc?path=")) return ok(CONTENT);
    if (u.includes("/agents/ag1/context")) return ok(current());
    if (u.includes("/repos/r1/context")) return ok(DOC_LIST);
    if (u.endsWith("/repos")) return ok(REPOS);
    return ok([]);
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    puts,
    fetch: fetchMock,
    setServerDirect: (paths: string[]) => {
      direct = paths;
      version += 1;
    },
  };
}

interface DeferredPut {
  paths: string[];
  /** Land this replace: the stubbed server adopts its list. */
  resolve: () => void;
  reject: () => void;
}

/**
 * Same API, but every PUT hangs until the test settles it and the GET reflects
 * whichever replace landed last — enough to interleave two toggles and see which
 * list a failure reverts to.
 */
function stubDeferredApi(): DeferredPut[] {
  let direct = START;
  let version = 1;
  const puts: DeferredPut[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "PUT" && u.includes("/agents/ag1/context")) {
        const body = JSON.parse(String(init.body));
        return new Promise<Response>((resolve, reject) => {
          puts.push({
            paths: body.paths,
            resolve: () => {
              direct = body.paths;
              version += 1;
              resolve(ok(viewFor(direct, { version: String(version) })));
            },
            reject: () => reject(new Error("network down")),
          });
        });
      }
      if (u.includes("/context/doc?path=")) return Promise.resolve(ok(CONTENT));
      if (u.includes("/agents/ag1/context"))
        return Promise.resolve(ok(viewFor(direct, { version: String(version) })));
      if (u.includes("/repos/r1/context")) return Promise.resolve(ok(DOC_LIST));
      if (u.endsWith("/repos")) return Promise.resolve(ok(REPOS));
      return Promise.resolve(ok([]));
    }),
  );
  return puts;
}

/** `retry: false` — a bare client retries a failure 3× with backoff and the
    error branch never lands inside `waitFor`'s window (client/INSIGHTS.md). */
function renderTab(agent: Agent = AGENT) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: agentMessages, context: contextMessages }}>
        <RepoProvider>
          <ContextTab agent={agent} />
        </RepoProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

const box = (path: string) => screen.getByRole("checkbox", { name: path });

/** Index of a document's row among all rows, read off the checkbox order. */
function order(path: string) {
  return screen.getAllByRole("checkbox").indexOf(box(path));
}

describe("ContextTab", () => {
  it("lists every document with a named checkbox and its root as text, attached rows first, and offers no save control", async () => {
    stubApi();
    renderTab();

    // AC-42/AC-53: one real checkbox per document, named by its path.
    expect(await screen.findByRole("checkbox", { name: "specs/api-contract.md" })).toBeChecked();
    for (const doc of DOCS) expect(box(doc.path)).toBeInTheDocument();
    // One row per (repository, path): the same document is attached in two other
    // repositories, and neither is folded into the other (AC-50).
    expect(screen.getAllByRole("checkbox", { name: "guides/billing-notes.md" })).toHaveLength(2);
    expect(screen.getAllByRole("checkbox")).toHaveLength(7);

    // The root segment is text, never colour alone.
    expect(screen.getAllByText("specs")).toHaveLength(3);
    expect(screen.getByText("insights")).toBeInTheDocument();

    // AC-45: attached above unattached, and only directly attached rows drag.
    expect(order("specs/api-contract.md")).toBeLessThan(order("insights/ui-notes.md"));
    expect(order("docs/onion-layers.md")).toBeLessThan(order("insights/ui-notes.md"));
    expect(order("insights/ui-notes.md")).toBeLessThan(order("specs/billing/rules.md"));
    const handles = screen.getAllByRole("button", { name: /^Reorder / });
    expect(handles.map((h) => h.getAttribute("aria-label"))).toEqual([
      "Reorder specs/api-contract.md",
      "Reorder specs/gone.md",
    ]);

    // AC-43: nothing to press — the list posts itself.
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("posts the complete ordered list the moment a document is attached (AC-43)", async () => {
    const api = stubApi();
    renderTab();

    fireEvent.click(await screen.findByRole("checkbox", { name: "insights/ui-notes.md" }));

    await waitFor(() => expect(api.puts).toHaveLength(1));
    expect(api.puts[0]).toEqual({
      repo_id: "r1",
      paths: ["specs/api-contract.md", "specs/gone.md", "insights/ui-notes.md"],
      // The view this list was computed against (LU).
      expected_version: "1",
    });
    await waitFor(() => expect(box("insights/ui-notes.md")).toBeChecked());
    // The footer follows the server's recomputed total, not a local sum.
    expect(await screen.findByText("≈896 tokens per review")).toBeInTheDocument();
  });

  it("keeps a path discovery no longer lists, marks it missing and still detaches it (AC-51)", async () => {
    const api = stubApi();
    renderTab();

    expect(await screen.findByText("Missing from the clone")).toBeInTheDocument();
    fireEvent.click(box("specs/gone.md"));

    await waitFor(() => expect(api.puts).toHaveLength(1));
    expect(api.puts[0]).toEqual({
      repo_id: "r1",
      paths: ["specs/api-contract.md"],
      expected_version: "1",
    });
  });

  it("restores the previous list and explains itself when the post fails (AC-44)", async () => {
    const api = stubApi({ putFails: true });
    renderTab();

    fireEvent.click(await screen.findByRole("checkbox", { name: "insights/ui-notes.md" }));
    expect(box("insights/ui-notes.md")).toBeChecked();

    await waitFor(() => expect(api.puts).toHaveLength(1));
    expect(
      await screen.findByText("Couldn’t save the attached documents. Nothing was changed."),
    ).toBeInTheDocument();
    expect(box("insights/ui-notes.md")).not.toBeChecked();
    expect(order("specs/api-contract.md")).toBeLessThan(order("insights/ui-notes.md"));
  });

  /* A failed replace changed nothing, so the pre-toggle list *is* the server's
     list and the optimistic one is dropped outright — it is never promoted to
     the source of truth (see the stale-`pending` case below). A replace still in
     flight is not the failure's business either way: it reconciles on its own
     response when it lands (AC-44). */
  it("hands the list back to the server when a replace fails, and still reconciles the one in flight", async () => {
    const puts = stubDeferredApi();
    renderTab();

    fireEvent.click(await screen.findByRole("checkbox", { name: "insights/ui-notes.md" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    fireEvent.click(box("specs/billing/rules.md"));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]?.paths).toEqual([
      "specs/api-contract.md",
      "specs/gone.md",
      "insights/ui-notes.md",
      "specs/billing/rules.md",
    ]);

    await act(async () => {
      puts[1]!.reject();
    });

    expect(
      await screen.findByText("Couldn’t save the attached documents. Nothing was changed."),
    ).toBeInTheDocument();
    expect(box("specs/billing/rules.md")).not.toBeChecked();

    // The first replace lands afterwards and puts its own document back — the
    // failure did not cancel it, and its view is the newest one to arrive.
    await act(async () => {
      puts[0]!.resolve();
    });
    await waitFor(() => expect(box("insights/ui-notes.md")).toBeChecked());
  });

  /* Two toggles ~200ms apart leave two replaces in flight, and their responses
     arrive in completion order. The hook's own `onSuccess` runs for both — only
     the newest response may seed the cache — because query-core does *not*
     filter it by observer the way it filters the per-call callbacks. Without
     that guard the first PUT's view unticks the second document, and since a
     replace is a complete delete-then-insert the next toggle would then delete
     it server-side too. */
  it("keeps both documents attached when a superseded replace answers last", async () => {
    const puts = stubDeferredApi();
    const { qc } = renderTab();
    /* Every reconciled response invalidates the discovery query (AC-59), which
       is what makes "this response has been processed" observable. Without it a
       trailing assertion could pass simply by running before the stale write —
       green for the wrong reason, which is how this defect survived. */
    const spy = vi.spyOn(qc, "invalidateQueries");
    const reconciled = () =>
      spy.mock.calls.filter((c) => c[0]?.queryKey?.[0] === "context-docs").length;

    fireEvent.click(await screen.findByRole("checkbox", { name: "insights/ui-notes.md" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    fireEvent.click(box("specs/billing/rules.md"));
    await waitFor(() => expect(puts).toHaveLength(2));

    // The second replace answers first, and the tab reconciles on its view.
    await act(async () => {
      puts[1]!.resolve();
    });
    await waitFor(() => expect(reconciled()).toBe(1));
    expect(box("specs/billing/rules.md")).toBeChecked();

    // Now the first answers, carrying a view that predates the second toggle.
    await act(async () => {
      puts[0]!.resolve();
    });
    await waitFor(() => expect(reconciled()).toBe(2));
    expect(box("specs/billing/rules.md")).toBeChecked();
    expect(box("insights/ui-notes.md")).toBeChecked();
  });

  /* The optimistic list is *pending*, never authoritative. Left in place after a
     failure it shadows every later refetch, and the next toggle then posts a
     complete replacement built from that stale snapshot — deleting whatever was
     attached in the meantime, from another editor or another person. */
  it("stops shadowing the server after a failed replace, so a later refetch is not lost", async () => {
    const api = stubApi({ putFails: true });
    const { qc } = renderTab();

    fireEvent.click(await screen.findByRole("checkbox", { name: "insights/ui-notes.md" }));
    await waitFor(() => expect(api.puts).toHaveLength(1));
    expect(
      await screen.findByText("Couldn’t save the attached documents. Nothing was changed."),
    ).toBeInTheDocument();
    expect(box("insights/ui-notes.md")).not.toBeChecked();

    // Someone else attaches a document; a window-focus refetch pulls it in.
    api.setServerDirect([...START, "specs/billing/rules.md"]);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["agent-context", "ag1", "r1"] });
    });
    await waitFor(() => expect(box("specs/billing/rules.md")).toBeChecked());

    // The next toggle posts the server's list plus the new path — not a
    // replacement built from the pre-failure snapshot.
    fireEvent.click(box("insights/ui-notes.md"));
    await waitFor(() => expect(api.puts).toHaveLength(2));
    expect(api.puts[1]).toEqual({
      repo_id: "r1",
      paths: [...START, "specs/billing/rules.md", "insights/ui-notes.md"],
      // The refetched view's token, not the one the failed replace carried.
      expected_version: "2",
    });
  });

  /* LU. The token is `agents.version`, and an accepted replace bumps it — so the
     second replace must carry the version the *first PUT's response* returned.
     A client that re-sent the version it loaded the tab with, or read it off a
     cached agent row, would send a token the server has already moved past and
     be told there was a conflict when nothing conflicted. */
  it("sends the version the previous replace returned, not the one the tab loaded with (LU)", async () => {
    const api = stubApi();
    renderTab();

    fireEvent.click(await screen.findByRole("checkbox", { name: "insights/ui-notes.md" }));
    await waitFor(() => expect(api.puts).toHaveLength(1));
    expect(api.puts[0]?.expected_version).toBe("1");

    // The replace landed; the stored state — and the token — has moved.
    await waitFor(() => expect(box("insights/ui-notes.md")).toBeChecked());

    fireEvent.click(box("specs/billing/rules.md"));
    await waitFor(() => expect(api.puts).toHaveLength(2));
    expect(api.puts[1]?.expected_version).toBe("2");
    await waitFor(() => expect(box("specs/billing/rules.md")).toBeChecked());
  });

  /* LU, the rejection. A 409 says the write was refused because the stored state
     moved, so the pre-toggle list the tab falls back to is stale as well: the
     right answer is the server's current state plus a message that says why,
     not the generic "couldn't save" of a 500. */
  it("takes the server's state and says a conflict happened when a replace is refused (LU)", async () => {
    const otherClient = [...START, "specs/billing/rules.md"];
    const api = stubApi({ putConflicts: otherClient });
    const { qc } = renderTab();

    fireEvent.click(await screen.findByRole("checkbox", { name: "insights/ui-notes.md" }));
    expect(box("insights/ui-notes.md")).toBeChecked();
    await waitFor(() => expect(api.puts).toHaveLength(1));

    // Distinct copy: a conflict is not the same event as a failed save.
    expect(
      await screen.findByText(
        "This agent changed somewhere else while you were editing, so nothing was saved. The list below is the current one — make the change again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Couldn’t save the attached documents. Nothing was changed."),
    ).toBeNull();

    // The other client's document is on screen and the user's tick is not —
    // the tab took the server's state rather than reverting to the list it had.
    await waitFor(() => expect(box("specs/billing/rules.md")).toBeChecked());
    expect(box("insights/ui-notes.md")).not.toBeChecked();

    // And that state is what the cache holds, so the next replace is computed
    // from the stored list rather than from the rejected optimistic one.
    const cached = qc.getQueryData<ContextAttachmentsView>(["agent-context", "ag1", "r1"]);
    expect(cached?.rows.filter((r) => r.repo_id === "r1" && r.source === "direct").map((r) => r.path)).toEqual(
      otherClient,
    );
  });

  /* R2. Past the twentieth document the run reads nothing more: the server keeps
     the row, drops it from the token total and flags it. Before this the row was
     indistinguishable from one that is injected on every review. */
  it("marks an attached row the run will not read, past the per-run cap (R2)", async () => {
    stubApi({ beyondReadCap: ["specs/api-contract.md"] });
    renderTab();

    await screen.findByRole("checkbox", { name: "specs/api-contract.md" });
    expect(screen.getByText("Not read: only 20 documents are read per run")).toBeInTheDocument();
    // Exactly the flagged row, and the row is still attached and still listed.
    expect(screen.getAllByText("Not read: only 20 documents are read per run")).toHaveLength(1);
    expect(box("specs/api-contract.md")).toBeChecked();

    // The footer is the server's figure over the rows the run actually reads:
    // 256 (inherited) alone, the capped 512 excluded.
    expect(await screen.findByText("≈256 tokens per review")).toBeInTheDocument();
  });

  it("filters on any part of the repo-relative path, case-insensitively (AC-46)", async () => {
    stubApi();
    renderTab();

    const filter = await screen.findByLabelText("Filter documents…");
    fireEvent.change(filter, { target: { value: "SPECS/" } });

    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.queryByRole("checkbox", { name: "insights/ui-notes.md" })).toBeNull();

    // A folder deeper in the path narrows just as well.
    fireEvent.change(filter, { target: { value: "billing/" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(box("specs/billing/rules.md")).toBeInTheDocument();

    fireEvent.change(filter, { target: { value: "" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(7);
  });

  it("sums the effective set in the footer, marked approximate, and warns about the re-send only where map-reduce can happen (AC-47, AC-48, AC-66)", async () => {
    stubApi();
    const { unmount } = renderTab();

    // 512 (direct) + 0 (missing) + 256 (inherited) — the server's own figure.
    expect(await screen.findByText("≈768 tokens per review")).toBeInTheDocument();
    expect(screen.queryByText(/re-sent once per changed file/)).toBeNull();
    unmount();

    for (const strategy of ["map-reduce", "auto"] as const) {
      stubApi();
      renderTab({ ...AGENT, strategy });
      expect(
        await screen.findByText("In map-reduce the whole block is re-sent once per changed file."),
      ).toBeInTheDocument();
      cleanup();
    }
  });

  it("names the skill an inherited row comes from, links to it and offers no detach control (AC-61…AC-63)", async () => {
    const api = stubApi();
    renderTab();

    const inherited = await screen.findByRole("checkbox", { name: "docs/onion-layers.md" });
    expect(inherited).toBeChecked();
    expect(inherited).toBeDisabled();

    // The source is queryable text, not a colour or a tooltip.
    expect(screen.getByText("secret-leakage-gate")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "secret-leakage-gate" })).toHaveAttribute(
      "href",
      "/skills/sk1",
    );
    expect(screen.queryByRole("button", { name: "Reorder docs/onion-layers.md" })).toBeNull();

    fireEvent.click(inherited);
    expect(api.puts).toHaveLength(0);
  });

  it("badges the effective set against the discovered count, keeps the direct count beside it, and counts a shared path once (AC-64, AC-65, AC-67)", async () => {
    stubApi();
    renderTab();

    expect(await screen.findByText("3 of 4 attached")).toBeInTheDocument();
    expect(screen.getByText("2 attached directly")).toBeInTheDocument();

    // `specs/api-contract.md` is discovered *and* attached: exactly one row, and
    // the badge counts it once — both numbers come from the view, not from a
    // per-row tally that could double it.
    expect(screen.getAllByRole("checkbox", { name: "specs/api-contract.md" })).toHaveLength(1);
  });

  it("renders every attachment from another repository inactive and names that repository (AC-50)", async () => {
    stubApi();
    renderTab();

    await screen.findByRole("checkbox", { name: "specs/api-contract.md" });
    const foreign = screen.getAllByRole("checkbox", { name: "guides/billing-notes.md" });
    expect(foreign).toHaveLength(2);
    for (const row of foreign) expect(row).toBeDisabled();

    // Each names the repository it belongs to, so two rows with the same path
    // are still told apart.
    expect(screen.getByText("billing-service")).toBeInTheDocument();
    expect(screen.getByText("ledger-worker")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reorder guides/billing-notes.md" })).toBeNull();
  });

  it("invalidates the discovery query on a successful attach, so the usage counter moves (AC-59)", async () => {
    const api = stubApi();
    const { qc } = renderTab();
    await screen.findByRole("checkbox", { name: "insights/ui-notes.md" });
    const spy = vi.spyOn(qc, "invalidateQueries");

    fireEvent.click(box("insights/ui-notes.md"));

    await waitFor(() => expect(api.puts).toHaveLength(1));
    await waitFor(() =>
      expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual(["context-docs", "r1"]),
    );
  });

  it("previews a document read-only, without leaving the tab (AC-42)", async () => {
    stubApi();
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Preview specs/api-contract.md" }));

    expect(
      await screen.findByText("The canonical contract every endpoint answers to."),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /edit/i })).toHaveLength(0);
  });
});
