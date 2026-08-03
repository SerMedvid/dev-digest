import { describe, it, expect } from "vitest";
import type { ConventionScan } from "@devdigest/shared";
import { isScanInFlight, CONVENTIONS_POLL_MS } from "./conventions";

function scan(status: ConventionScan["status"]): ConventionScan {
  return {
    status,
    pool_count: 0,
    sample_count: 0,
    candidate_count: 0,
    dropped: {},
    provider: null,
    model: null,
    error: null,
    started_at: null,
    finished_at: null,
  };
}

describe("isScanInFlight", () => {
  it("is true while queued or running", () => {
    expect(isScanInFlight(scan("queued"))).toBe(true);
    expect(isScanInFlight(scan("running"))).toBe(true);
  });

  it("is false once the scan settled, so the screen stops polling", () => {
    expect(isScanInFlight(scan("done"))).toBe(false);
    expect(isScanInFlight(scan("failed"))).toBe(false);
  });

  it("is false for a repo that was never scanned", () => {
    expect(isScanInFlight(null)).toBe(false);
    expect(isScanInFlight(undefined)).toBe(false);
  });
});

describe("CONVENTIONS_POLL_MS", () => {
  it("polls at 2.5s", () => {
    expect(CONVENTIONS_POLL_MS).toBe(2500);
  });
});
