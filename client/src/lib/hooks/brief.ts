/* hooks/brief.ts — the PR's composed Why + Risk brief (L05). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { PrBriefRecord } from "@devdigest/shared";

/**
 * The stored brief for the PR's current head, or null when none exists.
 *
 * Mirrors `usePrIntent`: the API 404s both for "no brief at this state" and for
 * an unknown PR, and either way the card's answer is the same empty state with
 * a generate button — not an error banner.
 */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-brief", prId],
    queryFn: async () => {
      try {
        return await api.get<PrBriefRecord>(`/pulls/${prId}/brief`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: !!prId,
  });
}

/**
 * Generate (or regenerate) the brief. One model call, on an explicit click —
 * the POST always regenerates, so nothing calls this on mount.
 */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrBriefRecord>(`/pulls/${prId}/brief`),
    // The POST already returns the freshly generated record, so writing it
    // straight into the cache is sufficient — no follow-up invalidation, which
    // would spend a second request to learn what we are already holding.
    onSuccess: (rec) => {
      qc.setQueryData(["pr-brief", prId], rec);
    },
  });
}
