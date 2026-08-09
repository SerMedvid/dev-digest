/* hooks/blast.ts — the PR's blast radius (L04). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadiusResponse, BlastSummaryResponse } from "@devdigest/shared";

/**
 * The blast map. Unlike `usePrIntent` there is no 404-is-empty case: the
 * endpoint always answers 200 for a PR that exists, carrying `status` to say
 * how much of the map it could actually see.
 */
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-blast", prId],
    queryFn: () => api.get<BlastRadiusResponse>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}

/** Explain the map — one model call, on an explicit click. */
export function useBlastSummary(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BlastSummaryResponse>(`/pulls/${prId}/blast/summary`),
    // The POST returns only the summary, so it is patched into the cached map
    // rather than replacing it — refetching the whole map would redo the index
    // reads to learn one field we already have.
    onSuccess: (rec) => {
      qc.setQueryData(["pr-blast", prId], (prev: BlastRadiusResponse | undefined) =>
        prev ? { ...prev, summary: rec.summary } : prev,
      );
    },
  });
}
