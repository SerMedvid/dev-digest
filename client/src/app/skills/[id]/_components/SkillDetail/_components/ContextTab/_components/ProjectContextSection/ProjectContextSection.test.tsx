/* ProjectContextSection — the skill editor's project-context surface.

   Everything is queried by accessible name or by visible text: the rows carry no
   test ids, and a checkbox a screen reader cannot name is one of the defects this
   file exists to catch (AC-42).

   Two traps this file is deliberately shaped around:

   - **The section needs `RepoProvider`.** Without it `useActiveRepo()` returns
     `repoId: null` — the default context value, no throw — every query is
     disabled and the section renders only the `noRepo` notice. A suite written
     without the provider is green and asserts nothing, so every case below
     asserts something that cannot exist in that branch, and the first one asserts
     the notice's absence outright.
   - **URL dispatch order.** `/skills/sk1/context/preview` contains
     `/skills/sk1/context`, and `/repos/r1/context/doc?path=` contains
     `/repos/r1/context`; the longer match has to be tested first, and the PUT
     before all of them. */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ContextAttachmentRow,
  ContextAttachmentsView,
  ContextDoc,
  ContextDocContent,
  ContextDocList,
  ContextPreview,
  Repo,
  Skill,
} from "@devdigest/shared";
import skillMessages from "../../../../../../../../../../messages/en/skills.json";
import contextMessages from "../../../../../../../../../../messages/en/context.json";
import { RepoProvider } from "@/lib/repo-context";
import { ProjectContextSection } from "./ProjectContextSection";

vi.mock("next/navigation", () => ({ usePathname: () => "/skills/sk1" }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SKILL: Skill = {
  id: "sk1",
  name: "secret-leakage-gate",
  description: "Flags secrets in a diff",
  type: "rubric",
  source: "manual",
  body: "# Secret leakage",
  enabled: true,
  version: 3,
  evidence_files: null,
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

/** r1 is first, so with no `/repos/:id` URL segment the active repository is r1. */
const REPOS: Repo[] = [
  repo("r1", "payments-api"),
  repo("r2", "billing-service"),
  repo("r3", "ledger-worker"),
];

const DOCS: ContextDoc[] = [
  { path: "specs/api-contract.md", root: "specs", size_bytes: 2048, token_estimate: 512, used_by_agents: 1 },
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

/** Attached for another repository: read by no run scoped to r1, outside every
    count here, and still shown as an inert row naming its repository (AC-50).
    The same path is attached in two of them — the view keys these rows by
    repository *and* path, so both come back and both must render. */
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

/** `specs/gone.md` is attached but absent from discovery — the AC-51 row. */
const START = ["specs/api-contract.md", "specs/gone.md"];

/** The view the server would recompute for a given direct set, so no count in a
    test is one the client invented. A skill inherits nothing: direct == effective.

    `version` is the concurrency token (LU) — for a skill, a fingerprint of the
    stored set, so it moves on exactly the writes that change it.

    `beyondReadCap` names the paths the server ordered past the per-run cap (R2):
    stored and listed, dropped by the run, and outside `token_estimate`. */
function viewFor(
  direct: string[],
  { version = "1", beyondReadCap = [] as string[] } = {},
): ContextAttachmentsView {
  const rows: ContextAttachmentRow[] = direct.map((path) => {
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
  return {
    direct_count: rows.length,
    effective_count: rows.length,
    discovered_count: DOCS.length,
    token_estimate: rows
      .filter((r) => r.beyond_read_cap !== true)
      .reduce((n, r) => n + r.token_estimate, 0),
    version,
    rows: [...rows, ELSEWHERE, ELSEWHERE_OTHER_REPO],
  };
}

/** Exactly the bytes `assemblePrompt` emits for the `specs` slot (AC-49). */
const PREVIEW: ContextPreview = {
  block:
    '## Project context\n\n<untrusted source="spec-0">\n# API contract\n\nThe canonical contract.\n</untrusted>',
  unread: ["specs/gone.md — not read: not found in the repository clone"],
};

const CONTENT: ContextDocContent = {
  path: "specs/api-contract.md",
  content: "# API contract\n\nThe canonical contract every endpoint answers to.",
  size_bytes: 2048,
  truncated: false,
};

const ok = (json: unknown) =>
  ({ ok: true, status: 200, statusText: "OK", json: async () => json }) as Response;

interface Api {
  /** Bodies of every `PUT /skills/sk1/context`, in call order. */
  puts: { repo_id: string; paths: string[] }[];
  /** Change what the GET returns, as another client's write would. */
  setServerDirect: (paths: string[]) => void;
}

function stubApi({ putFails = false }: { putFails?: boolean } = {}): Api {
  const puts: { repo_id: string; paths: string[] }[] = [];
  let direct = START;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "PUT" && u.includes("/skills/sk1/context")) {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        if (putFails) {
          return {
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
            json: async () => ({ error: { message: "replace failed" } }),
          } as Response;
        }
        direct = body.paths;
        return ok(viewFor(direct));
      }
      if (u.includes("/context/doc?path=")) return ok(CONTENT);
      if (u.includes("/skills/sk1/context/preview")) return ok(PREVIEW);
      if (u.includes("/skills/sk1/context")) return ok(viewFor(direct));
      if (u.includes("/repos/r1/context")) return ok(DOC_LIST);
      if (u.endsWith("/repos")) return ok(REPOS);
      return ok([]);
    }),
  );

  return {
    puts,
    setServerDirect: (paths: string[]) => {
      direct = paths;
    },
  };
}

interface DeferredPut {
  paths: string[];
  /** Land this replace: the stubbed server adopts its list. */
  resolve: () => void;
}

/**
 * Same API, but every PUT hangs until the test settles it and the GET reflects
 * whichever replace landed last — enough to interleave two toggles and see which
 * response the section reconciles on.
 */
function stubDeferredApi(): DeferredPut[] {
  let direct = START;
  const puts: DeferredPut[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "PUT" && u.includes("/skills/sk1/context")) {
        const body = JSON.parse(String(init.body));
        return new Promise<Response>((resolve) => {
          puts.push({
            paths: body.paths,
            resolve: () => {
              direct = body.paths;
              resolve(ok(viewFor(direct)));
            },
          });
        });
      }
      if (u.includes("/context/doc?path=")) return Promise.resolve(ok(CONTENT));
      if (u.includes("/skills/sk1/context/preview")) return Promise.resolve(ok(PREVIEW));
      if (u.includes("/skills/sk1/context")) return Promise.resolve(ok(viewFor(direct)));
      if (u.includes("/repos/r1/context")) return Promise.resolve(ok(DOC_LIST));
      if (u.endsWith("/repos")) return Promise.resolve(ok(REPOS));
      return Promise.resolve(ok([]));
    }),
  );
  return puts;
}

