import { describe, it, expect } from "vitest";
import { selectBadgeSensor } from "../../src/utils/adapter-helpers.js";

// selectBadgeSensor (issue #235) picks which sensor(s) a compact badge renders,
// given the badge content mode. It returns a short list (usually length 1) that
// the badge maps to icon-in-ring visuals.

const summary: any = {
  allergenReplaced: "allergy_risk",
  isSummary: true,
  days: [{ state: 2 }],
};
const birch: any = { allergenReplaced: "birch", days: [{ state: 1 }] };
const grass: any = { allergenReplaced: "grass", days: [{ state: 4 }] };
const mugwort: any = { allergenReplaced: "mugwort", days: [{ state: 0 }] };
const noData: any = { allergenReplaced: "alder", days: [{ state: -1 }] };

describe("selectBadgeSensor", () => {
  it("defaults to the worst (highest-level) per-allergen sensor", () => {
    const sensors = [birch, grass, mugwort];
    expect(selectBadgeSensor(sensors, {} as any)).toEqual([grass]);
    expect(
      selectBadgeSensor(sensors, { badge_content: "worst" } as any),
    ).toEqual([grass]);
  });

  it("excludes the aggregate from the worst comparison", () => {
    // grass (4) still beats the summary (2); summary is not a per-allergen pick.
    const sensors = [summary, birch, grass, mugwort];
    expect(
      selectBadgeSensor(sensors, { badge_content: "worst" } as any),
    ).toEqual([grass]);
  });

  it("ranks no-data (state < 0) below a real level 0", () => {
    const sensors = [noData, mugwort];
    expect(
      selectBadgeSensor(sensors, { badge_content: "worst" } as any),
    ).toEqual([mugwort]);
  });

  it("returns the aggregate when mode is 'aggregate' and one exists", () => {
    const sensors = [birch, summary, grass];
    expect(
      selectBadgeSensor(sensors, { badge_content: "aggregate" } as any),
    ).toEqual([summary]);
  });

  it("falls back to worst when 'aggregate' but no aggregate is present", () => {
    const sensors = [birch, grass, mugwort];
    expect(
      selectBadgeSensor(sensors, { badge_content: "aggregate" } as any),
    ).toEqual([grass]);
  });

  it("returns the named allergen when mode is 'single'", () => {
    const sensors = [birch, grass, mugwort];
    expect(
      selectBadgeSensor(sensors, {
        badge_content: "single",
        badge_single_allergen: "birch",
      } as any),
    ).toEqual([birch]);
  });

  it("returns [] when 'single' names an allergen absent from the sensor set", () => {
    // Named but absent: surface a visible miss rather than silently swapping in
    // the worst other allergen. The badge must NOT show grass (state 4) here.
    const sensors = [grass, mugwort];
    const result = selectBadgeSensor(sensors, {
      badge_content: "single",
      badge_single_allergen: "birch",
    } as any);
    expect(result).toEqual([]);
    // Confirm worst is NOT returned (grass at state 4 would be the worst).
    expect(result).not.toEqual([grass]);
  });

  it("falls back to worst when 'single' has no allergen configured", () => {
    const sensors = [birch, grass, mugwort];
    expect(
      selectBadgeSensor(sensors, { badge_content: "single" } as any),
    ).toEqual([grass]);
  });

  it("matches 'single' on the user-facing key when it canonicalizes (SILAM index)", () => {
    // SILAM's index sensor carries the canonical allergenReplaced "allergy_risk",
    // but a user names it with the config key "index". toCanonicalAllergenKey
    // maps index -> allergy_risk, so the badge must still find it.
    const sensors = [birch, grass, summary];
    expect(
      selectBadgeSensor(sensors, {
        badge_content: "single",
        badge_single_allergen: "index",
      } as any),
    ).toEqual([summary]);
  });

  it("still matches 'single' on the canonical key directly", () => {
    const sensors = [birch, grass, summary];
    expect(
      selectBadgeSensor(sensors, {
        badge_content: "single",
        badge_single_allergen: "allergy_risk",
      } as any),
    ).toEqual([summary]);
  });

  it("matches 'single' on a PP localized config key (Björk -> bjork)", () => {
    // PP sensors store normalize(configKey): "Björk" -> "bjork". The badge
    // config holds the localized key "Björk", so single must still resolve.
    const ppBjork: any = { allergenReplaced: "bjork", days: [{ state: 2 }] };
    const ppGras: any = { allergenReplaced: "gras", days: [{ state: 1 }] };
    expect(
      selectBadgeSensor([ppBjork, ppGras], {
        badge_content: "single",
        badge_single_allergen: "Björk",
      } as any),
    ).toEqual([ppBjork]);
  });

  it("matches 'single' on a DWD localized config key (gräser -> graeser)", () => {
    // DWD sensors store normalizeDWD(configKey): "gräser" -> "graeser".
    const dwdGraeser: any = {
      allergenReplaced: "graeser",
      days: [{ state: 3 }],
    };
    const dwdBirke: any = { allergenReplaced: "birke", days: [{ state: 1 }] };
    expect(
      selectBadgeSensor([dwdGraeser, dwdBirke], {
        badge_content: "single",
        badge_single_allergen: "gräser",
      } as any),
    ).toEqual([dwdGraeser]);
  });

  it("falls back to worst when 'single' allergen is not a string (YAML quirk)", () => {
    const sensors = [birch, grass, mugwort];
    for (const bad of [3, null, {}, ["birch"]]) {
      expect(
        selectBadgeSensor(sensors, {
          badge_content: "single",
          badge_single_allergen: bad,
        } as any),
      ).toEqual([grass]);
    }
  });

  it("returns all sensors unchanged when mode is 'row'", () => {
    const sensors = [birch, grass, mugwort];
    expect(selectBadgeSensor(sensors, { badge_content: "row" } as any)).toBe(
      sensors,
    );
  });

  it("honors a string badge_content from YAML", () => {
    const sensors = [birch, summary, grass];
    expect(
      selectBadgeSensor(sensors, { badge_content: "aggregate" } as any),
    ).toEqual([summary]);
  });

  it("treats a non-string badge_content as the default (worst)", () => {
    const sensors = [birch, grass, mugwort];
    expect(selectBadgeSensor(sensors, { badge_content: 5 } as any)).toEqual([
      grass,
    ]);
  });

  it("is empty-safe on missing / empty input", () => {
    expect(selectBadgeSensor(null as any, {} as any)).toEqual([]);
    expect(
      selectBadgeSensor(undefined as any, { badge_content: "worst" } as any),
    ).toEqual([]);
    expect(selectBadgeSensor([], {} as any)).toEqual([]);
  });

  it("returns the only per-allergen sensor when just one is present", () => {
    expect(selectBadgeSensor([birch], {} as any)).toEqual([birch]);
  });
});
