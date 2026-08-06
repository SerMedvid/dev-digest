/* hooks/intent.ts — the PR's derived intent (L03). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { PrIntentRecord } from "@devdigest/shared";

/** The stored intent, or null when none has been derived (the API 404s). */
export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-intent", prId],
    queryFn: async () => {
      try {
        return await api.get<PrIntentRecord>(`/pulls/${prId}/intent`);
      } catch (err) {
        // "Not derived yet" is an empty state, not an error state.
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: !!prId,
  });
}

/** Derive (or re-derive) the intent for this PR. */
export function useDeriveIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrIntentRecord>(`/pulls/${prId}/intent`),
    // The POST already returns the freshly derived record, so writing it
    // straight into the cache is sufficient — no follow-up invalidation/refetch.
    onSuccess: (rec) => {
      qc.setQueryData(["pr-intent", prId], rec);
    },
  });
}
