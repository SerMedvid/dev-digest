/* brief.test.ts — the 409 watch.
 *
 * A 409 means someone else's generation is in flight, and the card renders that
 * as a busy control rather than a failure. Nothing else on the page refetches
 * the brief (`staleTime: 30_000`, no `refetchOnWindowFocus`), so if the hook
 * does not watch for the winning generation, the card sits at "Generating…"
 * with a brief already stored on the server — which is what shipped, and it
 * only cleared on a full page reload. Both tests below are about that: the
 * watch lands the result, and the watch ends. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import type { PrBriefRecord } from "@devdigest/shared";
import { usePrBrief, useGenerateBrief, CONFLICT_POLL_MS, CONFLICT_GIVE_UP_MS } from "./brief";

const PR = "pr1";

function briefAt(createdAt: string): PrBriefRecord {
  return {
    what: "Adds token-bucket rate limiting.",
    why: "Unauthenticated clients can hammer the public endpoints.",
    risk_level: "medium",
    risks: [],
    review_focus: [],
    pr_id: PR,
    head_sha: "a1b2c3",
    review_id: "review-2",
    stale: false,
    sources: ["pr"],
    est_tokens_in: 100,
    provider: "openai",
    model: "gpt-4.1",
    created_at: createdAt,
  };
}

/** What `GET /pulls/:id/brief` serves right now; the test moves it. */
let served: PrBriefRecord | null = null;

/** GET serves `served` (404 when null); POST always conflicts. */
function stubApi() {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "POST") {
      return {
        ok: false,
        status: 409,
        statusText: "Conflict",
        json: async () => ({
          error: { code: "conflict", message: "A brief is already being generated" },
        }),
      };
    }
    if (!served) {
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ error: { code: "not_found", message: "No brief" } }),
      };
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => served };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderBriefHooks(qc: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => ({ brief: usePrBrief(PR), generate: useGenerateBrief(PR) }), {
    wrapper,
  });
}

beforeEach(() => {
  served = null;
  // `shouldAdvanceTime` keeps RTL's own `waitFor` polling — it detects Jest's
  // fake timers, not Vitest's, so frozen timers hang it rather than failing it.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
});

describe("useGenerateBrief — the 409 watch", () => {
  it("polls until the in-flight generation lands, then clears the conflict", async () => {
    stubApi();
    const { result } = renderBriefHooks(makeClient());
    await waitFor(() => expect(result.current.brief.isSuccess).toBe(true));
    expect(result.current.brief.data).toBeNull();

    await act(async () => {
      result.current.generate.mutate();
    });
    await waitFor(() => expect(result.current.generate.isError).toBe(true));

    // The other generation lands on the server. Nothing tells the client.
    served = briefAt("2026-08-14T01:00:00.000Z");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFLICT_POLL_MS);
    });

    expect(result.current.brief.data?.created_at).toBe("2026-08-14T01:00:00.000Z");
    // The condition is over, so the message and the busy control must go with it.
    expect(result.current.generate.isError).toBe(false);
  });

  it("gives up at the bound so the control cannot stay busy forever", async () => {
    const fetchMock = stubApi();
    const { result } = renderBriefHooks(makeClient());
    await waitFor(() => expect(result.current.brief.isSuccess).toBe(true));

    await act(async () => {
      result.current.generate.mutate();
    });
    await waitFor(() => expect(result.current.generate.isError).toBe(true));

    // A generation that FAILS never lands a row. Polling for it forever leaves
    // the button disabled forever — the exact deadlock this watch exists to end.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFLICT_GIVE_UP_MS + CONFLICT_POLL_MS);
    });
    expect(result.current.generate.isError).toBe(false);

    const after = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFLICT_POLL_MS * 3);
    });
    expect(fetchMock.mock.calls.length).toBe(after);
  });
});
