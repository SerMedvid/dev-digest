/* hooks/conventions.ts — React Query hooks for the Conventions screen.
   The scan is asynchronous server-side, so the view query polls while it is in
   flight and stops the moment it settles. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionScan,
  ConventionSkillDraft,
  ConventionsView,
  Skill,
  SkillType,
} from "@devdigest/shared";

export const CONVENTIONS_POLL_MS = 2500;

/** Whether the server is still working on this repo's scan. */
export function isScanInFlight(scan: ConventionScan | null | undefined): boolean {
  return scan?.status === "queued" || scan?.status === "running";
}

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionsView>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
    // A settled scan never changes on its own — polling it forever would be
    // pure noise, so the interval is conditional on the data we already have.
    refetchInterval: (query) =>
      isScanInFlight(query.state.data?.scan) ? CONVENTIONS_POLL_MS : false,
  });
}

export function useExtractConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<{ status: string; jobId: string }>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (_data, repoId) => {
      // Refetch immediately so the queued status (and the poll it starts) lands
      // without waiting for the next interval.
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export interface ConventionPatch {
  status?: ConventionCandidate["status"];
  rule?: string;
  evidence_path?: string;
  evidence_line?: number;
  evidence_snippet?: string;
}

export function usePatchConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { repoId: string; id: string; patch: ConventionPatch }) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: (_data, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
      qc.invalidateQueries({ queryKey: ["convention-skill-draft", repoId] });
    },
  });
}

/** The merged body for the modal. 409s until something is accepted, so it is
    only fetched when the modal is open. */
export function useConventionSkillDraft(repoId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["convention-skill-draft", repoId],
    queryFn: () => api.get<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill-draft`),
    enabled: !!repoId && enabled,
    staleTime: 0,
  });
}

export interface CreateConventionSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
  agent_id?: string;
}

export function useCreateConventionSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, input }: { repoId: string; input: CreateConventionSkillInput }) =>
      api.post<Skill>(`/repos/${repoId}/conventions/skill`, input),
    onSuccess: () => {
      // The new skill shows up in the library, and linking bumped an agent.
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
