import { describe, it, expect } from "vitest";
import { selectBadgeSensor } from "../../src/utils/adapter-helpers.js";

// selectBadgeSensor (issue #235) picks which sensor(s) a compact badge renders,
// given the badge content mode. It returns a short list (usually length 1) that
// the badge maps to icon-in-ring visuals.

const summary = {
  allergenReplaced: "allergy_risk",
  isSummary: true,
  day0: { state: 2 },
};
const birch = { allergenReplaced: "birch", day0: { state: 1 } };
const grass = { allergenReplaced: "grass", day0: { state: 4 } };
const mugwort = { allergenReplaced: "mugwort", day0: { state: 0 } };
const noData = { allergenReplaced: "alder", day0: { state: -1 } };

describe("selectBadgeSensor", () => {
  it("defaults to the worst (highest-level) per-allergen sensor", () => {
    const sensors = [birch, grass, mugwort];
    expect(selectBadgeSensor(sensors, {})).toEqual([grass]);
    expect(selectBadgeSensor(sensors, { badge_content: "worst" })).toEqual([
      grass,
    ]);
  });

  it("excludes the aggregate from the worst comparison", () => {
    // grass (4) still beats the summary (2); summary is not a per-allergen pick.
    const sensors = [summary, birch, grass, mugwort];
    expect(selectBadgeSensor(sensors, { badge_content: "worst" })).toEqual([
      grass,
    ]);
  });

  it("ranks no-data (state < 0) below a real level 0", () => {
    const sensors = [noData, mugwort];
    expect(selectBadgeSensor(sensors, { badge_content: "worst" })).toEqual([
      mugwort,
    ]);
  });

  it("returns the aggregate when mode is 'aggregate' and one exists", () => {
    const sensors = [birch, summary, grass];
    expect(selectBadgeSensor(sensors, { badge_content: "aggregate" })).toEqual([
      summary,
    ]);
  });

  it("falls back to worst when 'aggregate' but no aggregate is present", () => {
    const sensors = [birch, grass, mugwort];
    expect(selectBadgeSensor(sensors, { badge_content: "aggregate" })).toEqual([
      grass,
    ]);
  });

  it("returns the named allergen when mode is 'single'", () => {
    const sensors = [birch, grass, mugwort];
    expect(
      selectBadgeSensor(sensors, {
        badge_content: "single",
        badge_single_allergen: "birch",
      }),
    ).toEqual([birch]);
  });

  it("returns [] when 'single' names an allergen absent from the sensor set", () => {
    // Named but absent: surface a visible miss rather than silently swapping in
    // the worst other allergen. The badge must NOT show grass (state 4) here.
    const sensors = [grass, mugwort];
    const result = selectBadgeSensor(sensors, {
      badge_content: "single",
      badge_single_allergen: "birch",
    });
    expect(result).toEqual([]);
    // Confirm worst is NOT returned (grass at state 4 would be the worst).
    expect(result).not.toEqual([grass]);
  });

  it("falls back to worst when 'single' has no allergen configured", () => {
    const sensors = [birch, grass, mugwort];
    expect(selectBadgeSensor(sensors, { badge_content: "single" })).toEqual([
      grass,
    ]);
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
      }),
    ).toEqual([summary]);
  });

  it("still matches 'single' on the canonical key directly", () => {
    const sensors = [birch, grass, summary];
    expect(
      selectBadgeSensor(sensors, {
        badge_content: "single",
        badge_single_allergen: "allergy_risk",
      }),
    ).toEqual([summary]);
  });

  it("matches 'single' on a PP localized config key (Björk -> bjork)", () => {
    // PP sensors store normalize(configKey): "Björk" -> "bjork". The badge
    // config holds the localized key "Björk", so single must still resolve.
    const ppBjork = { allergenReplaced: "bjork", day0: { state: 2 } };
    const ppGras = { allergenReplaced: "gras", day0: { state: 1 } };
    expect(
      selectBadgeSensor([ppBjork, ppGras], {
        badge_content: "single",
        badge_single_allergen: "Björk",
      }),
    ).toEqual([ppBjork]);
  });

  it("matches 'single' on a DWD localized config key (gräser -> graeser)", () => {
    // DWD sensors store normalizeDWD(configKey): "gräser" -> "graeser".
    const dwdGraeser = { allergenReplaced: "graeser", day0: { state: 3 } };
    const dwdBirke = { allergenReplaced: "birke", day0: { state: 1 } };
    expect(
      selectBadgeSensor([dwdGraeser, dwdBirke], {
        badge_content: "single",
        badge_single_allergen: "gräser",
      }),
    ).toEqual([dwdGraeser]);
  });

  it("falls back to worst when 'single' allergen is not a string (YAML quirk)", () => {
    const sensors = [birch, grass, mugwort];
    for (const bad of [3, null, {}, ["birch"]]) {
      expect(
        selectBadgeSensor(sensors, {
          badge_content: "single",
          badge_single_allergen: bad,
        }),
      ).toEqual([grass]);
    }
  });

  it("returns all sensors unchanged when mode is 'row'", () => {
    const sensors = [birch, grass, mugwort];
    expect(selectBadgeSensor(sensors, { badge_content: "row" })).toBe(sensors);
  });

  it("honors a string badge_content from YAML", () => {
    const sensors = [birch, summary, grass];
    expect(selectBadgeSensor(sensors, { badge_content: "aggregate" })).toEqual([
      summary,
    ]);
  });

  it("treats a non-string badge_content as the default (worst)", () => {
    const sensors = [birch, grass, mugwort];
    expect(selectBadgeSensor(sensors, { badge_content: 5 })).toEqual([grass]);
  });

  it("is empty-safe on missing / empty input", () => {
    expect(selectBadgeSensor(null, {})).toEqual([]);
    expect(selectBadgeSensor(undefined, { badge_content: "worst" })).toEqual([]);
    expect(selectBadgeSensor([], {})).toEqual([]);
  });

  it("returns the only per-allergen sensor when just one is present", () => {
    expect(selectBadgeSensor([birch], {})).toEqual([birch]);
  });
});
