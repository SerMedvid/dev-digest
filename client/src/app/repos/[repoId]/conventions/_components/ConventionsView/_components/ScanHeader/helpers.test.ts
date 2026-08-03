import { describe, it, expect } from "vitest";
import { relativeTime } from "./helpers";

const now = new Date("2026-08-03T12:00:00.000Z");

describe("relativeTime", () => {
  it("is empty for a scan that never finished", () => {
    expect(relativeTime(null, now)).toBe("");
  });

  it("reads as just now under a minute", () => {
    expect(relativeTime("2026-08-03T11:59:30.000Z", now)).toBe("just now");
  });

  it("counts whole minutes, hours and days", () => {
    expect(relativeTime("2026-08-03T11:45:00.000Z", now)).toBe("15m ago");
    expect(relativeTime("2026-08-03T11:00:00.000Z", now)).toBe("1h ago");
    expect(relativeTime("2026-08-01T12:00:00.000Z", now)).toBe("2d ago");
  });
});
