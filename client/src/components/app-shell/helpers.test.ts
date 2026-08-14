/* activeKeyFor — which sidebar item lights up for a given path.

   The `/onboarding` case is the point of this file. `/onboarding` is the
   ADD-A-REPOSITORY screen and `/repos/:id/onboarding` is the generated tour;
   before the tour shipped, a substring match lit the tour item for both. */
import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";

describe("activeKeyFor", () => {
  it("maps the tour route to the tour nav item", () => {
    expect(activeKeyFor("/repos/abc/onboarding")).toBe("onboarding-tour");
  });

  it("does NOT light up the tour for the add-repository screen", () => {
    expect(activeKeyFor("/onboarding")).toBe("");
  });

  it("still maps the neighbouring repo routes", () => {
    expect(activeKeyFor("/repos/abc/context")).toBe("context");
    expect(activeKeyFor("/repos/abc/conventions")).toBe("conventions");
    expect(activeKeyFor("/repos/abc/pulls")).toBe("pulls");
  });

  it("still maps the global routes", () => {
    expect(activeKeyFor("/settings/api-keys")).toBe("settings");
    expect(activeKeyFor("/skills")).toBe("skills");
    expect(activeKeyFor("/agents")).toBe("agents");
  });

  it("returns an empty key for an unknown path", () => {
    expect(activeKeyFor("/nowhere")).toBe("");
  });
});
