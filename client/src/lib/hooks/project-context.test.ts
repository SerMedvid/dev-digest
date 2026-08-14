/* project-context.test.ts — the invalidation contract of the Project Context
   hooks. AC-59 is the `["context-docs", repoId]` entry: attaching a document in
   an editor is what moves the usage counter on the Project Context page without
   a reload, and nothing else makes that happen. The keys are therefore asserted
   literally, in order — a rename here is a silently broken counter. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import type { ContextAttachmentsView } from "@devdigest/shared";
import {
  useContextDoc,
  useContextDocs,
  useSetContextAttachments,
} from "./project-context";

const REPO = "11111111-1111-1111-1111-111111111111";
const OWNER = "22222222-2222-2222-2222-222222222222";

/** The view the server recomputes for a direct set — a skill inherits nothing,
    so direct == effective and no count here is one the test invented. */
function viewOf(paths: string[]): ContextAttachmentsView {
  const rows = paths.map((path) => ({
    path,
    root: path.split("/")[0]!,
    size_bytes: 400,
    token_estimate: 120,
    repo_id: REPO,
    source: "direct" as const,
    skill_id: null,
    skill_name: null,
    missing: false,
  }));
  return {
    direct_count: rows.length,
    effective_count: rows.length,
    discovered_count: 3,
    token_estimate: rows.length * 120,
    rows,
  };
}