/** `retry: false` — a bare client retries a stubbed failure 3× with backoff and
    the error branch never lands inside `waitFor`'s window (client/INSIGHTS.md). */
function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ skills: skillMessages, context: contextMessages }}
      >
        <RepoProvider>
          <ProjectContextSection skill={SKILL} />
        </RepoProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

const box = (path: string) => screen.getByRole("checkbox", { name: path });

/** The row element around a document, for assertions that would otherwise match
    another row's chip (the root chip is a sibling of the path's label). */
const rowOf = (path: string) => box(path).closest("div")!;

/** Position of a document's row in the list, read off the checkbox order. */
const order = (path: string) => screen.getAllByRole("checkbox").indexOf(box(path));

describe("ProjectContextSection", () => {
  it("lists every document as a named checkbox with its path, root and preview control, and offers no save control (AC-42)", async () => {
    stubApi();
    renderSection();

    // If the section had fallen back to its no-repository branch there would be
    // no checkbox at all — this is the guard against a vacuously green suite.
    expect(await screen.findByRole("checkbox", { name: "specs/api-contract.md" })).toBeChecked();
    expect(
      screen.queryByText("Pick a repository in the top bar to attach its documents."),
    ).toBeNull();

    for (const doc of DOCS) expect(box(doc.path)).toBeInTheDocument();
    expect(box("specs/gone.md")).toBeInTheDocument();

    // Another repository's attachment is outside every count but is still a row
    // — one per (repository, path), so the two are not folded together (AC-50).
    expect(screen.getAllByRole("checkbox", { name: "guides/billing-notes.md" })).toHaveLength(2);
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);

    // The root rides in a chip whose *text* carries it, scoped to its own row so
    // the assertion cannot be satisfied by the path text beside it.
    expect(within(rowOf("docs/onion-layers.md")).getByText("docs")).toBeInTheDocument();
    expect(within(rowOf("insights/ui-notes.md")).getByText("insights")).toBeInTheDocument();

    // Attached rows keep their stored order, above the merely discovered ones.
    expect(order("specs/api-contract.md")).toBe(0);
    expect(order("specs/gone.md")).toBe(1);
    expect(order("docs/onion-layers.md")).toBeGreaterThan(order("specs/gone.md"));

    expect(screen.getByRole("button", { name: "Preview specs/api-contract.md" })).toBeInTheDocument();
    expect(screen.getByText("2 of 3 attached")).toBeInTheDocument();

    // AC-43: nothing to press — the list posts itself. Only valid because the
    // section is rendered standalone; through ConfigTab the skill's Save is here.
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("previews a document read-only without leaving the tab (AC-42)", async () => {
    stubApi();
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "Preview specs/api-contract.md" }));

    expect(
      await screen.findByText("The canonical contract every endpoint answers to."),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /edit/i })).toHaveLength(0);
    // Still on the section behind the modal.
    expect(box("specs/api-contract.md")).toBeChecked();
  });

  it("posts the complete ordered list the moment a document is toggled (AC-43)", async () => {
    const api = stubApi();
    renderSection();

    fireEvent.click(await screen.findByRole("checkbox", { name: "insights/ui-notes.md" }));

    await waitFor(() => expect(api.puts).toHaveLength(1));
    expect(api.puts[0]).toEqual({
      repo_id: "r1",
      paths: ["specs/api-contract.md", "specs/gone.md", "insights/ui-notes.md"],
      // The concurrency token the client believed it was replacing (LU) — the
      // stub's default view version. Asserted as part of the whole body on
      // purpose: `expected_version` going missing is exactly the regression that
      // reopens the lost update, and a `toMatchObject` here would not notice.
      expected_version: "1",
    });
    await waitFor(() => expect(box("insights/ui-notes.md")).toBeChecked());
    expect(await screen.findByText("3 of 3 attached")).toBeInTheDocument();
  });

  it("restores the previous list and explains itself when the post fails (AC-44)", async () => {
    const api = stubApi({ putFails: true });
    renderSection();

    fireEvent.click(await screen.findByRole("checkbox", { name: "insights/ui-notes.md" }));
    // Optimistic: checked before the replace has landed.
    expect(box("insights/ui-notes.md")).toBeChecked();

    await waitFor(() => expect(api.puts).toHaveLength(1));
    expect(
      await screen.findByText("Couldn’t save the attached documents. Nothing was changed."),
    ).toBeInTheDocument();
    expect(box("insights/ui-notes.md")).not.toBeChecked();
    expect(box("specs/api-contract.md")).toBeChecked();
  });

  it("renders every attachment from another repository inactive and names that repository (AC-50)", async () => {
    const api = stubApi();
    renderSection();

    await screen.findByRole("checkbox", { name: "specs/api-contract.md" });
    const foreign = screen.getAllByRole("checkbox", { name: "guides/billing-notes.md" });
    expect(foreign).toHaveLength(2);

    // Inert: checked, because it *is* attached — just not here — and disabled,
    // because a write scoped to this repository cannot detach it.
    for (const row of foreign) {
      expect(row).toBeChecked();
      expect(row).toBeDisabled();
    }
    fireEvent.click(foreign[0]!);
    expect(api.puts).toHaveLength(0);

    // Each names the repository it belongs to, so two rows with the same path
    // are still told apart. There is nothing to preview: the document lives in a
    // clone this editor is not looking at.
    expect(screen.getByText("billing-service")).toBeInTheDocument();
    expect(screen.getByText("ledger-worker")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview guides/billing-notes.md" })).toBeNull();
  });

  it("filters on any part of the repo-relative path, case-insensitively (AC-46)", async () => {
    stubApi();
    renderSection();

    await screen.findByRole("checkbox", { name: "specs/api-contract.md" });
    const filter = screen.getByLabelText("Filter documents…");

    fireEvent.change(filter, { target: { value: "SPECS/" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.queryByRole("checkbox", { name: "insights/ui-notes.md" })).toBeNull();

    // A filename narrows the same way a folder does.
    fireEvent.change(filter, { target: { value: "onion" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(box("docs/onion-layers.md")).toBeInTheDocument();

    fireEvent.change(filter, { target: { value: "" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
  });

  /* Two toggles ~200ms apart leave two replaces in flight, and their responses
     arrive in completion order. Only the newest may seed the cache: query-core
     runs the hook's own `onSuccess` for both, so without the guard the first
     PUT's view unticks the second document, and the next toggle — a complete
     delete-then-insert — would delete it server-side too. */
  it("keeps both documents attached when a superseded replace answers last", async () => {
    const puts = stubDeferredApi();
    const { qc } = renderSection();
    /* Every reconciled response invalidates the discovery query (AC-59), which
       is what makes "this response has been processed" observable. Without it a
       trailing assertion could pass simply by running before the stale write —
       green for the wrong reason, which is how this defect survived. */
    const spy = vi.spyOn(qc, "invalidateQueries");
    const reconciled = () =>
      spy.mock.calls.filter((c) => c[0]?.queryKey?.[0] === "context-docs").length;

    fireEvent.click(await screen.findByRole("checkbox", { name: "insights/ui-notes.md" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    fireEvent.click(box("docs/onion-layers.md"));
    await waitFor(() => expect(puts).toHaveLength(2));

    // The second replace answers first, and the section reconciles on its view.
    await act(async () => {
      puts[1]!.resolve();
    });
    await waitFor(() => expect(reconciled()).toBe(1));
    expect(box("docs/onion-layers.md")).toBeChecked();

    // Now the first answers, carrying a view that predates the second toggle.
    await act(async () => {
      puts[0]!.resolve();
    });
    await waitFor(() => expect(reconciled()).toBe(2));
    expect(box("docs/onion-layers.md")).toBeChecked();
    expect(box("insights/ui-notes.md")).toBeChecked();
  });

  /* The optimistic list is *pending*, never authoritative. Left in place after a
     failure it shadows every later refetch, and the next toggle then posts a
     complete replacement built from that stale snapshot — deleting whatever was
     attached in the meantime, from the agent editor or by someone else. */
  it("stops shadowing the server after a failed replace, so a later refetch is not lost", async () => {
    const api = stubApi({ putFails: true });
    const { qc } = renderSection();

    fireEvent.click(await screen.findByRole("checkbox", { name: "insights/ui-notes.md" }));
    await waitFor(() => expect(api.puts).toHaveLength(1));
    expect(
      await screen.findByText("Couldn’t save the attached documents. Nothing was changed."),
    ).toBeInTheDocument();
    expect(box("insights/ui-notes.md")).not.toBeChecked();

    // Someone else attaches a document; a window-focus refetch pulls it in.
    api.setServerDirect([...START, "docs/onion-layers.md"]);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["skill-context", "sk1", "r1"] });
    });
    await waitFor(() => expect(box("docs/onion-layers.md")).toBeChecked());

    // The next toggle posts the server's list plus the new path — not a
    // replacement built from the pre-failure snapshot.
    fireEvent.click(box("insights/ui-notes.md"));
    await waitFor(() => expect(api.puts).toHaveLength(2));
    expect(api.puts[1]).toEqual({
      repo_id: "r1",
      paths: [...START, "docs/onion-layers.md", "insights/ui-notes.md"],
      expected_version: "1",
    });
  });

  it("shows the block a run would send, verbatim, heading and untrusted wrapper included (AC-49)", async () => {
    stubApi();
    renderSection();

    // One text node, so the heading finds the element and the wrapper is asserted
    // on the same one; `getByText` on the whole multi-line string would not match
    // under the default normaliser.
    const block = await screen.findByText(/## Project context/);
    expect(block).toHaveTextContent('<untrusted source="spec-0">');
    expect(block).toHaveTextContent("</untrusted>");

    // The comp's heading is not what any run sends, and must not appear.
    expect(screen.queryByText(/## Project specifications/)).toBeNull();

    expect(screen.getByText("SERIALIZES AS")).toBeInTheDocument();
    // Attachments the run would skip are named rather than silently dropped.
    expect(
      screen.getByText("specs/gone.md — not read: not found in the repository clone"),
    ).toBeInTheDocument();
  });

  it("keeps a path discovery no longer lists, marks it missing, drops only its preview, and still detaches it (AC-51)", async () => {
    const api = stubApi();
    renderSection();

    expect(await screen.findByText("Missing from the clone")).toBeInTheDocument();

    // The row loses its preview control — there is nothing on disk to preview —
    // but *not* its checkbox, which is the only way back out of the set.
    expect(screen.queryByRole("button", { name: "Preview specs/gone.md" })).toBeNull();
    const missing = box("specs/gone.md");
    expect(missing).toBeEnabled();
    expect(missing).toBeChecked();

    fireEvent.click(missing);

    await waitFor(() => expect(api.puts).toHaveLength(1));
    expect(api.puts[0]).toEqual({
      repo_id: "r1",
      paths: ["specs/api-contract.md"],
      expected_version: "1",
    });
    await waitFor(() => expect(screen.queryByText("Missing from the clone")).toBeNull());
  });

  /* Drag. The section shipped without any — it was written as a block inside
     the Config form, while the agent's Context tab (the same rows, the same
     stored order) had it from the start. Order is a real edit here: it is the
     order a run assembles the documents in, so the rows that carry a stored
     position must be movable.

     Only *this repository's attached* rows have one. An unattached document has
     no position until it is attached, and a cross-repository row is not part of
     this repository's stored order at all — a handle on either would offer a
     move that no replace could express. */
  it("gives a drag handle to this repository's attached rows and to nothing else", async () => {
    stubApi();
    renderSection();

    await screen.findByRole("checkbox", { name: "specs/api-contract.md" });

    const handles = screen.getAllByRole("button", { name: /^Reorder / });
    expect(handles.map((h) => h.getAttribute("aria-label"))).toEqual([
      "Reorder specs/api-contract.md",
      "Reorder specs/gone.md",
    ]);

    // Discovered but unattached.
    expect(screen.queryByRole("button", { name: "Reorder insights/ui-notes.md" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reorder docs/onion-layers.md" })).toBeNull();
    // Attached, but against another repository (AC-50).
    expect(screen.queryByRole("button", { name: "Reorder guides/billing-notes.md" })).toBeNull();
  });
});
