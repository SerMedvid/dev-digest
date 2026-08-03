import { describe, it, expect } from "vitest";
import { toDiffRows } from "./helpers";

describe("toDiffRows", () => {
  it("marks added and removed lines and keeps context", () => {
    const rows = toDiffRows("a\nb\n", "a\nc\n");
    expect(rows).toEqual([
      { kind: "ctx", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "c" },
    ]);
  });

  it("returns only context rows for identical bodies", () => {
    expect(toDiffRows("same\n", "same\n").every((r) => r.kind === "ctx")).toBe(true);
  });

  it("handles an empty previous body", () => {
    expect(toDiffRows("", "new\n")).toEqual([{ kind: "add", text: "new" }]);
  });
});
