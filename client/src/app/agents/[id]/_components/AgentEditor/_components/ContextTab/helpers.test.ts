import { describe, it, expect } from "vitest";
import type { ContextAttachmentRow, ContextAttachmentsView, ContextDoc } from "@devdigest/shared";
import { directPathsOf, moveAttached, orderRows } from "./helpers";

const R1 = "r1";
const R2 = "r2";

const doc = (path: string, root: string, tokens = 100): ContextDoc => ({
  path,
  root,
  size_bytes: tokens * 4,
  token_estimate: tokens,
  used_by_agents: 0,
});

const row = (over: Partial<ContextAttachmentRow> & { path: string }): ContextAttachmentRow => ({
  root: over.path.split("/")[0]!,
  size_bytes: 0,
  token_estimate: 0,
  repo_id: R1,
  source: "direct",
  skill_id: null,
  skill_name: null,
  missing: false,
  ...over,
});

const view = (rows: ContextAttachmentRow[]): ContextAttachmentsView => ({
  direct_count: rows.filter((r) => r.source === "direct" && r.repo_id === R1).length,
  effective_count: rows.filter((r) => r.repo_id === R1).length,
  discovered_count: 0,
  token_estimate: 0,
  rows,
});

describe("orderRows", () => {
  it("puts direct rows first in their stored order, then inherited, then other repositories, then the rest by root and path", () => {
    // A root is the matched root *segment*, at any depth — so `client/insights/…`
    // sorts under `insights`, and ordering by the path alone would put it first.
    const docs = [
      doc("client/insights/ui-notes.md", "insights"),
      doc("specs/api-contract.md", "specs"),
      doc("server/docs/onion-layers.md", "docs"),
      doc("server/docs/adr/0001-onion.md", "docs"),
    ];
    const v = view([
      row({ path: "specs/api-contract.md" }),
      row({
        path: "server/docs/onion-layers.md",
        root: "docs",
        source: "inherited",
        skill_id: "sk1",
        skill_name: "secret-leakage-gate",
      }),
      row({ path: "guides/billing.md", repo_id: R2 }),
    ]);

    const rows = orderRows(docs, v, {
      activeRepoId: R1,
      directPaths: ["specs/api-contract.md"],
    });

    expect(rows.map((r) => [r.path, r.kind])).toEqual([
      ["specs/api-contract.md", "direct"],
      ["server/docs/onion-layers.md", "inherited"],
      ["guides/billing.md", "elsewhere"],
      // Unattached: root segment first, then path.
      ["server/docs/adr/0001-onion.md", "unattached"],
      ["client/insights/ui-notes.md", "unattached"],
    ]);
    expect(rows[1]).toMatchObject({ skillId: "sk1", skillName: "secret-leakage-gate" });
    expect(rows[2]).toMatchObject({ repoId: R2 });
  });

  it("lists an attached document once, never also as an unattached row (AC-67)", () => {
    const docs = [doc("specs/api-contract.md", "specs")];
    const v = view([row({ path: "specs/api-contract.md", token_estimate: 512 })]);

    const rows = orderRows(docs, v, {
      activeRepoId: R1,
      directPaths: ["specs/api-contract.md"],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "direct", tokenEstimate: 512 });
  });

  it("treats an optimistically attached path as attached before the view has seen it", () => {
    const docs = [doc("specs/api-contract.md", "specs", 512), doc("docs/onion-layers.md", "docs")];

    const rows = orderRows(docs, view([]), {
      activeRepoId: R1,
      directPaths: ["specs/api-contract.md"],
    });

    expect(rows.map((r) => r.kind)).toEqual(["direct", "unattached"]);
    // Figures fall back to the discovery result until the replace round-trips.
    expect(rows[0]).toMatchObject({ root: "specs", tokenEstimate: 512, missing: false });
  });

  /* R3. The server's `rows` are `[...thisRepo, ...elsewhere]`, keyed by
     repository *and* path — so a document attached in two repositories appears
     twice, and the cross-repository entry comes second. Keyed by the path alone
     it won, and the direct row then described itself with the figures the server
     deliberately zeroes for another repository's row: 0 tokens, and
     `missing: false` even for a document that is genuinely gone, which puts the
     preview button back on a file that 404s.

     Nothing in this file constructed that collision before, which is exactly why
     it shipped: every earlier fixture uses a path unique to its repository. */
  it("reads a direct row off this repository's row, not the same path attached elsewhere (R3)", () => {
    const docs = [doc("specs/api-contract.md", "specs", 512)];
    const v = view([
      // Attached here, genuinely absent from the clone, and worth 512 tokens
      // when it is there.
      row({ path: "guides/billing.md", token_estimate: 480, missing: true }),
      row({ path: "specs/api-contract.md", token_estimate: 512 }),
      // The same two paths, attached against another repository: zeroed figures
      // and `missing: false`, because that clone is not the one being viewed.
      row({ path: "guides/billing.md", repo_id: R2 }),
      row({ path: "specs/api-contract.md", repo_id: R2 }),
    ]);

    const rows = orderRows(docs, v, {
      activeRepoId: R1,
      directPaths: ["guides/billing.md", "specs/api-contract.md"],
    });

    expect(rows[0]).toMatchObject({
      path: "guides/billing.md",
      kind: "direct",
      tokenEstimate: 480,
      missing: true,
    });
    expect(rows[1]).toMatchObject({
      path: "specs/api-contract.md",
      kind: "direct",
      tokenEstimate: 512,
      missing: false,
    });
    // The other repository's rows are still their own inert entries, both of
    // them — the fix filters the lookup map, it does not drop rows (AC-50).
    expect(rows.filter((r) => r.kind === "elsewhere").map((r) => [r.path, r.repoId])).toEqual([
      ["guides/billing.md", R2],
      ["specs/api-contract.md", R2],
    ]);
  });

  /* R2. Past the per-run cap the server keeps the row, excludes it from
     `token_estimate` and sets `beyond_read_cap`; the model has to carry that
     through or the row reads exactly like one the run injects. */
  it("carries the read-cap flag on direct and inherited rows, and never on the others", () => {
    const docs = [doc("specs/api-contract.md", "specs"), doc("insights/ui.md", "insights")];
    const v = view([
      row({ path: "specs/api-contract.md", beyond_read_cap: true }),
      row({
        path: "docs/onion.md",
        source: "inherited",
        skill_id: "sk1",
        skill_name: "s",
        beyond_read_cap: true,
      }),
      row({ path: "guides/billing.md", repo_id: R2, beyond_read_cap: true }),
    ]);

    const rows = orderRows(docs, v, {
      activeRepoId: R1,
      directPaths: ["specs/api-contract.md"],
    });

    expect(rows.map((r) => [r.kind, r.beyondReadCap])).toEqual([
      ["direct", true],
      ["inherited", true],
      // Another repository's row is outside this run entirely, and an
      // unattached one is not read at all: neither is "past the cap".
      ["elsewhere", false],
      ["unattached", false],
    ]);
  });

  it("keeps a stored path that discovery no longer lists, and flags it missing (AC-51)", () => {
    const docs = [doc("specs/api-contract.md", "specs")];
    const v = view([row({ path: "specs/gone.md", missing: true })]);

    const rows = orderRows(docs, v, { activeRepoId: R1, directPaths: ["specs/gone.md"] });

    expect(rows.map((r) => [r.path, r.kind, r.missing])).toEqual([
      ["specs/gone.md", "direct", true],
      ["specs/api-contract.md", "unattached", false],
    ]);
  });
});

describe("directPathsOf", () => {
  it("takes only this repository's directly attached paths, in the order the server returned them", () => {
    const v = view([
      row({ path: "specs/b.md" }),
      row({ path: "specs/a.md" }),
      row({ path: "docs/x.md", source: "inherited", skill_id: "sk1", skill_name: "s" }),
      row({ path: "guides/other.md", repo_id: R2 }),
    ]);

    expect(directPathsOf(v, R1)).toEqual(["specs/b.md", "specs/a.md"]);
    expect(directPathsOf(undefined, R1)).toEqual([]);
  });
});

describe("moveAttached", () => {
  it("moves a path to a new index", () => {
    expect(moveAttached(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("is a no-op when the index does not change", () => {
    expect(moveAttached(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});
