import { describe, it, expect } from "vitest";
import {
  ringSegmentsForIntegration,
  numLevelsForIntegration,
} from "../../src/utils/level-counts.js";

// Single source for per-integration level counts, shared by the rendering mixin
// (ring segments) and the editor (level-color pickers + phrase defaults). These
// must match each adapter's native level scale; the table below is the contract.

// [integration, ringSegments, numLevels]
const EXPECTED = [
  ["pp", 6, 7],
  ["silam", 6, 7],
  ["atmo", 6, 7],
  ["gpl", 5, 6],
  ["gp", 5, 6],
  ["peu", 4, 5],
  ["kleenex", 4, 5],
  ["msw", 4, 5],
  ["plu", 3, 4],
  // DWD is special: native 0-3 (4 levels) doubled onto the 6-segment ring.
  ["dwd", 6, 4],
];

describe("ringSegmentsForIntegration", () => {
  for (const [integration, segments] of EXPECTED) {
    it(`${integration} -> ${segments} segments`, () => {
      expect(ringSegmentsForIntegration(integration)).toBe(segments);
    });
  }

  it("defaults unknown integrations to 6", () => {
    expect(ringSegmentsForIntegration("something-new")).toBe(6);
    expect(ringSegmentsForIntegration(undefined)).toBe(6);
  });
});

describe("numLevelsForIntegration", () => {
  for (const [integration, , numLevels] of EXPECTED) {
    it(`${integration} -> ${numLevels} levels`, () => {
      expect(numLevelsForIntegration(integration)).toBe(numLevels);
    });
  }

  it("equals ringSegments + 1 for every integration except DWD", () => {
    for (const [integration] of EXPECTED) {
      if (integration === "dwd") continue;
      expect(numLevelsForIntegration(integration)).toBe(
        ringSegmentsForIntegration(integration) + 1,
      );
    }
  });
});