const VIEW: ContextAttachmentsView = viewOf(["specs/api.md"]);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubJson(payload: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** `apiFetch` reads `body.error.message`, so this is what carries real text. */
function stubFailure(status = 500, message = "boom") {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: false,
    status,
    statusText: "Internal Server Error",
    json: async () => ({ error: { message } }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** One PUT the test settles by hand, so two replaces can be in flight at once. */
interface DeferredPut {
  paths: string[];
  land: (view: ContextAttachmentsView) => void;
}

/** Every PUT hangs until the test lands it, in whatever order it chooses. */
function stubDeferredPuts(): DeferredPut[] {
  const puts: DeferredPut[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { paths: string[] };
      return new Promise((resolve) => {
        puts.push({
          paths: body.paths,
          land: (view) =>
            resolve({ ok: true, status: 200, statusText: "OK", json: async () => view }),
        });
      });
    }),
  );
  return puts;
}

/** `retry: false` — a bare client retries 3× with backoff and an error-state
    assertion then reads as broken rather than as a failure. */
function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

/** The query keys `invalidateQueries` was called with, in call order. */
function invalidationSpy(qc: QueryClient) {
  return vi.spyOn(qc, "invalidateQueries");
}

function invalidatedKeys(spy: ReturnType<typeof invalidationSpy>) {
  return spy.mock.calls.map((c) => c[0]?.queryKey);
}

describe("useSetContextAttachments", () => {
  it("PUTs the replace body and invalidates the agent's keys — context-docs among them (AC-59)", async () => {
    const fetchMock = stubJson(VIEW);
    const qc = makeClient();
    const spy = invalidationSpy(qc);

    const { result } = renderHook(() => useSetContextAttachments(), {
      wrapper: wrapperFor(qc),
    });

    result.current.mutate({
      ownerKind: "agent",
      ownerId: OWNER,
      repoId: REPO,
      paths: ["specs/api.md"],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const call = fetchMock.mock.calls[0];
    const init = call?.[1];
    expect(String(call?.[0])).toContain(`/agents/${OWNER}/context`);
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({
      repo_id: REPO,
      paths: ["specs/api.md"],
    });

    expect(invalidatedKeys(spy)).toEqual([
      ["agent-context", OWNER, REPO],
      ["context-docs", REPO],
      ["agent", OWNER],
      ["agents"],
    ]);
  });

  it("invalidates the preview instead of the agent row when the owner is a skill", async () => {
    const fetchMock = stubJson(VIEW);
    const qc = makeClient();
    const spy = invalidationSpy(qc);

    const { result } = renderHook(() => useSetContextAttachments(), {
      wrapper: wrapperFor(qc),
    });

    result.current.mutate({
      ownerKind: "skill",
      ownerId: OWNER,
      repoId: REPO,
      paths: [],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/skills/${OWNER}/context`);
    expect(invalidatedKeys(spy)).toEqual([
      ["skill-context", OWNER, REPO],
      ["context-docs", REPO],
      ["skill-context-preview", OWNER, REPO],
    ]);
  });

  it("writes the returned view into the owner's cache, so the tab reconciles in one round trip", async () => {
    stubJson(VIEW);
    const qc = makeClient();

    const { result } = renderHook(() => useSetContextAttachments(), {
      wrapper: wrapperFor(qc),
    });

    result.current.mutate({
      ownerKind: "agent",
      ownerId: OWNER,
      repoId: REPO,
      paths: ["specs/api.md"],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(["agent-context", OWNER, REPO])).toEqual(VIEW);
  });

  /* Nothing else in this suite overlaps two replaces, which is how a
     documented-but-false library guarantee survived review once: calling
     `mutate` again does discard the superseded call's **per-call** callbacks,
     but the ones declared on `useMutation` are the Mutation's own and
     `@tanstack/query-core` awaits them unconditionally. Tick one document, tick
     a second ~200ms later, and two PUTs are in flight; the responses arrive in
     completion order, not issue order. */
  it("keeps the newest replace's view when a superseded PUT answers last", async () => {
    const puts = stubDeferredPuts();
    const qc = makeClient();
    const spy = invalidationSpy(qc);

    const { result } = renderHook(() => useSetContextAttachments(), {
      wrapper: wrapperFor(qc),
    });

    const ownerKey = ["agent-context", OWNER, REPO];
    const first = viewOf(["specs/api.md"]);
    const second = viewOf(["specs/api.md", "docs/onion-layers.md"]);

    act(() => {
      result.current.mutate({
        ownerKind: "agent",
        ownerId: OWNER,
        repoId: REPO,
        paths: first.rows.map((r) => r.path),
      });
    });
    await waitFor(() => expect(puts).toHaveLength(1));

    act(() => {
      result.current.mutate({
        ownerKind: "agent",
        ownerId: OWNER,
        repoId: REPO,
        paths: second.rows.map((r) => r.path),
      });
    });
    await waitFor(() => expect(puts).toHaveLength(2));

    // The second replace answers first, so the cache holds the two-document set.
    await act(async () => puts[1]!.land(second));
    await waitFor(() => expect(qc.getQueryData(ownerKey)).toEqual(second));

    // Now the first one answers. Its view predates the second toggle: writing it
    // would untick `docs/onion-layers.md` in a UI whose next replace then posts
    // a complete list without it, deleting it server-side.
    await act(async () => puts[0]!.land(first));

    // Proof the superseded response really was processed and not merely slow:
    // its invalidations fire either way — only the cache write is dropped.
    await waitFor(() =>
      expect(invalidatedKeys(spy).filter((key) => key?.[0] === "context-docs")).toHaveLength(2),
    );
    expect(qc.getQueryData(ownerKey)).toEqual(second);
  });

  it("surfaces the API's message when the replace fails", async () => {
    stubFailure(404, "Agent not found");
    const qc = makeClient();

    const { result } = renderHook(() => useSetContextAttachments(), {
      wrapper: wrapperFor(qc),
    });

    result.current.mutate({
      ownerKind: "agent",
      ownerId: OWNER,
      repoId: REPO,
      paths: [],
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 404, message: "Agent not found" });
  });
});

describe("useContextDocs / useContextDoc", () => {
  it("does not fetch a document until both the repo and the path are known", async () => {
    const fetchMock = stubJson(VIEW);
    const qc = makeClient();

    renderHook(() => useContextDoc(REPO, null), { wrapper: wrapperFor(qc) });
    expect(fetchMock).not.toHaveBeenCalled();

    const { result } = renderHook(() => useContextDoc(REPO, "specs/deep dir/api.md"), {
      wrapper: wrapperFor(qc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The path is a query parameter and must survive spaces and slashes intact.
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/repos/${REPO}/context/doc?path=specs%2Fdeep%20dir%2Fapi.md`,
    );
  });

  it("exposes the discovery failure rather than retrying it away", async () => {
    stubFailure(500, "clone unreadable");
    const qc = makeClient();

    const { result } = renderHook(() => useContextDocs(REPO), { wrapper: wrapperFor(qc) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: "clone unreadable" });
  });
});
