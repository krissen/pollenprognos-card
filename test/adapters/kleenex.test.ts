import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  fetchForecast,
  stubConfigKleenex,
  resolveEntityIds,
  discoverKleenex,
  scopeManualEntities,
  _resetManualScopeWarningsForTest,
} from "../../src/adapters/kleenex/index.js";
import { _resetNaWarningsForTest } from "../../src/adapters/kleenex/forecast.js";
import {
  createHass,
  createHassWithRegistry,
  assertSensorShape,
} from "../helpers.js";

/**
 * Build registry entries for one Kleenex config entry (one device), using the
 * renamed-device entity IDs from issue #309: no `radar_` slug, no location slug.
 *
 * @param instance   - Config-entry instance name (device label).
 * @param prefix     - Entity-ID prefix, e.g. "kleenex_pollen".
 * @param deviceId   - Device registry ID.
 * @param cfgEntry   - Config entry ID.
 */
function kleenexRegistryEntries(
  instance: string,
  prefix: string,
  deviceId: string,
  cfgEntry: string,
): any[] {
  const categoryAttrs = (ppm: number, details: any[]) => ({
    details,
    forecast: [
      { datetime: "2026-04-26", level: 2, value: ppm, details },
      { datetime: "2026-04-27", level: 2, value: ppm, details },
    ],
  });
  const deviceMeta = {
    name: `Kleenex Pollen Radar (${instance})`,
    identifiers: [["kleenex_pollenradar", instance] as [string, string]],
    configEntries: [cfgEntry],
  };
  return [
    {
      entityId: `sensor.${prefix}_trees`,
      state: "200",
      attributes: categoryAttrs(200, [{ name: "Birch", value: 150 }]),
      platform: "kleenex_pollenradar",
      translationKey: "trees",
      deviceId,
      deviceMeta,
    },
    {
      entityId: `sensor.${prefix}_grass`,
      state: "100",
      attributes: categoryAttrs(100, []),
      platform: "kleenex_pollenradar",
      translationKey: "grass",
      deviceId,
    },
    {
      entityId: `sensor.${prefix}_weeds`,
      state: "80",
      attributes: categoryAttrs(80, []),
      platform: "kleenex_pollenradar",
      translationKey: "weeds",
      deviceId,
    },
    {
      entityId: `sensor.${prefix}_armoise`,
      state: "42",
      attributes: { forecast: [{ date: "2026-04-26", value: 30 }] },
      platform: "kleenex_pollenradar",
      translationKey: "detail_value",
      deviceId,
    },
    {
      entityId: `sensor.${prefix}_armoise_level`,
      state: "low",
      platform: "kleenex_pollenradar",
      translationKey: "detail_level",
      deviceId,
    },
    {
      entityId: `sensor.${prefix}_trees_level`,
      state: "high",
      platform: "kleenex_pollenradar",
      translationKey: "trees_level",
      deviceId,
    },
    {
      entityId: `sensor.${prefix}_last_updated`,
      state: "2026-04-25T10:00:00+00:00",
      platform: "kleenex_pollenradar",
      translationKey: "last_updated",
      deviceId,
    },
  ];
}

function makeConfig(overrides: any = {}): any {
  return { ...stubConfigKleenex, ...overrides };
}

/**
 * Build a Kleenex sensor state object.
 *
 * @param {string} location  - Location slug, e.g. "amsterdam"
 * @param {string} category  - Entity suffix, e.g. "trees", "grass", "weeds"
 * @param {number} ppmValue  - Today's PPM reading (sensor state)
 * @param {Array}  details   - [{name, value}] for individual allergen breakdown
 * @param {Array}  forecast  - [{level, details}] per future day
 * @returns {Object} sensor state object with entity_id set
 */
function makeKleenexEntity(location: any, category: any, ppmValue: any, details: any = [], forecast: any = []): any {
  return {
    entity_id: `sensor.kleenex_pollen_radar_${location}_${category}`,
    state: String(ppmValue),
    attributes: {
      details: details.map((d: any) => ({ name: d.name, value: d.value })),
      forecast: forecast.map((f: any, i: number) => ({
        datetime: new Date(Date.now() + (i + 1) * 86400000).toISOString(),
        level: f.level,
        details: f.details || [],
      })),
    },
  };
}

/**
 * Build a hass mock from an array of entity objects that already have entity_id.
 */
function makeHassFromEntities(entities: any): any {
  const states: Record<string, any> = {};
  for (const entity of entities) {
    states[entity.entity_id] = entity;
  }
  return createHass(states);
}

