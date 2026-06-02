import { describe, it, expect } from "vitest";
import { badgeRingLevel } from "../../src/utils/adapter-helpers.js";

// badgeRingLevel normalises the day0 sensor object into a single integer that
// the badge ring renderer consumes. Level 0 is a real pollen level and must
// not be collapsed into the no-data sentinel (-1). Only genuinely missing or
// non-numeric states produce -1.

describe("badgeRingLevel", () => {
  it("preserves level 0 (real zero is not no-data)", () => {
    expect(badgeRingLevel({ state: 0 })).toBe(0);
  });

  it("returns the state as a number for positive integer levels", () => {
    expect(badgeRingLevel({ state: 3 })).toBe(3);
  });

  it("passes through -1 (existing no-data marker)", () => {
    expect(badgeRingLevel({ state: -1 })).toBe(-1);
  });

  it("passes through -2 (DWD-scaled no-data marker)", () => {
    expect(badgeRingLevel({ state: -2 })).toBe(-2);
  });

  it("returns -1 when day0 is undefined", () => {
    expect(badgeRingLevel(undefined)).toBe(-1);
  });

  it("returns -1 when state is absent from day0", () => {
    expect(badgeRingLevel({})).toBe(-1);
  });

  it("returns -1 when state is null", () => {
    expect(badgeRingLevel({ state: null })).toBe(-1);
  });

  it("returns -1 when state is a non-numeric string", () => {
    expect(badgeRingLevel({ state: "foo" })).toBe(-1);
  });

  it("coerces a numeric string to the corresponding number", () => {
    expect(badgeRingLevel({ state: "2" })).toBe(2);
  });

  it("treats a negative display_state as no-data even when state is 0 (atmo unavailable)", () => {
    // Atmo maps an unavailable reading (raw 0) to state 0 / display_state -1.
    expect(badgeRingLevel({ state: 0, display_state: -1 })).toBe(-1);
  });

  it("returns state, not display_state, when display_state is non-negative", () => {
    // DWD display_state is the already-scaled value; the ring level must stay
    // the canonical state so scaleRingLevel does not double-scale it.
    expect(badgeRingLevel({ state: 3, display_state: 6 })).toBe(3);
  });

  it("ignores a non-negative display_state and keeps a real level 0", () => {
    expect(badgeRingLevel({ state: 0, display_state: 0 })).toBe(0);
  });
});
