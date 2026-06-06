import { describe, it, expect } from "vitest";
import { computeDisplayDays } from "../../src/utils/adapter-helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a sensor with N valid days (state >= 0) followed by M invalid ones. */
function makeSensor(validDays, invalidDays = 0) {
  const days = [];
  for (let i = 0; i < validDays; i++) days.push({ state: i }); // state 0..N-1, all >= 0
  for (let i = 0; i < invalidDays; i++) days.push({ state: -1 });
  return { days };
}

/** Sensor with a days array where all entries have state >= 0. */
const sensor3 = makeSensor(3);
const sensor5 = makeSensor(5);
const sensor1 = makeSensor(1);

/** Aggregate-only sensor: exactly one day with valid state. */
const aggregateOnly = makeSensor(1);

// ---------------------------------------------------------------------------
// show_empty_days: true
// ---------------------------------------------------------------------------

describe("computeDisplayDays: show_empty_days", () => {
  it("returns days_to_show directly when show_empty_days is truthy", () => {
    const cfg = { days_to_show: 5, show_empty_days: true };
    expect(computeDisplayDays([sensor3], cfg)).toBe(5);
  });

  it("returns days_to_show even if sensors have fewer real days", () => {
    const cfg = { days_to_show: 7, show_empty_days: true };
    expect(computeDisplayDays([sensor1], cfg)).toBe(7);
  });

  it("ignores sensor data entirely when show_empty_days is set", () => {
    const cfg = { days_to_show: 3, show_empty_days: true };
    // No sensors at all — should still return days_to_show
    expect(computeDisplayDays([], cfg)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// MSW integration clamps to 1
// ---------------------------------------------------------------------------

describe("computeDisplayDays: MSW integration", () => {
  it("clamps to 1 regardless of days_to_show", () => {
    const cfg = { integration: "msw", days_to_show: 5 };
    expect(computeDisplayDays([sensor5], cfg)).toBe(1);
  });

  it("clamps to 1 even when days_to_show is 1 explicitly", () => {
    const cfg = { integration: "msw", days_to_show: 1 };
    expect(computeDisplayDays([sensor3], cfg)).toBe(1);
  });

  it("clamps to 1 for msw with show_empty_days false and a multi-day sensor", () => {
    const cfg = { integration: "msw", days_to_show: 5, show_empty_days: false };
    expect(computeDisplayDays([sensor5], cfg)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Standalone aggregate scenario (the fix motivation)
// ---------------------------------------------------------------------------

describe("computeDisplayDays: standalone aggregate scenario", () => {
  // An allergy_risk summary sensor has only today's data (one day with
  // state >= 0). The detail sensors it accompanies have multiple days.
  // When the card passes only the aggregate to computeDisplayDays (standalone
  // summary block mode), it should return 1. When both are passed it should
  // return the larger count from the detail sensors.

  const aggregateSensor = makeSensor(1); // today only
  const detailA = makeSensor(4);
  const detailB = makeSensor(3);

  it("returns 1 when only the aggregate sensor is present", () => {
    const cfg = { days_to_show: 5 };
    expect(computeDisplayDays([aggregateSensor], cfg)).toBe(1);
  });

  it("returns the detail sensor count when aggregate and details are present", () => {
    const cfg = { days_to_show: 5 };
    expect(computeDisplayDays([aggregateSensor, detailA, detailB], cfg)).toBe(4);
  });

  it("proves columns shrink to 1 in standalone mode vs full mode", () => {
    const cfg = { days_to_show: 5 };
    const standaloneCount = computeDisplayDays([aggregateSensor], cfg);
    const fullCount = computeDisplayDays([aggregateSensor, detailA, detailB], cfg);
    expect(standaloneCount).toBe(1);
    expect(fullCount).toBeGreaterThan(standaloneCount);
  });
});

// ---------------------------------------------------------------------------
// Sensors without a days array are skipped
// ---------------------------------------------------------------------------

describe("computeDisplayDays: sensors without days array", () => {
  it("returns 0 for empty sensor list", () => {
    expect(computeDisplayDays([], { days_to_show: 5 })).toBe(0);
  });

  it("skips sensors that have no days property", () => {
    const noDays = { allergenReplaced: "birch" }; // no .days
    expect(computeDisplayDays([noDays], { days_to_show: 5 })).toBe(0);
  });

  it("skips sensors with empty days array", () => {
    const emptyDays = { days: [] };
    expect(computeDisplayDays([emptyDays], { days_to_show: 5 })).toBe(0);
  });

  it("counts only sensors that have a days array, ignoring those that do not", () => {
    const noDays = { allergenReplaced: "birch" };
    const cfg = { days_to_show: 5 };
    expect(computeDisplayDays([noDays, sensor3], cfg)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// min(realDays, days_to_show) clamping
// ---------------------------------------------------------------------------

describe("computeDisplayDays: clamping to days_to_show", () => {
  it("caps sensor with more real days than days_to_show", () => {
    const cfg = { days_to_show: 3 };
    // sensor5 has 5 real days; should be capped to 3
    expect(computeDisplayDays([sensor5], cfg)).toBe(3);
  });

  it("returns the actual count when real days is less than days_to_show", () => {
    const cfg = { days_to_show: 7 };
    expect(computeDisplayDays([sensor3], cfg)).toBe(3);
  });

  it("takes the max across multiple sensors", () => {
    const cfg = { days_to_show: 5 };
    // sensor1 = 1 day, sensor3 = 3 days; max(1,3) = 3
    expect(computeDisplayDays([sensor1, sensor3], cfg)).toBe(3);
  });

  it("days with state < 0 do not count toward realDays", () => {
    // 2 valid + 3 invalid; realDays = 2
    const mixed = makeSensor(2, 3);
    const cfg = { days_to_show: 5 };
    expect(computeDisplayDays([mixed], cfg)).toBe(2);
  });

  it("a sensor with all invalid days contributes 0", () => {
    const allInvalid = makeSensor(0, 4);
    const cfg = { days_to_show: 5 };
    expect(computeDisplayDays([allInvalid], cfg)).toBe(0);
  });

  it("returns days_to_show when all sensors have more real days than configured", () => {
    const cfg = { days_to_show: 2 };
    expect(computeDisplayDays([sensor3, sensor5], cfg)).toBe(2);
  });
});