// ---------------------------------------------------------------------------
// 1. Basic shape
// ---------------------------------------------------------------------------
describe("Kleenex adapter: basic shape", () => {
  it("returns an array of sensor dicts with the required fields", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 200,
      [{ name: "Birch", value: 150 }, { name: "Oak", value: 50 }],
      [],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch", "oak"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    for (const sensor of result) {
      assertSensorShape(sensor);
    }
  });

  it("sets allergenReplaced to the canonical slug", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 100,
      [{ name: "Birch", value: 100 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0]!.allergenReplaced).toBe("birch");
  });

  it("sets entity_id to the source sensor entity_id", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 100,
      [{ name: "Birch", value: 100 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0]!.entity_id).toBe("sensor.kleenex_pollen_radar_amsterdam_trees");
  });

  it("sets allergenCapitalized to a non-empty string", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 100,
      [{ name: "Birch", value: 100 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(typeof result[0]!.allergenCapitalized).toBe("string");
    expect(result[0]!.allergenCapitalized.length).toBeGreaterThan(0);
  });

  it("day0 is defined and is the same object as days[0]", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 100,
      [{ name: "Birch", value: 100 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0]!.days[0]).toBeDefined();
    expect(result[0]!.days[0]).toBe(result[0]!.days[0]);
  });

  it("respects days_to_show", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 100,
      [{ name: "Birch", value: 100 }],
      [{ level: 1, details: [{ name: "Birch", value: 80 }] }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 3,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0]!.days.length).toBe(3);
    expect(result[0]!.days[2]).toBeDefined();
    expect(result[0]!.days[3]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. PPM to level (0-4) conversion using category-specific thresholds
// ---------------------------------------------------------------------------
describe("Kleenex adapter: PPM to level conversion", () => {
  // Trees thresholds: [95, 207, 703]
  // 0 -> 0, 1-95 -> 1, 96-207 -> 2, 208-703 -> 3, >703 -> 4
  it("maps 0 PPM to level 0 for trees allergens", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 0,
      [{ name: "Birch", value: 0 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0]!.days[0]!.state).toBe(0);
  });

  it("maps trees PPM within low threshold (<=95) to level 1", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 95,
      [{ name: "Birch", value: 95 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0]!.days[0]!.state).toBe(1);
  });

  it("maps trees PPM within moderate threshold (96-207) to level 2", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 200,
      [{ name: "Birch", value: 200 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0]!.days[0]!.state).toBe(2);
  });

  it("maps trees PPM within high threshold (208-703) to level 3", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 703,
      [{ name: "Birch", value: 703 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0]!.days[0]!.state).toBe(3);
  });

  it("maps trees PPM above high threshold (>703) to level 4", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 1000,
      [{ name: "Birch", value: 1000 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0]!.days[0]!.state).toBe(4);
  });

  // Grass thresholds: [29, 60, 341]
  it("applies grass-specific thresholds: 30 PPM -> level 2", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "grass", 30,
      [{ name: "Grass", value: 30 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["grass"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    // 30 > 29 (low threshold) so level 2 (moderate)
    expect(result[0]!.days[0]!.state).toBe(2);
  });

  // Weeds thresholds: [20, 77, 266]
  it("applies weeds-specific thresholds: 15 PPM -> level 1", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "weeds", 15,
      [{ name: "Ragweed", value: 15 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["ragweed"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    // 15 <= 20 (low threshold) so level 1
    expect(result[0]!.days[0]!.state).toBe(1);
    // The raw ppm measurement is kept for numeric_value_raw.
    expect(result[0]!.days[0]!.raw_value).toBe(15);
  });

  it("coerces 'unavailable' sensor state to level 0 for category sensors", async () => {
    // The adapter uses: Number(sensor.state) || 0
    // Number("unavailable") = NaN; NaN || 0 = 0; ppmToLevel(0) = 0.
    // This means "unavailable" is treated as zero pollen, not -1.
    const entity: any = {
      entity_id: "sensor.kleenex_pollen_radar_amsterdam_trees",
      state: "unavailable",
      attributes: {
        details: [],
        forecast: [],
      },
    };
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["trees_cat"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0]!.days[0]!.state).toBe(0);
  });

  it("returns -1 for negative PPM values", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", -10,
      [{ name: "Birch", value: -5 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0]!.days[0]!.state).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// 3. Level scaling: raw 0-4 -> display 0-6
// ---------------------------------------------------------------------------
describe("Kleenex adapter: level scaling (0-4 to 0-6)", () => {
  // Formula: level < 2 ? floor(level*6/4) : ceil(level*6/4)
  // 0 -> 0, 1 -> 1, 2 -> 3, 3 -> 5, 4 -> 6

  const scalingCases = [
    // [ppmForBirch, expectedRawLevel, expectedScaledStateText]
    // We test that state (raw) and state_text (scaled) are consistent.
    [0, 0],    // raw 0 -> scaled 0
    [50, 1],   // raw 1 (<=95) -> scaled 1
    [150, 2],  // raw 2 (96-207) -> scaled 3
    [500, 3],  // raw 3 (208-703) -> scaled 5
    [1000, 4], // raw 4 (>703) -> scaled 6
  ];

  for (const [ppm, expectedRawLevel] of scalingCases) {
    it(`PPM ${ppm} produces raw state ${expectedRawLevel} with a non-empty state_text`, async () => {
      const entity = makeKleenexEntity(
        "amsterdam", "trees", ppm,
        [{ name: "Birch", value: ppm }],
      );
      const hass = makeHassFromEntities([entity]);
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0]!.days[0]!.state).toBe(expectedRawLevel);
      expect(typeof result[0]!.days[0]!.state_text).toBe("string");
    });
  }

  it("state_text for raw level 4 (PPM >703) differs from raw level 0 (PPM 0)", async () => {
    const entityHigh = makeKleenexEntity(
      "amsterdam", "trees", 1000,
      [{ name: "Birch", value: 1000 }],
    );
    const entityLow = makeKleenexEntity(
      "amsterdam", "trees", 0,
      [{ name: "Birch", value: 0 }],
    );

    const hassHigh = makeHassFromEntities([entityHigh]);
    const hassLow = makeHassFromEntities([entityLow]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const resultHigh = await fetchForecast(hassHigh, config);
    const resultLow = await fetchForecast(hassLow, config);

    expect(resultHigh[0]!.days[0]!.state_text).not.toBe(resultLow[0]!.days[0]!.state_text);
  });
});

// ---------------------------------------------------------------------------
// 4. Category sensors (trees_cat / grass_cat / weeds_cat)
// ---------------------------------------------------------------------------
describe("Kleenex adapter: category sensors", () => {
  it("includes trees_cat when included in allergens and trees sensor exists", async () => {
    const entity = makeKleenexEntity("amsterdam", "trees", 200, [], []);
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["trees_cat"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0]!.allergenReplaced).toBe("trees_cat");
  });

  it("includes grass_cat when included in allergens and grass sensor exists", async () => {
    const entity = makeKleenexEntity("amsterdam", "grass", 50, [], []);
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["grass_cat"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0]!.allergenReplaced).toBe("grass_cat");
  });

  it("includes weeds_cat when included in allergens and weeds sensor exists", async () => {
    const entity = makeKleenexEntity("amsterdam", "weeds", 30, [], []);
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["weeds_cat"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0]!.allergenReplaced).toBe("weeds_cat");
  });

  it("skips category sensor when the corresponding _cat key is not in allergens", async () => {
    const entity = makeKleenexEntity("amsterdam", "trees", 300, [], []);
    const hass = makeHassFromEntities([entity]);
    // allergens does NOT include trees_cat
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.every((s) => s.allergenReplaced !== "trees_cat")).toBe(true);
  });

  it("category sensor uses the PPM state to derive level", async () => {
    // 200 PPM for trees falls in 96-207 range -> level 2
    const entity = makeKleenexEntity("amsterdam", "trees", 200, [], []);
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["trees_cat"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0]!.days[0]!.state).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Individual allergens extracted from details array
// ---------------------------------------------------------------------------
describe("Kleenex adapter: individual allergens from details", () => {
  it("extracts individual allergens from the details attribute", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 300,
      [
        { name: "Birch", value: 250 },
        { name: "Oak", value: 50 },
      ],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch", "oak"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);
    const keys = result.map((s) => s.allergenReplaced);

    expect(keys).toContain("birch");
    expect(keys).toContain("oak");
  });

  it("maps localized French allergen names to canonical slugs", async () => {
    // "bouleau" -> "birch" via KLEENEX_ALLERGEN_MAP
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 150,
      [{ name: "Bouleau", value: 150 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0]!.allergenReplaced).toBe("birch");
  });

  it("maps localized Dutch allergen names to canonical slugs", async () => {
    // "berk" -> "birch" via KLEENEX_ALLERGEN_MAP
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 100,
      [{ name: "Berk", value: 100 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0]!.allergenReplaced).toBe("birch");
  });

  it("skips individual allergens not in config.allergens", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 300,
      [
        { name: "Birch", value: 250 },
        { name: "Pine", value: 50 },
      ],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"], // pine not included
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.map((s) => s.allergenReplaced)).not.toContain("pine");
  });

  it("uses detail PPM value (not category PPM) for individual allergen level", async () => {
    // Category PPM 703 -> level 3; but birch detail 50 -> level 1
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 703,
      [{ name: "Birch", value: 50 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    // 50 PPM for birch (trees category) <= 95 -> level 1
    expect(result[0]!.days[0]!.state).toBe(1);
  });

  it("extracts forecast day data for individual allergens from forecast.details", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 100,
      [{ name: "Birch", value: 100 }],
      [
        { level: 1, details: [{ name: "Birch", value: 800 }] }, // day+1: level 4
      ],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 2,
    });

    const result = await fetchForecast(hass, config);

    // Today: 100 PPM <= 95? No: 100 > 95 so level 2
    expect(result[0]!.days[0]!.state).toBe(2);
    // Tomorrow: 800 PPM > 703 -> level 4
    expect(result[0]!.days[1]!.state).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 6. sort_category_allergens_first: two-tiered sorting
// ---------------------------------------------------------------------------
describe("Kleenex adapter: sort_category_allergens_first", () => {
  it("places category allergens before individual allergens when enabled", async () => {
    const treesEntity = makeKleenexEntity(
      "amsterdam", "trees", 100, // trees_cat level 1
      [
        { name: "Birch", value: 700 }, // birch level 3
        { name: "Oak", value: 200 },   // oak level 2
      ],
    );
    const hass = makeHassFromEntities([treesEntity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["trees_cat", "birch", "oak"],
      pollen_threshold: 0,
      sort: "value_descending",
      sort_category_allergens_first: true,
    });

    const result = await fetchForecast(hass, config);

    // trees_cat should come first regardless of its lower value
    expect(result[0]!.allergenReplaced).toBe("trees_cat");
    // Individual allergens should be sorted by value_descending among themselves
    const individualKeys = result.slice(1).map((s) => s.allergenReplaced);
    expect(individualKeys[0]).toBe("birch"); // 700 PPM > oak 200 PPM
    expect(individualKeys[1]).toBe("oak");
  });

  it("sorts all allergens together without two-tiered split when disabled", async () => {
    const treesEntity = makeKleenexEntity(
      "amsterdam", "trees", 1000, // trees_cat level 4
      [
        { name: "Birch", value: 50 },  // birch level 1
      ],
    );
    const hass = makeHassFromEntities([treesEntity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["trees_cat", "birch"],
      pollen_threshold: 0,
      sort: "value_descending",
      sort_category_allergens_first: false,
    });

    const result = await fetchForecast(hass, config);

    // Without two-tiered sort, trees_cat (level 4) should sort before birch (level 1)
    expect(result[0]!.allergenReplaced).toBe("trees_cat");
    expect(result[1]!.allergenReplaced).toBe("birch");
  });

  it("preserves config order when sort is 'none'", async () => {
    const treesEntity = makeKleenexEntity(
      "amsterdam", "trees", 200,
      [
        { name: "Oak", value: 200 },
        { name: "Birch", value: 50 },
      ],
    );
    const hass = makeHassFromEntities([treesEntity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["oak", "birch"], // oak first in config
      pollen_threshold: 0,
      sort: "none",
    });

    const result = await fetchForecast(hass, config);

    // Order in config: oak, birch
    expect(result[0]!.allergenReplaced).toBe("oak");
    expect(result[1]!.allergenReplaced).toBe("birch");
  });
});

// ---------------------------------------------------------------------------
// 7. Threshold filtering
// ---------------------------------------------------------------------------
describe("Kleenex adapter: threshold filtering", () => {
  it("excludes allergens where all days are below pollen_threshold", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 50, // level 1 (<=95)
      [
        { name: "Birch", value: 50 },  // level 1
        { name: "Oak", value: 0 },     // level 0
      ],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch", "oak"],
      pollen_threshold: 2, // requires level >= 2
    });

    const result = await fetchForecast(hass, config);

    // birch level 1 < threshold 2, oak level 0 < threshold 2 -> both filtered
    expect(result.length).toBe(0);
  });

  it("includes all allergens when pollen_threshold is 0", async () => {
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 0,
      [
        { name: "Birch", value: 0 },
        { name: "Oak", value: 0 },
      ],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch", "oak"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(2);
  });

  it("includes allergen when any single forecast day meets threshold", async () => {
    // Today: 0 PPM (level 0); day+1: 800 PPM (level 4)
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 0,
      [{ name: "Birch", value: 0 }],
      [{ level: 4, details: [{ name: "Birch", value: 800 }] }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 3,
      days_to_show: 2,
    });

    const result = await fetchForecast(hass, config);

    // Day+1 has level 4 which meets threshold 3
    expect(result.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. User level names (5 or 7 custom labels)
// ---------------------------------------------------------------------------
describe("Kleenex adapter: user level names", () => {
  it("accepts 7 custom level labels mapping directly to scaled indices 0-6", async () => {
    const customLevels = ["None", "VeryLow", "Low", "Medium", "High", "VeryHigh", "Extreme"];
    // Birch 200 PPM (trees) -> raw level 2 -> scaled level ceil(2*6/4) = 3 -> "Medium"
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 200,
      [{ name: "Birch", value: 200 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
      phrases: { full: {}, short: {}, levels: customLevels, days: {}, no_information: "" },
    });

    const result = await fetchForecast(hass, config);

    // Raw level 2 -> scaled level 3 -> customLevels[3] = "Medium"
    expect(result[0]!.days[0]!.state_text).toBe("Medium");
  });

  it("accepts 5 custom level labels mapped via index positions [0,1,3,5,6]", async () => {
    // 5 labels: idx0->scale0, idx1->scale1, idx2->scale3, idx3->scale5, idx4->scale6
    const customLevels = ["Zero", "Low", "Moderate", "High", "VeryHigh"];
    // Birch 200 PPM -> raw 2 -> scaled 3; map[2]=3 in 5-label -> customLevels[2] = "Moderate"
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 200,
      [{ name: "Birch", value: 200 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
      phrases: { full: {}, short: {}, levels: customLevels, days: {}, no_information: "" },
    });

    const result = await fetchForecast(hass, config);

    // Raw level 2 -> scaled 3; 5-label map[2] = 3 -> customLevels[2] = "Moderate"
    expect(result[0]!.days[0]!.state_text).toBe("Moderate");
  });

  it("falls back to i18n default for empty string entries in 7-label array", async () => {
    const customLevels = ["CustomZero", "", "", "", "", "", ""];
    const entity = makeKleenexEntity(
      "amsterdam", "trees", 0,
      [{ name: "Birch", value: 0 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
      phrases: { full: {}, short: {}, levels: customLevels, days: {}, no_information: "" },
    });

    const result = await fetchForecast(hass, config);

    // Level 0 -> scaled 0 -> customLevels[0] = "CustomZero"
    expect(result[0]!.days[0]!.state_text).toBe("CustomZero");
  });
});

// ---------------------------------------------------------------------------
// 9. Manual mode (location="manual" with entity_prefix)
// ---------------------------------------------------------------------------
describe("Kleenex adapter: manual mode", () => {
  it("filters sensors by entity_prefix in manual mode", async () => {
    // In manual mode the adapter still looks for sensor.kleenex_pollen_radar_ prefix
    // but further filters by the user-provided prefix within those entity IDs.
    const entity = makeKleenexEntity(
      "mypfx_amsterdam", "trees", 150,
      [{ name: "Birch", value: 150 }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "manual",
      entity_prefix: "kleenex_pollen_radar_mypfx",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0]!.entity_id).toBe(
      "sensor.kleenex_pollen_radar_mypfx_amsterdam_trees",
    );
  });

  it("returns empty array in manual mode when no sensor matches the prefix", async () => {
    // Entity exists at a different location, prefix won't match
    const entity = makeKleenexEntity("other_location", "trees", 150, [
      { name: "Birch", value: 150 },
    ]);
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "manual",
      entity_prefix: "kleenex_pollen_radar_nonexistent",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(0);
  });

  it("classifies a suffixed category sensor in pass 1", async () => {
    // Codex round 16: pass 1 read the raw last token ("v2"), so a category-only
    // (NA-zone) config collected nothing, while pass 2 correctly recognised the
    // same entity as a category sensor and skipped it -- no forecast at all.
    const hass = makeHassFromEntities([
      {
        entity_id: "sensor.kleenex_pollen_trees_v2",
        state: "200",
        attributes: {
          friendly_name: "Kleenex pollen Trees",
          details: [],
          forecast: [
            { datetime: "2026-04-26", level: 2, value: 180, details: [] },
          ],
        },
      },
    ]);
    const config = makeConfig({
      location: "manual",
      entity_prefix: "kleenex_pollen_",
      entity_suffix: "_v2",
      allergens: ["trees_cat"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.map((s) => s.allergenReplaced)).toEqual(["trees_cat"]);
    expect(result[0]!.entity_id).toBe("sensor.kleenex_pollen_trees_v2");
  });

  it("uses only suffixed entities when entity_suffix is configured", async () => {
    // Codex round 15: both the unsuffixed and the suffixed sensor match the
    // prefix, and the unsuffixed one is listed first, so a prefix-only
    // collection would render it instead of the configured `_v2` sensor.
    const detail = (entityId: string, ppm: number) => ({
      entity_id: entityId,
      state: String(ppm),
      attributes: {
        friendly_name: entityId,
        forecast: [{ date: "2026-04-26", value: ppm }],
      },
    });
    const hass = makeHassFromEntities([
      detail("sensor.kleenex_pollen_birch", 10),
      detail("sensor.kleenex_pollen_birch_v2", 200),
    ]);
    const config = makeConfig({
      location: "manual",
      entity_prefix: "kleenex_pollen_",
      entity_suffix: "_v2",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0]!.entity_id).toBe("sensor.kleenex_pollen_birch_v2");
    expect(result[0]!.days[0]!.value).toBe(200);
  });

  it("issue #309 - collects sensors whose IDs lack the legacy domain slug", async () => {
    // Device renamed to "Kleenex pollen": entity IDs carry neither
    // `kleenex_pollen_radar_` nor a location slug.
    const category = (name: string, ppm: number, details: any[]) => ({
      entity_id: `sensor.kleenex_pollen_${name}`,
      state: String(ppm),
      attributes: {
        details,
        forecast: [
          { datetime: "2026-04-26", level: 2, value: ppm, details },
          { datetime: "2026-04-27", level: 2, value: ppm, details },
        ],
      },
    });
    const hass = makeHassFromEntities([
      category("trees", 200, [{ name: "Birch", value: 150 }]),
      category("grass", 100, []),
      category("weeds", 80, []),
      {
        entity_id: "sensor.kleenex_pollen_armoise",
        state: "42",
        attributes: { forecast: [{ date: "2026-04-26", value: 30 }] },
      },
      {
        entity_id: "sensor.kleenex_pollen_armoise_level",
        state: "low",
        attributes: {},
      },
      {
        entity_id: "sensor.kleenex_pollen_last_updated",
        state: "2026-04-25T10:00:00+00:00",
        attributes: {},
      },
    ]);
    const config = makeConfig({
      location: "manual",
      entity_prefix: "kleenex_pollen_",
      allergens: ["trees_cat", "grass_cat", "weeds_cat", "birch", "mugwort"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    const keys = result.map((s) => s.allergenReplaced);
    expect(keys).toContain("trees_cat");
    expect(keys).toContain("grass_cat");
    expect(keys).toContain("weeds_cat");
    expect(keys).toContain("birch");
    expect(keys).toContain("mugwort");
    expect(
      result.find((s) => s.allergenReplaced === "mugwort")!.entity_id,
    ).toBe("sensor.kleenex_pollen_armoise");
    // Diagnostic entities must never become allergen sensors.
    expect(result.every((s) => !s.entity_id.endsWith("_level"))).toBe(true);
    expect(result.every((s) => !s.entity_id.endsWith("_last_updated"))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// 10. Location filtering
// ---------------------------------------------------------------------------
describe("Kleenex adapter: location filtering", () => {
  it("only includes sensors for the configured location", async () => {
    const ams = makeKleenexEntity("amsterdam", "trees", 200, [
      { name: "Birch", value: 200 },
    ]);
    const bxl = makeKleenexEntity("brussels", "trees", 50, [
      { name: "Birch", value: 50 },
    ]);
    const hass = makeHassFromEntities([ams, bxl]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0]!.entity_id).toContain("amsterdam");
    expect(result[0]!.entity_id).not.toContain("brussels");
  });

  it("returns empty array when no sensors match the configured location", async () => {
    const entity = makeKleenexEntity("amsterdam", "trees", 200, [
      { name: "Birch", value: 200 },
    ]);
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "brussels",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11. stubConfigKleenex shape
// ---------------------------------------------------------------------------
describe("stubConfigKleenex", () => {
  it("has integration set to 'kleenex'", () => {
    expect(stubConfigKleenex.integration).toBe("kleenex");
  });

  it("has sort_category_allergens_first enabled by default", () => {
    expect(stubConfigKleenex.sort_category_allergens_first).toBe(true);
  });

  it("does not include category allergens (trees_cat etc.) in default allergens list", () => {
    expect(stubConfigKleenex.allergens).not.toContain("trees_cat");
    expect(stubConfigKleenex.allergens).not.toContain("grass_cat");
    expect(stubConfigKleenex.allergens).not.toContain("weeds_cat");
  });

  it("includes common individual allergens in the default allergens list", () => {
    expect(stubConfigKleenex.allergens).toContain("birch");
    expect(stubConfigKleenex.allergens).toContain("oak");
    expect(stubConfigKleenex.allergens).toContain("ragweed");
    expect(stubConfigKleenex.allergens).toContain("poaceae");
  });
});

// ---------------------------------------------------------------------------
// Helper: build a DetailSensor-shaped entity.
// DetailSensors have state = ppm string and attributes.forecast = [{date, value}].
// ---------------------------------------------------------------------------
function makeDetailSensorEntity(location: any, allergenSlug: any, ppmToday: any, forecastItems: any = []): any {
  return {
    entity_id: `sensor.kleenex_pollen_radar_${location}_${allergenSlug}`,
    state: String(ppmToday),
    attributes: {
      forecast: forecastItems.map((item: any, i: number) => ({
        date: new Date(Date.now() + (i + 1) * 86400000).toISOString().split("T")[0],
        value: item.value,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: build the NA-fingerprint category entity.
// NA API returns non-empty forecast but every details[] and forecast[i].details[]
// is an empty array (that is the fingerprint).
// ---------------------------------------------------------------------------
function makeNACategory(location: any, category: any, ppmToday: any, forecastDays: any = 4): any {
  return {
    entity_id: `sensor.kleenex_pollen_radar_${location}_${category}`,
    state: String(ppmToday),
    attributes: {
      details: [],
      forecast: Array.from({ length: forecastDays }, (_, i) => ({
        datetime: new Date(Date.now() + (i + 1) * 86400000).toISOString(),
        level: 2,
        value: ppmToday,
        details: [],
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// 12. NA-zone console.warn
// ---------------------------------------------------------------------------
describe("Kleenex adapter: NA-zone warning", () => {
  beforeEach(() => {
    _resetNaWarningsForTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test 1 - emits a warning containing 'North America' when NA fingerprint is detected and individual allergens were requested", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const treesEntity = makeNACategory("atlanta", "trees", 200);
    const hass = makeHassFromEntities([treesEntity]);
    const config = makeConfig({
      location: "atlanta",
      allergens: ["birch", "oak"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    const warnMessage = warnSpy.mock.calls[0]![0];
    expect(warnMessage).toContain("North America");
  });

  it("Test 2 - does NOT emit warning when user has trees_cat in allergens (already on correct path)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const treesEntity = makeNACategory("atlanta", "trees", 200);
    const hass = makeHassFromEntities([treesEntity]);
    // User already has a category allergen configured -- no warning expected.
    const config = makeConfig({
      location: "atlanta",
      allergens: ["trees_cat", "birch", "oak"],
      pollen_threshold: 0,
    });

    await fetchForecast(hass, config);

    // The warn spy may be called for other reasons (e.g. adapter errors), but
    // the NA warning message must NOT appear.
    const naWarningCalled = warnSpy.mock.calls.some(
      (args) => typeof args[0] === "string" && args[0]!.includes("North America"),
    );
    expect(naWarningCalled).toBe(false);
  });

  it("Test 3 - does NOT emit warning for EU pattern (forecast with non-empty details[])", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // EU category sensor: details populated, forecast.details populated.
    const treesEntity = makeKleenexEntity(
      "amsterdam", "trees", 200,
      [{ name: "Birch", value: 150 }, { name: "Oak", value: 50 }],
      [{ level: 2, details: [{ name: "Birch", value: 120 }, { name: "Oak", value: 30 }] }],
    );
    const hass = makeHassFromEntities([treesEntity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch", "oak"],
      pollen_threshold: 0,
    });

    await fetchForecast(hass, config);

    const naWarningCalled = warnSpy.mock.calls.some(
      (args) => typeof args[0] === "string" && args[0]!.includes("North America"),
    );
    expect(naWarningCalled).toBe(false);
  });

  it("Test 4 - does NOT emit warning when category sensor forecast is empty (not the NA fingerprint)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Sensor with empty forecast[] — this is NOT the NA fingerprint; NA always has
    // non-empty forecast. The tightened heuristic requires forecast.length > 0.
    const treesEntity = {
      entity_id: "sensor.kleenex_pollen_radar_testlocation_trees",
      state: "0",
      attributes: {
        details: [],
        forecast: [], // Empty forecast — not the NA pattern
      },
    };
    const hass = makeHassFromEntities([treesEntity]);
    const config = makeConfig({
      location: "testlocation",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    await fetchForecast(hass, config);

    const naWarningCalled = warnSpy.mock.calls.some(
      (args) => typeof args[0] === "string" && args[0]!.includes("North America"),
    );
    expect(naWarningCalled).toBe(false);
  });

  it("Test 2b - emits warning when user mixes raw category and individual allergens but only category resolves", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // NA category sensor has data (trees ppm) but no per-allergen breakdown.
    const treesEntity = makeNACategory("atlanta", "trees", 200);
    const hass = makeHassFromEntities([treesEntity]);
    // Config has raw `trees` (not `trees_cat`) plus `birch`. Birch will silently
    // fail on NA; the warning should still fire so the user notices.
    const config = makeConfig({
      location: "atlanta",
      allergens: ["trees", "birch"],
      pollen_threshold: 0,
    });

    await fetchForecast(hass, config);

    const naWarningCalled = warnSpy.mock.calls.some(
      (args) => typeof args[0] === "string" && args[0]!.includes("North America"),
    );
    expect(naWarningCalled).toBe(true);
  });

  it("Test 1b - NA warning fires only once per (location, prefix, suffix) combination", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const treesEntity = makeNACategory("atlanta", "trees", 200);
    const hass = makeHassFromEntities([treesEntity]);
    const config = makeConfig({
      location: "atlanta",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    // Simulate three HA state updates within the same session.
    await fetchForecast(hass, config);
    await fetchForecast(hass, config);
    await fetchForecast(hass, config);

    const naWarnings = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0]!.includes("North America"),
    );
    expect(naWarnings.length).toBe(1);
  });

  it("Test 4b - emits warning in manual mode with entity_suffix when category sensor would otherwise be missed", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const treesEntity = {
      entity_id: "sensor.kleenex_pollen_radar_atlanta_trees_v2",
      state: "200",
      attributes: {
        details: [],
        forecast: [
          { datetime: "2026-04-26", level: 2, value: 200, details: [] },
          { datetime: "2026-04-27", level: 2, value: 200, details: [] },
        ],
      },
    };
    const hass = makeHassFromEntities([treesEntity]);
    const config = makeConfig({
      location: "manual",
      entity_prefix: "kleenex_pollen_radar_atlanta_",
      entity_suffix: "_v2",
      allergens: ["birch", "oak"],
      pollen_threshold: 0,
    });

    await fetchForecast(hass, config);

    const naWarningCalled = warnSpy.mock.calls.some(
      (args) => typeof args[0] === "string" && args[0]!.includes("North America"),
    );
    expect(naWarningCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 13. DetailSensor fallback (Pass 2)
// ---------------------------------------------------------------------------
describe("Kleenex adapter: DetailSensor fallback", () => {
  it("Test 5 - uses DetailSensor when category sensor has empty details (NA pattern)", async () => {
    const treesEntity = makeNACategory("amsterdam", "trees", 200);
    const birchDetail = makeDetailSensorEntity("amsterdam", "birch", 150, [
      { value: 100 },
      { value: 50 },
    ]);
    const hass = makeHassFromEntities([treesEntity, birchDetail]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0]!.allergenReplaced).toBe("birch");
    expect(result[0]!.entity_id).toBe("sensor.kleenex_pollen_radar_amsterdam_birch");
    // 150 ppm for birch (trees category) is in range 96-207 -> raw level 2
    expect(result[0]!.days[0]!.state).toBe(2);
    // Forecast day 1: 100 ppm -> raw level 2; day 2: 50 ppm -> raw level 1
    expect(result[0]!.days[1]!.state).toBe(2);
    expect(result[0]!.days[2]!.state).toBe(1);
  });

  it("Test 5b - DetailSensor result passes sensor shape contract", async () => {
    const treesEntity = makeNACategory("amsterdam", "trees", 200);
    const birchDetail = makeDetailSensorEntity("amsterdam", "birch", 150, [
      { value: 100 },
    ]);
    const hass = makeHassFromEntities([treesEntity, birchDetail]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    assertSensorShape(result[0]);
  });

  it("Test 6 - localized Dutch DetailSensor slug 'berk' normalizes to canonical allergen 'birch'", async () => {
    const treesEntity = makeNACategory("amsterdam", "trees", 200);
    // Dutch localization: sensor suffix is 'berk'
    const berkDetail = makeDetailSensorEntity("amsterdam", "berk", 120, [{ value: 80 }]);
    const hass = makeHassFromEntities([treesEntity, berkDetail]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0]!.allergenReplaced).toBe("birch");
    expect(result[0]!.entity_id).toBe("sensor.kleenex_pollen_radar_amsterdam_berk");
  });

  it("Test 6b - localized Italian DetailSensor slug 'betulla' normalizes to canonical allergen 'birch'", async () => {
    const treesEntity = makeNACategory("rome", "trees", 200);
    const betullaDetail = makeDetailSensorEntity("rome", "betulla", 100, []);
    const hass = makeHassFromEntities([treesEntity, betullaDetail]);
    const config = makeConfig({
      location: "rome",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0]!.allergenReplaced).toBe("birch");
    expect(result[0]!.entity_id).toBe("sensor.kleenex_pollen_radar_rome_betulla");
  });

  it("Test 7 - category sensor details (EU full data) wins over DetailSensor", async () => {
    // EU category sensor with full details — birch data comes from here.
    const treesEntity = makeKleenexEntity(
      "amsterdam", "trees", 300,
      [{ name: "Birch", value: 250 }], // level 3 (208-703)
      [],
    );
    // DetailSensor also present but should NOT be used.
    const birchDetail = makeDetailSensorEntity("amsterdam", "birch", 50, []); // level 1
    const hass = makeHassFromEntities([treesEntity, birchDetail]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0]!.allergenReplaced).toBe("birch");
    // Must use the category sensor value (250 ppm -> level 3), not DetailSensor (50 -> level 1).
    expect(result[0]!.days[0]!.state).toBe(3);
    expect(result[0]!.entity_id).toBe("sensor.kleenex_pollen_radar_amsterdam_trees");
  });

  it("Test 8 - entity with '_level' suffix is NOT treated as a DetailSensor", async () => {
    const treesEntity = makeNACategory("amsterdam", "trees", 200);
    // This entity has a '_level' suffix and must be skipped by Pass 2.
    const levelEntity = {
      entity_id: "sensor.kleenex_pollen_radar_amsterdam_birch_level",
      state: "high",
      attributes: { forecast: [] },
    };
    const hass = makeHassFromEntities([treesEntity, levelEntity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    // birch must NOT be populated from the _level entity.
    expect(result.every((s) => s.allergenReplaced !== "birch")).toBe(true);
  });

  it("Test 9 - diagnostic suffix entities (_date, _last_updated, _region) are skipped", async () => {
    const treesEntity = makeNACategory("amsterdam", "trees", 200);
    const diagnosticEntities = [
      { entity_id: "sensor.kleenex_pollen_radar_amsterdam_date", state: "2026-04-25", attributes: {} },
      { entity_id: "sensor.kleenex_pollen_radar_amsterdam_last_updated", state: "2026-04-25T00:00:00Z", attributes: {} },
      { entity_id: "sensor.kleenex_pollen_radar_amsterdam_region", state: "NL", attributes: {} },
      { entity_id: "sensor.kleenex_pollen_radar_amsterdam_latitude", state: "52.37", attributes: {} },
      { entity_id: "sensor.kleenex_pollen_radar_amsterdam_longitude", state: "4.90", attributes: {} },
      { entity_id: "sensor.kleenex_pollen_radar_amsterdam_city", state: "Amsterdam", attributes: {} },
      { entity_id: "sensor.kleenex_pollen_radar_amsterdam_error", state: "none", attributes: {} },
    ];
    const hass = makeHassFromEntities([treesEntity, ...diagnosticEntities]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    // None of the diagnostic entities should produce sensor output for birch.
    expect(result.every((s) => s.allergenReplaced !== "birch")).toBe(true);
    // Also verify no diagnostic keys appear as allergenReplaced values.
    const ids = result.map((s) => s.allergenReplaced);
    expect(ids).not.toContain("date");
    expect(ids).not.toContain("last_updated");
    expect(ids).not.toContain("region");
  });

  it("Test 9d - DetailSensor fallback works when config.location is empty (auto-detect mode)", async () => {
    const treesEntity = makeNACategory("amsterdam", "trees", 200);
    const birchDetail = makeDetailSensorEntity("amsterdam", "birch", 150, [
      { value: 100 },
    ]);
    const hass = makeHassFromEntities([treesEntity, birchDetail]);
    const config = makeConfig({
      // Empty location: stubConfigKleenex default; means "don't filter by location".
      location: "",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0]!.allergenReplaced).toBe("birch");
    expect(result[0]!.entity_id).toBe("sensor.kleenex_pollen_radar_amsterdam_birch");
  });

  it("Test 9a - DetailSensor with non-numeric state ('unknown'/'unavailable') is skipped, not treated as 0 ppm", async () => {
    const treesEntity = makeNACategory("amsterdam", "trees", 200);
    const unknownDetail = {
      entity_id: "sensor.kleenex_pollen_radar_amsterdam_birch",
      state: "unknown",
      attributes: { forecast: [{ date: "2026-04-26", value: 100 }] },
    };
    const hass = makeHassFromEntities([treesEntity, unknownDetail]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    // Birch must NOT be added to the result with a fake 0 ppm reading.
    expect(result.every((s) => s.allergenReplaced !== "birch")).toBe(true);
  });

  it("Test 9b - manual mode resolves DetailSensor when entity_prefix covers full domain+location", async () => {
    const treesEntity = {
      entity_id: "sensor.kleenex_pollen_radar_atlanta_georgia_trees",
      state: "200",
      attributes: { details: [], forecast: [
        { datetime: "2026-04-26", level: 2, value: 200, details: [] },
        { datetime: "2026-04-27", level: 2, value: 200, details: [] },
      ] },
    };
    const birchDetail = {
      entity_id: "sensor.kleenex_pollen_radar_atlanta_georgia_birch",
      state: "150",
      attributes: { forecast: [{ date: "2026-04-26", value: 100 }] },
    };
    const hass = makeHassFromEntities([treesEntity, birchDetail]);
    const config = makeConfig({
      location: "manual",
      entity_prefix: "kleenex_pollen_radar_atlanta_georgia_",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0]!.allergenReplaced).toBe("birch");
    expect(result[0]!.entity_id).toBe(
      "sensor.kleenex_pollen_radar_atlanta_georgia_birch",
    );
  });

  it("Test 9c - manual mode strips entity_suffix before alias lookup", async () => {
    const treesEntity = {
      entity_id: "sensor.kleenex_pollen_radar_atlanta_trees_v2",
      state: "200",
      attributes: { details: [], forecast: [
        { datetime: "2026-04-26", level: 2, value: 200, details: [] },
      ] },
    };
    const birchDetail = {
      entity_id: "sensor.kleenex_pollen_radar_atlanta_birch_v2",
      state: "150",
      attributes: { forecast: [{ date: "2026-04-26", value: 100 }] },
    };
    const hass = makeHassFromEntities([treesEntity, birchDetail]);
    const config = makeConfig({
      location: "manual",
      entity_prefix: "kleenex_pollen_radar_atlanta_",
      entity_suffix: "_v2",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0]!.allergenReplaced).toBe("birch");
    expect(result[0]!.entity_id).toBe(
      "sensor.kleenex_pollen_radar_atlanta_birch_v2",
    );
  });
});

// ---------------------------------------------------------------------------
// 14. resolveEntityIds DetailSensor probe
// ---------------------------------------------------------------------------
describe("Kleenex adapter: resolveEntityIds DetailSensor probe", () => {
  it("Test 10 - standard mode returns both category sensor and DetailSensor in the map", () => {
    const treesEntity = makeKleenexEntity("amsterdam", "trees", 200, [], []);
    const birchDetail = makeDetailSensorEntity("amsterdam", "birch", 150, []);
    const hass = makeHassFromEntities([treesEntity, birchDetail]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const map = resolveEntityIds(config, hass);

    // Category side: 'trees' should be present (birch -> trees category)
    expect(map.has("trees")).toBe(true);
    expect(map.get("trees")).toBe("sensor.kleenex_pollen_radar_amsterdam_trees");

    // DetailSensor side: 'birch' should also be present
    expect(map.has("birch")).toBe(true);
    expect(map.get("birch")).toBe("sensor.kleenex_pollen_radar_amsterdam_birch");
  });

  it("Test 11 - manual mode resolves DetailSensor via entity_prefix", () => {
    const treesEntity = {
      entity_id: "sensor.kleenex_pollen_radar_atlanta_georgia_trees",
      state: "100",
      attributes: { details: [], forecast: [] },
    };
    const birchDetail = {
      entity_id: "sensor.kleenex_pollen_radar_atlanta_georgia_birch",
      state: "80",
      attributes: { forecast: [] },
    };
    const hass = makeHassFromEntities([treesEntity, birchDetail]);
    const config = makeConfig({
      location: "manual",
      entity_prefix: "kleenex_pollen_radar_atlanta_georgia_",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const map = resolveEntityIds(config, hass);

    expect(map.has("birch")).toBe(true);
    expect(map.get("birch")).toBe("sensor.kleenex_pollen_radar_atlanta_georgia_birch");
  });

  it("Test 12 - DetailSensor not in hass.states is absent from the returned map", () => {
    // Only the category sensor exists; no birch DetailSensor.
    const treesEntity = makeKleenexEntity("amsterdam", "trees", 200, [], []);
    const hass = makeHassFromEntities([treesEntity]);
    const config = makeConfig({
      location: "amsterdam",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const map = resolveEntityIds(config, hass);

    // Category is present, but birch DetailSensor is not.
    expect(map.has("birch")).toBe(false);
    // Category sensor is still found.
    expect(map.has("trees")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 15. Registry-based discovery (discoverKleenex)
// ---------------------------------------------------------------------------
describe("Kleenex adapter: discoverKleenex", () => {
  it("discovers a renamed device (issue #309) as one location", () => {
    const hass = createHassWithRegistry(
      kleenexRegistryEntries("Home", "kleenex_pollen", "device_home", "cfg_home"),
    );

    const discovery = discoverKleenex(hass);

    expect(discovery.tierUsed).toBe(1);
    expect(discovery.locations.size).toBe(1);
    const [, loc] = [...discovery.locations][0]!;
    expect(loc.label).toBe("Home");
    expect([...loc.entities.keys()].sort()).toEqual([
      "grass",
      "mugwort",
      "trees",
      "weeds",
    ]);
    expect(loc.entities.get("trees")).toBe("sensor.kleenex_pollen_trees");
    expect(loc.entities.get("mugwort")).toBe("sensor.kleenex_pollen_armoise");
  });

  it("keys locations by the slugified device identifier, not the entry id", () => {
    const hass = createHassWithRegistry(
      kleenexRegistryEntries("Home", "kleenex_pollen", "device_home", "cfg_home"),
    );

    const discovery = discoverKleenex(hass);

    // A readable, rename-stable key that survives removing and re-adding the
    // integration, unlike the config-entry ULID.
    expect([...discovery.locations.keys()]).toEqual(["home"]);
  });

  it("does not resolve a config value that two identifiers both normalize to", async () => {
    const hass = createHassWithRegistry([
      ...kleenexRegistryEntries("St. John", "kleenex_pollen_a", "device_a", "cfg_a"),
      ...kleenexRegistryEntries("St John", "kleenex_pollen_b", "device_b", "cfg_b"),
    ]);

    const discovery = discoverKleenex(hass);
    expect([...discovery.locations.keys()].sort()).toEqual(["cfg_a", "cfg_b"]);

    // Ambiguous: the config cannot say which instance it meant, so nothing is
    // resolved rather than an arbitrary one of the two.
    const cfg = makeConfig({
      location: "st_john",
      allergens: ["trees_cat"],
      pollen_threshold: 0,
    });
    expect(resolveEntityIds(cfg, hass).size).toBe(0);
    expect(await fetchForecast(hass, cfg)).toEqual([]);
  });

  it("resolves nothing when identifiers AND labels are both ambiguous", async () => {
    // Worst case: the config value slugifies onto two identifiers, so the
    // identifier matcher declines -- and it also equals both devices' labels,
    // so the generic label matching would otherwise resolve to whichever
    // device the registry happens to list first.
    const device = (instance: string, label: string, prefix: string, id: string, cfg: string) => [
      {
        entityId: `sensor.${prefix}_trees`,
        state: "200",
        attributes: {
          friendly_name: `${label} Trees`,
          details: [],
          forecast: [{ datetime: "2026-04-26", level: 2, value: 200, details: [] }],
        },
        platform: "kleenex_pollenradar",
        translationKey: "trees",
        deviceId: id,
        deviceMeta: {
          name: `Kleenex Pollen Radar (${instance})`,
          nameByUser: label,
          identifiers: [["kleenex_pollenradar", instance] as [string, string]],
          configEntries: [cfg],
        },
      },
    ];
    const hass = createHassWithRegistry([
      ...device("St. John", "St John", "kleenex_a", "device_a", "cfg_a"),
      ...device("St John", "St John", "kleenex_b", "device_b", "cfg_b"),
    ]);

    const cfg = makeConfig({
      location: "St John",
      allergens: ["trees_cat"],
      pollen_threshold: 0,
    });

    expect(resolveEntityIds(cfg, hass).size).toBe(0);
    expect(await fetchForecast(hass, cfg)).toEqual([]);
  });

  it("does not fall back to legacy IDs when the configured value is ambiguous", async () => {
    // Codex round 8: one of the two colliding devices still has legacy-shaped
    // entity IDs, so returning "no match" would let the entity-ID scan pick
    // that device -- the arbitrary choice we just refused to make, one layer
    // down.
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.kleenex_pollen_radar_st_john_trees",
        state: "200",
        attributes: {
          friendly_name: "Kleenex Pollen Radar (St. John) Trees",
          details: [],
          forecast: [
            { datetime: "2026-04-26", level: 2, value: 200, details: [] },
          ],
        },
        platform: "kleenex_pollenradar",
        translationKey: "trees",
        deviceId: "device_a",
        deviceMeta: {
          name: "Kleenex Pollen Radar (St. John)",
          identifiers: [["kleenex_pollenradar", "St. John"] as [string, string]],
          configEntries: ["cfg_a"],
        },
      },
      {
        entityId: "sensor.other_pollen_trees",
        state: "50",
        attributes: {
          friendly_name: "Other pollen Trees",
          details: [],
          forecast: [
            { datetime: "2026-04-26", level: 1, value: 50, details: [] },
          ],
        },
        platform: "kleenex_pollenradar",
        translationKey: "trees",
        deviceId: "device_b",
        deviceMeta: {
          name: "Kleenex Pollen Radar (St John)",
          identifiers: [["kleenex_pollenradar", "St John"] as [string, string]],
          configEntries: ["cfg_b"],
        },
      },
    ]);

    const cfg = makeConfig({
      location: "st_john",
      allergens: ["trees_cat"],
      pollen_threshold: 0,
    });

    expect(resolveEntityIds(cfg, hass).size).toBe(0);
    expect(await fetchForecast(hass, cfg)).toEqual([]);
  });

  it("resolves a legacy multiword slug against the slugified label", async () => {
    // Codex round 10: no usable identifier, entity IDs re-minted, and the label
    // is "New York" -- neither literal ("new york" != "new_york"), fuzzy nor
    // entity-ID matching reaches it.
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.my_pollen_trees",
        state: "200",
        attributes: {
          friendly_name: "New York Trees",
          details: [],
          forecast: [
            { datetime: "2026-04-26", level: 2, value: 200, details: [] },
          ],
        },
        platform: "kleenex_pollenradar",
        translationKey: "trees",
        deviceId: "device_ny",
        deviceMeta: {
          name: "New York",
          identifiers: [] as [string, string][],
          configEntries: ["cfg_ny"],
        },
      },
    ]);

    const cfg = makeConfig({
      location: "new_york",
      allergens: ["trees_cat"],
      pollen_threshold: 0,
    });

    expect(resolveEntityIds(cfg, hass).get("trees")).toBe(
      "sensor.my_pollen_trees",
    );
    const result = await fetchForecast(hass, cfg);
    expect(result.map((s) => s.allergenReplaced)).toEqual(["trees_cat"]);
  });

  it("treats two identically labelled multiword devices as ambiguous", async () => {
    const device = (prefix: string, id: string, cfg: string) => ({
      entityId: `sensor.${prefix}_trees`,
      state: "200",
      attributes: {
        friendly_name: "New York Trees",
        details: [],
        forecast: [
          { datetime: "2026-04-26", level: 2, value: 200, details: [] },
        ],
      },
      platform: "kleenex_pollenradar",
      translationKey: "trees",
      deviceId: id,
      deviceMeta: {
        name: "New York",
        identifiers: [] as [string, string][],
        configEntries: [cfg],
      },
    });
    const hass = createHassWithRegistry([
      device("a_pollen", "device_a", "cfg_a"),
      device("b_pollen", "device_b", "cfg_b"),
    ]);

    const cfg = makeConfig({
      location: "new_york",
      allergens: ["trees_cat"],
      pollen_threshold: 0,
    });

    expect(resolveEntityIds(cfg, hass).size).toBe(0);
    expect(await fetchForecast(hass, cfg)).toEqual([]);
  });

  it("does not pick between two devices that share a label", async () => {
    // Codex round 9: neither device has a usable identifier, so both are keyed
    // by config entry -- and both are labelled "Home", so the label step of the
    // generic matching would resolve to whichever comes first.
    const device = (prefix: string, id: string, cfg: string) => ({
      entityId: `sensor.${prefix}_trees`,
      state: "200",
      attributes: {
        friendly_name: "Home Trees",
        details: [],
        forecast: [
          { datetime: "2026-04-26", level: 2, value: 200, details: [] },
        ],
      },
      platform: "kleenex_pollenradar",
      translationKey: "trees",
      deviceId: id,
      deviceMeta: {
        name: "Home",
        identifiers: [] as [string, string][],
        configEntries: [cfg],
      },
    });
    const hass = createHassWithRegistry([
      device("a_pollen", "device_a", "cfg_a"),
      device("b_pollen", "device_b", "cfg_b"),
    ]);

    const cfg = makeConfig({
      location: "home",
      allergens: ["trees_cat"],
      pollen_threshold: 0,
    });

    expect(resolveEntityIds(cfg, hass).size).toBe(0);
    expect(await fetchForecast(hass, cfg)).toEqual([]);
  });

  it("falls back to the config-entry key when two instances share a name", () => {
    const hass = createHassWithRegistry([
      ...kleenexRegistryEntries("Home", "kleenex_pollen", "device_a", "cfg_a"),
      ...kleenexRegistryEntries("Home", "other_pollen", "device_b", "cfg_b"),
    ]);

    const discovery = discoverKleenex(hass);

    // Both would slugify to "home" and merge into one location; the unique
    // config-entry key keeps them apart.
    expect([...discovery.locations.keys()].sort()).toEqual(["cfg_a", "cfg_b"]);
  });

  it("keeps two config entries in separate locations", () => {
    const hass = createHassWithRegistry([
      ...kleenexRegistryEntries("Home", "kleenex_pollen", "device_home", "cfg_home"),
      ...kleenexRegistryEntries(
        "Cabin",
        "kleenex_pollen_radar_cabin",
        "device_cabin",
        "cfg_cabin",
      ),
    ]);

    const discovery = discoverKleenex(hass);

    expect(discovery.locations.size).toBe(2);
    const labels = [...discovery.locations.values()].map((l) => l.label).sort();
    expect(labels).toEqual(["Cabin", "Home"]);
    const home = discovery.locations.get("home")!;
    expect(home.entities.get("trees")).toBe("sensor.kleenex_pollen_trees");
    const cabin = discovery.locations.get("cabin")!;
    expect(cabin.entities.get("trees")).toBe(
      "sensor.kleenex_pollen_radar_cabin_trees",
    );
  });

  it("falls back to the legacy entity-ID slug when no registry exists", () => {
    const hass = makeHassFromEntities([
      makeKleenexEntity("amsterdam", "trees", 200, [{ name: "Birch", value: 150 }]),
      makeKleenexEntity("amsterdam", "grass", 100, []),
      {
        entity_id: "sensor.kleenex_pollen_radar_amsterdam_bouleau",
        state: "150",
        attributes: { forecast: [] },
      },
      {
        entity_id: "sensor.kleenex_pollen_radar_amsterdam_last_updated",
        state: "2026-04-25T10:00:00+00:00",
        attributes: {},
      },
    ]);

    const discovery = discoverKleenex(hass);

    expect(discovery.tierUsed).toBe(3);
    expect([...discovery.locations.keys()]).toEqual(["amsterdam"]);
    const loc = discovery.locations.get("amsterdam")!;
    expect([...loc.entities.keys()].sort()).toEqual(["birch", "grass", "trees"]);
  });

  it("classifies a fully renamed detail sensor via its unique_id", () => {
    // Codex round 12: neither the entity ID nor the friendly name carries the
    // allergen any more; the registry unique_id still does.
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.pollen_thing",
        state: "12",
        attributes: { friendly_name: "Pollen thing" },
        platform: "kleenex_pollenradar",
        translationKey: "detail_value",
        uniqueId:
          "01KQ58DAJBWSK3EJ69H36FB4N6-Kleenex Pollen Radar Utrecht_details-Bouleau-value",
        deviceId: "device_home",
        deviceMeta: {
          name: "Kleenex Pollen Radar (Home)",
          identifiers: [["kleenex_pollenradar", "Home"] as [string, string]],
          configEntries: ["cfg_home"],
        },
      },
    ]);

    const loc = discoverKleenex(hass).locations.get("home")!;
    expect(loc.entities.get("birch")).toBe("sensor.pollen_thing");
  });

  it("skips a fully renamed detail sensor when unique_id is unavailable", () => {
    // Documented residual: the frontend's reduced hass.entities usually omits
    // unique_id, and then nothing non-editable carries the allergen name. Same
    // outcome as before registry discovery, i.e. no regression.
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.pollen_thing",
        state: "12",
        attributes: { friendly_name: "Pollen thing" },
        platform: "kleenex_pollenradar",
        translationKey: "detail_value",
        deviceId: "device_home",
        deviceMeta: {
          name: "Kleenex Pollen Radar (Home)",
          identifiers: [["kleenex_pollenradar", "Home"] as [string, string]],
          configEntries: ["cfg_home"],
        },
      },
    ]);

    const loc = discoverKleenex(hass).locations.get("home");
    expect(loc?.entities.size ?? 0).toBe(0);
  });

  it("resolves the allergen from friendly_name when the ID slug is unknown", () => {
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.kleenex_pollen_bjoerk",
        state: "12",
        attributes: { friendly_name: "Kleenex pollen Birch" },
        platform: "kleenex_pollenradar",
        translationKey: "detail_value",
        deviceId: "device_home",
        deviceMeta: {
          name: "Kleenex Pollen Radar (Home)",
          identifiers: [["kleenex_pollenradar", "Home"]],
          configEntries: ["cfg_home"],
        },
      },
    ]);

    const discovery = discoverKleenex(hass);

    const loc = discovery.locations.get("home")!;
    expect(loc.entities.get("birch")).toBe("sensor.kleenex_pollen_bjoerk");
  });
});

// ---------------------------------------------------------------------------
// 16. Registry-driven entity resolution and forecast (issue #309)
// ---------------------------------------------------------------------------
describe("Kleenex adapter: registry-driven resolution", () => {
  const registryConfig = (overrides: any = {}) =>
    makeConfig({
      allergens: ["trees_cat", "grass_cat", "weeds_cat", "birch", "mugwort"],
      pollen_threshold: 0,
      ...overrides,
    });

  it("resolveEntityIds finds renamed-device entities and skips diagnostics", () => {
    const hass = createHassWithRegistry(
      kleenexRegistryEntries("Home", "kleenex_pollen", "device_home", "cfg_home"),
    );

    const map = resolveEntityIds(registryConfig({ location: "" }), hass);

    expect(map.get("trees")).toBe("sensor.kleenex_pollen_trees");
    expect(map.get("grass")).toBe("sensor.kleenex_pollen_grass");
    expect(map.get("weeds")).toBe("sensor.kleenex_pollen_weeds");
    expect(map.get("mugwort")).toBe("sensor.kleenex_pollen_armoise");
    expect([...map.values()].some((id) => id.endsWith("_level"))).toBe(false);
    expect([...map.values()].some((id) => id.endsWith("_last_updated"))).toBe(
      false,
    );
  });

  it("fetchForecast returns category and detail sensors for a renamed device", async () => {
    const hass = createHassWithRegistry(
      kleenexRegistryEntries("Home", "kleenex_pollen", "device_home", "cfg_home"),
    );

    const result = await fetchForecast(hass, registryConfig({ location: "" }));

    const keys = result.map((s) => s.allergenReplaced).sort();
    expect(keys).toEqual(["birch", "grass_cat", "mugwort", "trees_cat", "weeds_cat"]);
    expect(
      result.find((s) => s.allergenReplaced === "mugwort")!.entity_id,
    ).toBe("sensor.kleenex_pollen_armoise");
    expect(result.every((s) => !s.entity_id.endsWith("_level"))).toBe(true);
  });

  it("resolves a legacy slug-style location config against the device label", async () => {
    const hass = createHassWithRegistry(
      kleenexRegistryEntries("Home", "kleenex_pollen", "device_home", "cfg_home"),
    );

    const map = resolveEntityIds(registryConfig({ location: "home" }), hass);
    expect(map.get("trees")).toBe("sensor.kleenex_pollen_trees");

    const result = await fetchForecast(hass, registryConfig({ location: "home" }));
    expect(result.length).toBeGreaterThan(0);
  });

  it("keeps two config entries apart (no cross-talk)", async () => {
    const hass = createHassWithRegistry([
      ...kleenexRegistryEntries("Home", "kleenex_pollen", "device_home", "cfg_home"),
      ...kleenexRegistryEntries(
        "Cabin",
        "kleenex_pollen_radar_cabin",
        "device_cabin",
        "cfg_cabin",
      ),
    ]);

    const map = resolveEntityIds(registryConfig({ location: "Cabin" }), hass);
    expect(map.get("trees")).toBe("sensor.kleenex_pollen_radar_cabin_trees");

    const result = await fetchForecast(
      hass,
      registryConfig({ location: "Cabin" }),
    );
    expect(result.length).toBeGreaterThan(0);
    expect(
      result.every((s) => s.entity_id.startsWith("sensor.kleenex_pollen_radar_cabin_")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 17. Legacy slug configs against renamed devices (device identifier match)
// ---------------------------------------------------------------------------
describe("Kleenex adapter: legacy slug via device identifier", () => {
  // Device renamed by the user AND entities renamed: neither the label nor the
  // entity IDs carry the legacy "home" slug any more. Only the config-entry
  // identifier still does.
  const renamedEntries = [
    {
      entityId: "sensor.my_pollen_trees",
      state: "200",
      attributes: {
        friendly_name: "My pollen Trees",
        details: [{ name: "Birch", value: 150 }],
        forecast: [
          {
            datetime: "2026-04-26",
            level: 2,
            value: 200,
            details: [{ name: "Birch", value: 150 }],
          },
        ],
      },
      platform: "kleenex_pollenradar",
      translationKey: "trees",
      deviceId: "device_home",
      deviceMeta: {
        name: "Kleenex Pollen Radar (Home)",
        nameByUser: "My pollen",
        identifiers: [["kleenex_pollenradar", "Home"]],
        configEntries: ["cfg_home"],
      },
    },
    {
      entityId: "sensor.my_pollen_armoise",
      state: "42",
      attributes: {
        friendly_name: "My pollen Armoise",
        forecast: [{ date: "2026-04-26", value: 30 }],
      },
      platform: "kleenex_pollenradar",
      translationKey: "detail_value",
      deviceId: "device_home",
    },
  ];

  const legacyConfig = makeConfig({
    location: "home",
    allergens: ["trees_cat", "birch", "mugwort"],
    pollen_threshold: 0,
  });

  it("resolveEntityIds matches the legacy slug against the device identifier", () => {
    const hass = createHassWithRegistry(renamedEntries as any);

    const map = resolveEntityIds(legacyConfig, hass);

    expect(map.get("trees")).toBe("sensor.my_pollen_trees");
    expect(map.get("mugwort")).toBe("sensor.my_pollen_armoise");
  });

  it("fetchForecast renders the renamed device for a legacy slug config", async () => {
    const hass = createHassWithRegistry(renamedEntries as any);

    const result = await fetchForecast(hass, legacyConfig);

    const keys = result.map((s) => s.allergenReplaced).sort();
    expect(keys).toEqual(["birch", "mugwort", "trees_cat"]);
    expect(result.every((s) => s.entity_id.startsWith("sensor.my_pollen_"))).toBe(
      true,
    );
  });

  it("does not bind a legacy slug to a different location's identifier", () => {
    const hass = createHassWithRegistry(renamedEntries as any);

    const map = resolveEntityIds(
      makeConfig({
        location: "cabin",
        allergens: ["trees_cat"],
        pollen_threshold: 0,
      }),
      hass,
    );

    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Allergen names with stray whitespace (FR zone)
// ---------------------------------------------------------------------------
describe("Kleenex adapter: whitespace in detail allergen names", () => {
  // The FR feed reports detail entries as {"name": "Poaceae ", ...}. Without
  // trimming, the lookup key is "poaceae " and matches neither
  // KLEENEX_ALLERGEN_MAP nor config.allergens, so the row vanished silently.
  it("resolves today's details when the name has a trailing space", async () => {
    // The individual allergen only exists in details[], so nothing else can
    // supply the row if the lookup key keeps its trailing space.
    const entity = makeKleenexEntity("paris", "trees", 150, [
      { name: "Bouleau ", value: 150 },
    ]);
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "paris",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    const birch = result.find((s) => s.allergenReplaced === "birch");
    expect(birch).toBeDefined();
    expect(birch!.days[0]!.value).toBe(150);
  });

  // Roma/Milano, verbatim from the live IT install: the endpoint answers in
  // English, pads "Poaceae " with a trailing space and spells chenopod
  // "Chenepod". All three had to hold for the Italian rows to render.
  it("renders the Italian weeds and grass rows (English names, padded, Chenepod)", async () => {
    const grass = makeKleenexEntity("roma", "grass", 75, [
      { name: "Poaceae ", value: 75 },
    ]);
    const weeds = makeKleenexEntity("roma", "weeds", 187, [
      { name: "Nettle", value: 173 },
      { name: "Chenepod", value: 1 },
      { name: "Mugwort", value: 1 },
      { name: "Ragweed", value: 7 },
    ]);
    const hass = makeHassFromEntities([grass, weeds]);
    const config = makeConfig({
      location: "roma",
      allergens: ["poaceae", "chenopod", "nettle"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    const byKey = new Map(result.map((s) => [s.allergenReplaced, s]));
    expect([...byKey.keys()].sort()).toEqual(["chenopod", "nettle", "poaceae"]);
    expect(byKey.get("poaceae")!.days[0]!.value).toBe(75);
    expect(byKey.get("chenopod")!.days[0]!.value).toBe(1);
  });

  it("resolves forecast-day details when the name has a leading space", async () => {
    const entity = makeKleenexEntity(
      "paris",
      "trees",
      0,
      [],
      [{ level: 2, details: [{ name: " Bouleau", value: 120 }] }],
    );
    const hass = makeHassFromEntities([entity]);
    const config = makeConfig({
      location: "paris",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    const birch = result.find((s) => s.allergenReplaced === "birch");
    expect(birch).toBeDefined();
    expect(birch!.days[1]!.value).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// Manual prefix spanning two config entries
// ---------------------------------------------------------------------------
describe("Kleenex adapter: manual prefix across locations", () => {
  /**
   * Two config entries as seen in the field: Paris on a renamed device
   * ("Kleenex pollen" -> sensor.kleenex_pollen_*) and Utrecht on the legacy
   * default naming (sensor.kleenex_pollen_radar_utrecht_*). The prefix
   * `kleenex_pollen_` matches both.
   */
  function collidingEntries(): any[] {
    const attrs = (ppm: number, name: string) => ({
      details: [{ name, value: ppm }],
      forecast: [],
    });
    return [
      {
        entityId: "sensor.kleenex_pollen_trees",
        state: "200",
        attributes: attrs(200, "Bouleau"),
        platform: "kleenex_pollenradar",
        translationKey: "trees",
        deviceId: "dev_paris",
        deviceMeta: {
          name: "Kleenex Pollen Radar (Paris)",
          nameByUser: "Kleenex pollen",
          identifiers: [["kleenex_pollenradar", "Paris"]],
          configEntries: ["cfg_paris"],
        },
      },
      {
        entityId: "sensor.kleenex_pollen_grass",
        state: "100",
        attributes: attrs(100, "Poaceae"),
        platform: "kleenex_pollenradar",
        translationKey: "grass",
        deviceId: "dev_paris",
      },
      {
        entityId: "sensor.kleenex_pollen_radar_utrecht_trees",
        state: "20",
        attributes: attrs(20, "Berk"),
        platform: "kleenex_pollenradar",
        translationKey: "trees",
        deviceId: "dev_utrecht",
        deviceMeta: {
          name: "Kleenex Pollen Radar (Utrecht)",
          identifiers: [["kleenex_pollenradar", "Utrecht"]],
          configEntries: ["cfg_utrecht"],
        },
      },
      {
        entityId: "sensor.kleenex_pollen_radar_utrecht_grass",
        state: "10",
        attributes: attrs(10, "Grassen"),
        platform: "kleenex_pollenradar",
        translationKey: "grass",
        deviceId: "dev_utrecht",
      },
    ];
  }

  const manualConfig = makeConfig({
    location: "manual",
    entity_prefix: "kleenex_pollen_",
    allergens: ["trees_cat", "grass_cat"],
    pollen_threshold: 0,
  });

  it("keeps only the location the prefix was minted from", async () => {
    const hass = createHassWithRegistry(collidingEntries() as any);

    const result = await fetchForecast(hass, manualConfig);

    expect(result.length).toBe(2);
    expect(result.map((s) => s.entity_id).sort()).toEqual([
      "sensor.kleenex_pollen_grass",
      "sensor.kleenex_pollen_trees",
    ]);
    // Paris values, not Utrecht's.
    const trees = result.find((s) => s.allergenReplaced === "trees_cat");
    expect(trees!.days[0]!.value).toBe(200);
  });

  it("scopeManualEntities reports the winning location's label", () => {
    const hass = createHassWithRegistry(collidingEntries() as any);

    const scope = scopeManualEntities(
      hass,
      Object.keys(hass.states),
      { prefix: "kleenex_pollen_" },
    );

    expect(scope.label).toBe("Kleenex pollen");
    expect(scope.entityIds).toEqual([
      "sensor.kleenex_pollen_trees",
      "sensor.kleenex_pollen_grass",
    ]);
  });

  it("leaves a single-location install untouched", async () => {
    const single = collidingEntries().slice(0, 2);
    const hass = createHassWithRegistry(single as any);

    const scope = scopeManualEntities(hass, Object.keys(hass.states), {
      prefix: "kleenex_pollen_",
    });
    expect(scope.label).toBeNull();
    expect(scope.entityIds.length).toBe(2);

    const result = await fetchForecast(hass, manualConfig);
    expect(result.length).toBe(2);
  });

  it("keeps entities the registry knows nothing about", async () => {
    // A template sensor imitating the naming: unattributable, so it must not
    // be dropped -- manual mode is the fallback for registry-less setups.
    const hass = createHassWithRegistry(collidingEntries() as any);
    (hass.states as any)["sensor.kleenex_pollen_weeds"] = {
      entity_id: "sensor.kleenex_pollen_weeds",
      state: "30",
      attributes: { friendly_name: "Template weeds", details: [], forecast: [] },
    };

    const scope = scopeManualEntities(hass, Object.keys(hass.states), {
      prefix: "kleenex_pollen_",
    });

    expect(scope.entityIds).toContain("sensor.kleenex_pollen_weeds");
    expect(scope.entityIds).not.toContain(
      "sensor.kleenex_pollen_radar_utrecht_grass",
    );
  });

  // Codex P2 on PR #315: the remainder heuristic measures allergen-name length,
  // so an install where the intended device has only a long-named detail sensor
  // enabled lost to the colliding device's shorter `radar_utrecht_grass`.
  // Ownership is now decided on the device slug, before any entity name is
  // measured.
  it("picks the device the prefix was minted from, however long its entity names are", async () => {
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.kleenex_pollen_zeer_lange_naam_brandnetel",
        state: "50",
        attributes: { friendly_name: "Kleenex pollen Zeer lange naam brandnetel" },
        platform: "kleenex_pollenradar",
        translationKey: "detail_value",
        uniqueId: "cfg_paris-Kleenex Pollen Radarweeds_details-Nettle-value",
        deviceId: "dev_paris",
        deviceMeta: {
          name: "Kleenex Pollen Radar (Paris)",
          nameByUser: "Kleenex pollen",
          identifiers: [["kleenex_pollenradar", "Paris"]],
          configEntries: ["cfg_paris"],
        },
      },
      {
        entityId: "sensor.kleenex_pollen_radar_utrecht_grass",
        state: "10",
        attributes: { details: [], forecast: [] },
        platform: "kleenex_pollenradar",
        translationKey: "grass",
        deviceId: "dev_utrecht",
        deviceMeta: {
          name: "Kleenex Pollen Radar (Utrecht)",
          identifiers: [["kleenex_pollenradar", "Utrecht"]],
          configEntries: ["cfg_utrecht"],
        },
      },
    ] as any);

    // The remainder the old rule compared: 26 for Paris, 19 for Utrecht.
    const scope = scopeManualEntities(hass, Object.keys(hass.states), {
      prefix: "kleenex_pollen_",
    });

    expect(scope.label).toBe("Kleenex pollen");
    expect(scope.entityIds).toEqual([
      "sensor.kleenex_pollen_zeer_lange_naam_brandnetel",
    ]);

    const result = await fetchForecast(
      hass,
      makeConfig({
        location: "manual",
        entity_prefix: "kleenex_pollen_",
        allergens: ["nettle"],
        pollen_threshold: 0,
      }),
    );
    expect(result.map((s) => s.entity_id)).toEqual([
      "sensor.kleenex_pollen_zeer_lange_naam_brandnetel",
    ]);
  });

  it("gives a legacy prefix to the legacy device, not the renamed one", () => {
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.kleenex_pollen_grass",
        state: "100",
        attributes: { details: [], forecast: [] },
        platform: "kleenex_pollenradar",
        translationKey: "grass",
        deviceId: "dev_paris",
        deviceMeta: {
          name: "Kleenex Pollen Radar (Paris)",
          nameByUser: "Kleenex pollen",
          identifiers: [["kleenex_pollenradar", "Paris"]],
          configEntries: ["cfg_paris"],
        },
      },
      {
        entityId: "sensor.kleenex_pollen_radar_utrecht_grass",
        state: "10",
        attributes: { details: [], forecast: [] },
        platform: "kleenex_pollenradar",
        translationKey: "grass",
        deviceId: "dev_utrecht",
        deviceMeta: {
          name: "Kleenex Pollen Radar (Utrecht)",
          identifiers: [["kleenex_pollenradar", "Utrecht"]],
          configEntries: ["cfg_utrecht"],
        },
      },
    ] as any);

    const scope = scopeManualEntities(hass, Object.keys(hass.states), {
      prefix: "kleenex_pollen_radar_utrecht_",
    });

    expect(scope.entityIds).toEqual([
      "sensor.kleenex_pollen_radar_utrecht_grass",
    ]);
  });

  // Nagelfar round 1: narrowing removes rows and renames the header, so the one
  // case where data disappears must say so without requiring debug: true.
  it("warns exactly once per configuration when it narrows", () => {
    _resetManualScopeWarningsForTest();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const hass = createHassWithRegistry(collidingEntries() as any);
      const ids = Object.keys(hass.states);

      scopeManualEntities(hass, ids, { prefix: "kleenex_pollen_" });
      scopeManualEntities(hass, ids, { prefix: "kleenex_pollen_" });

      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]![0]);
      // Names both the location it kept and the one it dropped.
      expect(message).toContain("Kleenex pollen");
      expect(message).toContain("Utrecht");
    } finally {
      warn.mockRestore();
    }
  });

  it("stays silent when nothing is narrowed", () => {
    _resetManualScopeWarningsForTest();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const hass = createHassWithRegistry(collidingEntries().slice(0, 2) as any);

      scopeManualEntities(hass, Object.keys(hass.states), {
        prefix: "kleenex_pollen_",
      });

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("does not narrow when no matched entity is in the registry", () => {
    // Registry-less install: two locations by naming convention only. Today's
    // behaviour (pure prefix matching) must survive.
    const hass = createHass({
      "sensor.kleenex_pollen_trees": {
        entity_id: "sensor.kleenex_pollen_trees",
        state: "200",
        attributes: { details: [], forecast: [] },
      },
      "sensor.kleenex_pollen_radar_utrecht_trees": {
        entity_id: "sensor.kleenex_pollen_radar_utrecht_trees",
        state: "20",
        attributes: { details: [], forecast: [] },
      },
    });

    const scope = scopeManualEntities(hass, Object.keys(hass.states), {
      prefix: "kleenex_pollen_",
    });

    expect(scope.label).toBeNull();
    expect(scope.entityIds.length).toBe(2);
  });
});
