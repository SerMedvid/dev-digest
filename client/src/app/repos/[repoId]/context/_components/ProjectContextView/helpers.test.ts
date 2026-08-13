import { describe, it, expect } from "vitest";
import { kbSize, scanTime } from "./helpers";

describe("scanTime", () => {
  it("is empty for a missing or unparseable stamp rather than 'Invalid Date'", () => {
    expect(scanTime(null)).toBe("");
    expect(scanTime(undefined)).toBe("");
    expect(scanTime("")).toBe("");
    expect(scanTime("not-a-date")).toBe("");
  });

  it("renders a clock time, and two scans a minute apart do not read the same", () => {
    // AC-39 hangs on this: the footer stamp has to *move* after a rescan, so
    // the format cannot be coarser than the interval between two scans.
    const first = scanTime("2026-08-13T10:00:00.000Z");
    const second = scanTime("2026-08-13T10:01:30.000Z");
    expect(first).toMatch(/\d{1,2}:\d{2}/);
    expect(second).not.toBe(first);
  });
});

describe("kbSize", () => {
  it("rounds to whole kilobytes and never rounds a real file down to nothing", () => {
    expect(kbSize(0)).toBe(0);
    expect(kbSize(1)).toBe(1);
    expect(kbSize(400)).toBe(1);
    expect(kbSize(2048)).toBe(2);
    expect(kbSize(65_536)).toBe(64);
  });
});
