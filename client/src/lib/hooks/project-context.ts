/* hooks/project-context.ts — React Query hooks over the project-context API:
   the documents discovered under a repository's configured context roots, and
   which of them an agent or a skill reads on a review run.

   Endpoints (all snake_case on the wire, all workspace-scoped server-side; a
   non-uuid id is a 422 and another workspace's id a 404, never a 403):

     GET  /repos/:repoId/context              → ContextDocList
     GET  /repos/:repoId/context/doc?path=    → ContextDocContent
     GET  /agents/:agentId/context?repoId=    → ContextAttachmentsView
     PUT  /agents/:agentId/context            → ContextAttachmentsView
     GET  /skills/:skillId/context?repoId=    → ContextAttachmentsView
     PUT  /skills/:skillId/context            → ContextAttachmentsView
     GET  /skills/:skillId/context/preview    → ContextPreview
*/
"use client";

import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ContextAttachmentsUpdate,
  ContextAttachmentsView,
  ContextDocContent,
  ContextDocList,
  ContextPreview,
} from "@devdigest/shared";

type Id = string | null | undefined;

/** Everything discovered in one repository's clone, plus the per-doc usage count. */
export function useContextDocs(repoId: Id) {
  return useQuery({
    queryKey: ["context-docs", repoId],
    queryFn: () => api.get<ContextDocList>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

/** One document's (capped) text. Idle until a document is actually selected. */
export function useContextDoc(repoId: Id, path: Id) {
  return useQuery({
    queryKey: ["context-doc", repoId, path],
    queryFn: () =>
      api.get<ContextDocContent>(
        // The path is repo-relative POSIX and may contain spaces and slashes —
        // it is a query parameter, so it is encoded, never interpolated raw.
        `/repos/${repoId}/context/doc?path=${encodeURIComponent(path ?? "")}`,
      ),
    enabled: !!repoId && !!path,
  });
}

/** An agent's effective attachment set for one repository (direct + inherited). */
export function useAgentContext(agentId: Id, repoId: Id) {
  return useQuery({
    queryKey: ["agent-context", agentId, repoId],
    queryFn: () =>
      api.get<ContextAttachmentsView>(
        `/agents/${agentId}/context?repoId=${encodeURIComponent(repoId ?? "")}`,
      ),
    enabled: !!agentId && !!repoId,
  });
}

/** A skill's own attachment set for one repository. */
export function useSkillContext(skillId: Id, repoId: Id) {
  return useQuery({
    queryKey: ["skill-context", skillId, repoId],
    queryFn: () =>
      api.get<ContextAttachmentsView>(
        `/skills/${skillId}/context?repoId=${encodeURIComponent(repoId ?? "")}`,
      ),
    enabled: !!skillId && !!repoId,
  });
}

/** Exactly what a run would inject for this skill — the serialised `specs` block. */
export function useSkillContextPreview(skillId: Id, repoId: Id) {
  return useQuery({
    queryKey: ["skill-context-preview", skillId, repoId],
    queryFn: () =>
      api.get<ContextPreview>(
        `/skills/${skillId}/context/preview?repoId=${encodeURIComponent(repoId ?? "")}`,
      ),
    enabled: !!skillId && !!repoId,
  });
}

export type ContextOwnerKind = "agent" | "skill";

export interface SetContextAttachmentsInput {
  ownerKind: ContextOwnerKind;
  ownerId: string;
  repoId: string;
  paths: string[];
}

/**
 * The cache key holding one owner's view for one repository. The GET writes it
 * and the PUT's response re-seeds it, which is what makes it the freshest
 * concurrency token the client holds — see `useSetContextAttachments`.
 */
function ownerKeyOf(ownerKind: ContextOwnerKind, ownerId: string, repoId: string): string[] {
  return [ownerKind === "agent" ? "agent-context" : "skill-context", ownerId, repoId];
}

/**
 * Replace an agent's or a skill's attachment set for one repository.
 *
 * **One instance, shared by every row.** Callers hold a single
 * `useSetContextAttachments()` and call `mutate` per toggle; they must not
 * create one per row.
 *
 * Calling `mutate` again re-points the single mutation observer, which discards
 * the superseded call's **per-call** `mutate(…, { onSuccess })` options — that
 * much of `client/INSIGHTS.md`, 2026-08-03 holds, and it is what makes the
 * editors' optimistic `previous`-snapshot revert safe. It does **not** extend to
 * the callbacks declared here: `@tanstack/query-core`'s `execute` awaits
 * `this.options.onSuccess` unconditionally, with no reference to which observer
 * is current. Two overlapping replaces therefore both land here, in completion
 * order rather than issue order — so a slow first PUT would otherwise seed the
 * cache with a view that predates the second toggle and silently untick it.
 * `seq` is the guard: a response is applied only if no newer one already was.
 *
 * **The concurrency token rides along automatically (LU).** Every replace sends
 * `expected_version`, read from the owner's *cached view* at request time rather
 * than taken as an argument. That cache is seeded by the GET and re-seeded by
 * each PUT's response, so it holds the version the server produced for the last
 * replace that landed — which is the only token a following replace may carry.
 * A caller passing a token it captured before its own previous PUT would send a
 * version the server has already moved past and get a 409 for a conflict that
 * never happened; the same goes for `agent.version` off a cached agent row,
 * which the PUT bumps too. No cached view (a replace before any GET answered) ⇒
 * the field is omitted and the write is last-writer-wins, exactly as the
 * contract describes.
 *
 * One consequence, deliberately not softened: two replaces *overlapping* both
 * carry the token that predates the first one's response — the second cannot
 * know a version that has not been returned yet — so the second is answered 409
 * and the editor asks the user to apply it again. Omitting the token while a
 * replace is in flight would avoid that, at the cost of reopening the lost
 * update inside exactly the window where it is most likely.
 */
export function useSetContextAttachments() {
  const qc = useQueryClient();
  // Monotonic per hook instance, which is per editor surface: `issued` numbers
  // the calls, `applied` remembers the newest response that reached the cache.
  const issued = useRef(0);
  const applied = useRef(0);
  return useMutation({
    mutationFn: ({ ownerKind, ownerId, repoId, paths }: SetContextAttachmentsInput) => {
      const version = qc.getQueryData<ContextAttachmentsView>(
        ownerKeyOf(ownerKind, ownerId, repoId),
      )?.version;
      const body: ContextAttachmentsUpdate = {
        repo_id: repoId,
        paths,
        ...(version === undefined ? {} : { expected_version: version }),
      };
      const collection = ownerKind === "agent" ? "agents" : "skills";
      return api.put<ContextAttachmentsView>(`/${collection}/${ownerId}/context`, body);
    },
    onMutate: () => ({ seq: (issued.current += 1) }),
    onSuccess: (view, { ownerKind, ownerId, repoId }, context) => {
      const ownerKey = ownerKeyOf(ownerKind, ownerId, repoId);

      // The PUT returns the freshly recomputed view on purpose, so the editor
      // reconciles in one round trip. Seed the cache with it and mark the key
      // stale without refetching — refetching here would only re-ask for what
      // the response already carried.
      //
      // Only the newest response gets to do that, though. An out-of-order one
      // describes a set the user has already moved past: writing it would untick
      // the row the later toggle attached and leave the UI agreeing with a state
      // no longer stored. The invalidations below are *not* guarded — every one
      // of these replaces really did happen server-side, so the counter, the
      // preview and the agent's version are stale regardless of arrival order.
      if (context.seq >= applied.current) {
        applied.current = context.seq;
        qc.setQueryData(ownerKey, view);
      }
      qc.invalidateQueries({ queryKey: ownerKey, refetchType: "none" });

      // AC-59: the usage counter on the Project Context page moves without a
      // reload purely because of this line. Do not drop it.
      qc.invalidateQueries({ queryKey: ["context-docs", repoId] });

      if (ownerKind === "skill") {
        qc.invalidateQueries({ queryKey: ["skill-context-preview", ownerId, repoId] });
      } else {
        // A successful agent replace bumps the agent's version server-side, so
        // any cached agent row is stale.
        qc.invalidateQueries({ queryKey: ["agent", ownerId] });
        qc.invalidateQueries({ queryKey: ["agents"] });
      }
    },
  });
}
