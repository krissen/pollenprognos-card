import { describe, it, expect } from "vitest";
import { scaleRingLevel } from "../../src/utils/adapter-helpers.js";

// scaleRingLevel is the single source for the DWD ring-scaling rule that the
// card (normal + minimal) and badge previously inlined. DWD's coarse 0-3 scale
// is doubled to fill the shared 0-6 ring geometry; every other integration
// renders its level unchanged.

describe("scaleRingLevel", () => {
  it("doubles DWD levels", () => {
    expect(scaleRingLevel("dwd", 0)).toBe(0);
    expect(scaleRingLevel("dwd", 1)).toBe(2);
    expect(scaleRingLevel("dwd", 3)).toBe(6);
  });

  it("passes other integrations through unchanged", () => {
    for (const integration of [
      "pp",
      "peu",
      "kleenex",
      "plu",
      "silam",
      "gpl",
      "atmo",
      "msw",
    ]) {
      expect(scaleRingLevel(integration, 4)).toBe(4);
    }
  });

  it("coerces non-numeric input to 0", () => {
    expect(scaleRingLevel("pp", undefined)).toBe(0);
    expect(scaleRingLevel("dwd", null)).toBe(0);
    expect(scaleRingLevel("dwd", "x")).toBe(0);
  });

  it("doubles a numeric string for DWD", () => {
    expect(scaleRingLevel("dwd", "2")).toBe(4);
  });
});
