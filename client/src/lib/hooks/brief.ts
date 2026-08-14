/* hooks/brief.ts — the PR's composed Why + Risk brief (L05). */
"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { PrBriefRecord } from "@devdigest/shared";

/** How often the 409 watch asks whether the other generation has landed. */
export const CONFLICT_POLL_MS = 3_000;
/**
 * When the watch stops waiting. Past the server's own ceiling for one
 * generation — `withRetry` allows 4 model attempts at a 60s `withTimeout` each
 * — so giving up here means the other generation failed, not that it is slow.
 */
export const CONFLICT_GIVE_UP_MS = 300_000;

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
  const mutation = useMutation({
    mutationFn: () => api.post<PrBriefRecord>(`/pulls/${prId}/brief`),
    // The POST already returns the freshly generated record, so writing it
    // straight into the cache is sufficient — no follow-up invalidation, which
    // would spend a second request to learn what we are already holding.
    onSuccess: (rec) => {
      qc.setQueryData(["pr-brief", prId], rec);
    },
    onError: (err) => {
      // A 409 does not mean the click failed — it means a generation for this
      // PR is already in flight and will land a fresh row. Refetch so the user
      // ends up with that result rather than sitting on the stale brief they
      // were just told to regenerate.
      if (err instanceof ApiError && err.status === 409) {
        void qc.invalidateQueries({ queryKey: ["pr-brief", prId] });
      }
    },
  });

  const conflicted =
    mutation.isError && mutation.error instanceof ApiError && mutation.error.status === 409;
  const reset = mutation.reset;

  // The refetch above races the generation it is waiting for: the other call is
  // still running, so it returns the same 404, and nothing refetches again —
  // `staleTime` is 30s and `refetchOnWindowFocus` is off. The card then holds a
  // conflict state that only a reload could clear, with the brief already
  // stored. So watch until the winning generation lands, and stop either way:
  // one that FAILS never lands a row, and waiting on it forever is the same
  // stuck control by another route.
  React.useEffect(() => {
    if (!conflicted || !prId) return;
    const queryKey = ["pr-brief", prId];
    const readAt = () => qc.getQueryData<PrBriefRecord | null>(queryKey)?.created_at ?? null;
    // The generation in flight is newer than whatever is cached now, so a
    // changed `created_at` is what "it landed" means — including the first one
    // for a PR that had no brief at all.
    const startedAt = readAt();
    let stopped = false;

    function finish() {
      if (stopped) return;
      stopped = true;
      clearInterval(poll);
      clearTimeout(giveUp);
      // Clearing the mutation is what re-enables the control and drops the
      // message, so neither outlives the condition it describes.
      reset();
    }

    function tick() {
      void qc.refetchQueries({ queryKey }).then(() => {
        const now = readAt();
        if (now && now !== startedAt) finish();
      });
    }

    const poll = setInterval(tick, CONFLICT_POLL_MS);
    const giveUp = setTimeout(finish, CONFLICT_GIVE_UP_MS);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [conflicted, prId, qc, reset]);

  return mutation;
}
