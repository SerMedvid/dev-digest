/* hooks/onboarding.ts — the per-repo onboarding tour.

     GET  /repos/:id/onboarding           → OnboardingView
     POST /repos/:id/onboarding/generate  → 202 + jobId (409 while in flight)

   Generation is a background job on the server, so the query polls while the
   status is `running` — the same shape the conventions screen uses. There is no
   SSE stream for this one: a tour takes a single LLM call, and a 4s poll is
   cheaper than a channel. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OnboardingViewValue } from "@devdigest/shared";
import { api } from "../api";

type Id = string | null | undefined;

const POLL_MS = 4000;

export function useOnboardingTour(repoId: Id) {
  return useQuery({
    queryKey: ["onboarding", repoId],
    queryFn: () => api.get<OnboardingViewValue>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
    // v5 hands the whole query to the callback, not just the data.
    refetchInterval: (query) => (query.state.data?.status === "running" ? POLL_MS : false),
  });
}

export function useGenerateOnboarding(repoId: Id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ status: string; jobId: string }>(`/repos/${repoId}/onboarding/generate`),
    onSuccess: () => {
      // The server has already flipped the row to `running`, so a refetch is
      // what starts the poll.
      void qc.invalidateQueries({ queryKey: ["onboarding", repoId] });
    },
  });
}
