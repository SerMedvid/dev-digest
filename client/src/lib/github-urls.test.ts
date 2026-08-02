/**
 * github-urls — the PR-diff deep link from
 * `client/specs/finding-deep-links.md` §1.
 *
 * Every test uses a distinct file path on purpose: `diffAnchorHash` memoizes at
 * module scope, which is the point of it, and shared paths would leak a stubbed
 * digest from one case into the next.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { diffAnchorHash, githubPrFilesUrl } from "./github-urls";

const realCrypto = globalThis.crypto;

/** jsdom ships no SubtleCrypto, so the real thing has to be stood in for. */
function stubSubtle(digest = vi.fn(async () => new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer)) {
  vi.stubGlobal("crypto", { ...realCrypto, subtle: { digest } });
  return digest;
}

afterEach(() => vi.unstubAllGlobals());

describe("githubPrFilesUrl", () => {
  it("links to the PR's diff, un-anchored, when the hash isn't known yet", () => {
    expect(githubPrFilesUrl("acme/api", 128)).toBe("https://github.com/acme/api/pull/128/files");
    // Undefined and null are the same "not resolved" state.
    expect(githubPrFilesUrl("acme/api", 128, null, 42, 50)).toBe(
      "https://github.com/acme/api/pull/128/files",
    );
  });

  it("anchors to the file and the start line on the new side of the diff", () => {
    expect(githubPrFilesUrl("acme/api", 128, "abc123", 42)).toBe(
      "https://github.com/acme/api/pull/128/files#diff-abc123R42",
    );
  });

  it("keeps both ends of a multi-line range, and collapses a single-line one", () => {
    expect(githubPrFilesUrl("acme/api", 128, "abc123", 42, 50)).toBe(
      "https://github.com/acme/api/pull/128/files#diff-abc123R42-R50",
    );
    expect(githubPrFilesUrl("acme/api", 128, "abc123", 42, 42)).toBe(
      "https://github.com/acme/api/pull/128/files#diff-abc123R42",
    );
  });

  it("anchors the file alone when the finding carries no line", () => {
    expect(githubPrFilesUrl("acme/api", 128, "abc123")).toBe(
      "https://github.com/acme/api/pull/128/files#diff-abc123",
    );
  });
});

describe("diffAnchorHash", () => {
  it("returns the sha256 of the path as lowercase hex", async () => {
    stubSubtle();
    await expect(diffAnchorHash("src/hex-case.ts")).resolves.toBe("deadbeef");
  });

  it("hashes a given path exactly once, however many rows ask for it", async () => {
    const digest = stubSubtle();
    const path = "src/memoized.ts";
    await Promise.all([diffAnchorHash(path), diffAnchorHash(path)]);
    await diffAnchorHash(path);
    expect(digest).toHaveBeenCalledTimes(1);
  });

  /* Without SubtleCrypto — any non-secure context, e.g. plain http on a host
     that isn't localhost — the link has to degrade to the un-anchored diff
     rather than disappear or throw. */
  it("resolves to null instead of throwing when SubtleCrypto is unavailable", async () => {
    vi.stubGlobal("crypto", { ...realCrypto, subtle: undefined });
    await expect(diffAnchorHash("src/no-subtle.ts")).resolves.toBeNull();
  });

  it("resolves to null when the digest itself rejects", async () => {
    stubSubtle(vi.fn(async () => Promise.reject(new Error("nope"))));
    await expect(diffAnchorHash("src/rejects.ts")).resolves.toBeNull();
  });
});
