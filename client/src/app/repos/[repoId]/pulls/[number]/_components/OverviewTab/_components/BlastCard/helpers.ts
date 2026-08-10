import { githubBlobUrl } from "@/lib/github-urls";

/**
 * The one place a blast row's link is built, shared by the tree and the graph
 * so the two can never disagree about where a `file:line` points.
 *
 * `null` when the repo's `full_name` is unknown — the caller then renders plain
 * text rather than a dead link, per `client/specs/finding-deep-links.md`. The
 * URL is SHA-pinned so the line number stays right as the branch moves on.
 */
export function callerHref(
  repoFullName: string | null,
  headSha: string,
  file: string,
  line: number | null,
): string | null {
  if (!repoFullName) return null;
  return githubBlobUrl(repoFullName, headSha, file, line ?? undefined);
}
