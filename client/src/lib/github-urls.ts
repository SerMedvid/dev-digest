/* github-urls.ts — build github.com deep-links from data we already hold.
   PR detail has repo full_name (owner/repo), PR number, head sha, and finding
   file/line — enough to open the PR, a file blob at a line range, or the file
   inside the PR's own diff, in a new tab. */

const HOST = "https://github.com";

/** Encode a repo-relative path for a URL while keeping "/" separators. */
function encPath(file: string): string {
  return file
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

/** https://github.com/{owner}/{repo}/pull/{number} */
export function githubPrUrl(repoFullName: string, number: number): string {
  return `${HOST}/${repoFullName}/pull/${number}`;
}

/**
 * https://github.com/{owner}/{repo}/blob/{sha}/{file}#L{start}[-L{end}]
 * `sha` pins the link to the PR's head so line numbers stay accurate.
 */
export function githubBlobUrl(
  repoFullName: string,
  sha: string,
  file: string,
  startLine?: number,
  endLine?: number,
): string {
  let url = `${HOST}/${repoFullName}/blob/${sha}/${encPath(file)}`;
  if (startLine != null) {
    url += `#L${startLine}`;
    if (endLine != null && endLine !== startLine) url += `-L${endLine}`;
  }
  return url;
}

/**
 * https://github.com/{owner}/{repo}/pull/{n}/files[#diff-{hash}R{start}[-R{end}]]
 *
 * The PR's *Files changed* view, i.e. the finding in its review context (diff,
 * existing comments) rather than the file's blob. `anchorHash` comes from
 * `diffAnchorHash` and is optional on purpose: without it this is still a valid
 * link to the diff, just not scrolled — which is what callers render while the
 * hash is still resolving.
 *
 * Whether the browser actually scrolls is GitHub's business: a file outside the
 * diff has no anchor at all, and large or collapsed diffs load lazily, so the
 * target may not exist yet when the page settles.
 */
export function githubPrFilesUrl(
  repoFullName: string,
  number: number,
  anchorHash?: string | null,
  startLine?: number,
  endLine?: number,
): string {
  const url = `${HOST}/${repoFullName}/pull/${number}/files`;
  if (!anchorHash) return url;
  // R = the new side of the diff, which is the side a finding refers to.
  let anchor = `#diff-${anchorHash}`;
  if (startLine != null) {
    anchor += `R${startLine}`;
    if (endLine != null && endLine !== startLine) anchor += `-R${endLine}`;
  }
  return url + anchor;
}

/** In-flight and settled digests, keyed by path — the same file appears in
 *  several rows and several cards, and each digest is a microtask + allocation
 *  we only ever need once per session. */
const anchorCache = new Map<string, Promise<string | null>>();

/**
 * sha256 hex of a repo-relative path — GitHub's per-file diff anchor id.
 *
 * Async because `crypto.subtle` is, which is why callers can't build the href
 * during render. Resolves to `null` rather than throwing when SubtleCrypto is
 * unavailable (any non-secure context: plain http on a non-localhost host), so
 * the link degrades to the un-anchored diff instead of disappearing.
 */
export function diffAnchorHash(file: string): Promise<string | null> {
  const cached = anchorCache.get(file);
  if (cached) return cached;

  const subtle = globalThis.crypto?.subtle;
  const promise: Promise<string | null> = subtle
    ? subtle
        .digest("SHA-256", new TextEncoder().encode(file))
        .then((buf) =>
          Array.from(new Uint8Array(buf))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(""),
        )
        .catch(() => null)
    : Promise.resolve(null);

  anchorCache.set(file, promise);
  return promise;
}
