/**
 * Golden / characterization tests for adapter fetchForecast output.
 *
 * These snapshots freeze the exact fetchForecast() output for every adapter
 * across a set of variants that exercise the resolveEntityIds 3-path cascade,
 * the per-allergen scaffold loop, the padding loops, and the per-adapter
 * level-scaling tables. They are the safety gate for the base.ts extraction
 * and the pp/dwd TypeScript pilot conversions: the base refactor and the
 * pilot conversions must keep these byte-identical.
 *
 * Do NOT edit the snapshot files under __goldens__/ to make a diff pass. A
 * golden diff means behavior changed -- investigate the code, not the snapshot.
 *
 * Time is frozen to a mid-season day (2026-06-15T12:00:00 local) so the
 * date-driven forecast windows and day labels are deterministic.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { getAdapter } from "../../src/adapter-registry.js";
import { buildGoldenFixtures } from "../golden-fixtures.js";

const FROZEN_NOW = new Date("2026-06-15T12:00:00");

/**
 * Deterministic serializer: JSON with 2-space indentation. Array order is
 * preserved (never sorted) -- ordering is part of the adapter output contract.
 */
function serialize(value: any): any {
  return JSON.stringify(value, null, 2);
}

describe("adapter fetchForecast goldens", () => {
  let fixtures: any;

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
    // Build fixtures AFTER time is frozen so the date-driven factories emit
    // deterministic forecast windows.
    fixtures = buildGoldenFixtures();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("covers every registered adapter", () => {
    const covered = new Set(buildGoldenFixtures().map((f: any) => f.adapter));
    // 11 registered adapters; each must have at least one golden case.
    for (const id of ["pp", "dwd", "peu", "silam", "atmo", "plu", "msw", "irmkmi", "kleenex", "gp", "gpl"]) {
      expect(covered.has(id)).toBe(true);
    }
  });

  it("has a stable set of fixture cases", async () => {
    // The snapshot iteration below is data-driven; vitest needs at least one
    // static test per file. Assert the case list itself is non-empty so an
    // accidental empty fixture build is caught.
    expect(buildGoldenFixtures().length).toBeGreaterThan(0);
  });

  // Data-driven: one snapshot file per adapter/variant. Building the case list
  // here (before beforeAll runs) is only used to register the it() blocks; the
  // actual hass/config objects are read from the frozen-time `fixtures` array.
  for (const { adapter, variant } of buildGoldenFixtures()) {
    it(`${adapter} / ${variant}`, async () => {
      const fixture = fixtures.find(
        (f: any) => f.adapter === adapter && f.variant === variant,
      )!;
      expect(fixture).toBeDefined();

      const mod = getAdapter(fixture.adapter)!;
      expect(mod).toBeDefined();

      const result = await mod.fetchForecast(
        fixture.hass,
        fixture.config,
        fixture.forecastEvent,
      );

      await expect(serialize(result)).toMatchFileSnapshot(
        `./__goldens__/${adapter}-${variant}.json`,
      );
    });
  }
});
