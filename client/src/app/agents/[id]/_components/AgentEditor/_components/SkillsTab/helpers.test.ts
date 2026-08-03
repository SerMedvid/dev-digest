import { describe, it, expect } from "vitest";
import { moveLinked, orderRows } from "./helpers";

const sk = (id: string, name: string) => ({ id, name }) as never;

describe("orderRows", () => {
  it("puts linked skills first in link order, then the rest alphabetically", () => {
    const rows = orderRows([sk("c", "charlie"), sk("a", "alpha"), sk("b", "bravo")], ["b", "c"]);
    expect(rows.map((r) => r.skill.id)).toEqual(["b", "c", "a"]);
    expect(rows.map((r) => r.linked)).toEqual([true, true, false]);
  });

  it("ignores linked ids that no longer exist", () => {
    const rows = orderRows([sk("a", "alpha")], ["ghost", "a"]);
    expect(rows.map((r) => r.skill.id)).toEqual(["a"]);
  });
});

describe("moveLinked", () => {
  it("moves an id to a new index", () => {
    expect(moveLinked(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("is a no-op when the index does not change", () => {
    expect(moveLinked(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});
