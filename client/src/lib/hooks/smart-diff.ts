/* hooks/smart-diff.ts — the PR's Smart Diff (grouped files + split suggestion)
   and on-demand per-file pseudocode summaries. Mirrors hooks/intent.ts. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { SmartDiff, PrFileSummaryRecord } from "@devdigest/shared";

/** The PR's Smart Diff: files grouped by role, marked with findings. */
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}

/** Derive (or serve the cached) on-demand summary for one file. Provider
    failures propagate — the summary endpoint degrades nothing, so callers
    must surface the error rather than swallow it. */
export function useFileSummary(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      api.post<PrFileSummaryRecord>(`/pulls/${prId}/smart-diff/summary`, { path }),
    // Patch the one file's `pseudocode_summary` into the cached SmartDiff
    // instead of invalidating — a full refetch would re-run grouping/marks
    // for every file just to pick up one string. Leaves every other file, and
    // a not-yet-fetched cache, untouched.
    onSuccess: (rec) => {
      qc.setQueryData<SmartDiff | undefined>(["pr-smart-diff", prId], (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          groups: prev.groups.map((g) => ({
            ...g,
            files: g.files.map((f) =>
              f.path === rec.path ? { ...f, pseudocode_summary: rec.summary } : f
            ),
          })),
        };
      });
    },
  });
}
