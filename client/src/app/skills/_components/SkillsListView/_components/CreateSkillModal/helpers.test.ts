import { describe, it, expect } from "vitest";
import { deriveSkillName, stripMarkdownExtension } from "./helpers";

describe("stripMarkdownExtension", () => {
  it("drops md / markdown / mdx, case-insensitively", () => {
    expect(stripMarkdownExtension("rule.md")).toBe("rule");
    expect(stripMarkdownExtension("rule.MARKDOWN")).toBe("rule");
    expect(stripMarkdownExtension("rule.mdx")).toBe("rule");
  });

  it("leaves a name with no markdown extension alone", () => {
    expect(stripMarkdownExtension("rule.txt")).toBe("rule.txt");
    expect(stripMarkdownExtension("pr-quality-rubric")).toBe("pr-quality-rubric");
  });
});

describe("deriveSkillName", () => {
  it("prefers the first heading over the filename", () => {
    expect(deriveSkillName("# Async convention\n\nbody", "rule.md")).toBe("Async convention");
  });

  it("skips prose to find a heading further down", () => {
    expect(deriveSkillName("intro line\n\n## Nested heading\n", "rule.md")).toBe("Nested heading");
  });

  it("falls back to the filename when there is no heading", () => {
    expect(deriveSkillName("just prose", "pr-quality-rubric.md")).toBe("pr-quality-rubric");
  });

  it("returns empty when there is nothing to derive from", () => {
    expect(deriveSkillName("just prose")).toBe("");
    expect(deriveSkillName("")).toBe("");
  });

  it("ignores a hash that is not a heading", () => {
    expect(deriveSkillName("#no-space\nconst x = 1 # trailing", "rule.md")).toBe("rule");
  });
});
