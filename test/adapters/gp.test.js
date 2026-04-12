import { describe, it, expect } from "vitest";
import {
  fetchForecast,
  stubConfigGP,
  GP_BASE_ALLERGENS,
  GP_DOMAIN,
  discoverGpSensors,
} from "../../src/adapters/gp/index.js";
import { createHass, assertSensorShape } from "../helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides = {}) {
  return { ...stubConfigGP, ...overrides };
}

/**
 * Build a google_pollen sensor with display_name and flat forecast attributes.
 * @param {string} displayName - Human-readable allergen name (e.g. "Birch", "Grass")
 * @param {number} indexValue - UPI 0-5 for today
 * @param {Object} forecast - { tomorrow, "day 3", "day 4" } numeric values
 * @param {Object} attrOverrides - Additional attribute overrides
 */
function makeSensor(displayName, indexValue, forecast = {}, attrOverrides = {}) {
  return {
    state: indexValue >= 0 ? "Moderate" : "No data",
    attributes: {
      display_name: displayName,
      index_value: indexValue,
      category: "Moderate",
      in_season: "True",
      icon: "mdi:flower-pollen",
      device_class: "enum",
      ...forecast,
      ...attrOverrides,
    },
  };
}

/**
 * Build a hass mock using entity prefix fallback (no hass.entities).
 */
function makeHassFallback(statesMap) {
  return createHass(statesMap, { entities: undefined });
}

/**
 * Build a hass mock with hass.entities (primary path).
 */
function makeHassPrimary(statesMap, entitiesMap, devicesMap = {}) {
  const entities = {};
  for (const [eid, info] of Object.entries(entitiesMap)) {
    entities[eid] = {
      entity_id: eid,
      platform: GP_DOMAIN,
      device_id: info.device_id || null,
      entity_category: null,
    };
  }
  return {
    ...createHass(statesMap),
    entities,
    devices: devicesMap,
  };
}

// ---------------------------------------------------------------------------
// Constants and stubConfig
// ---------------------------------------------------------------------------

describe("GP_BASE_ALLERGENS", () => {
  it("contains exactly three category allergens", () => {
    expect(GP_BASE_ALLERGENS).toEqual(["grass_cat", "trees_cat", "weeds_cat"]);
  });
});

describe("stubConfigGP", () => {
  it("has integration field set to 'gp'", () => {
    expect(stubConfigGP.integration).toBe("gp");
  });

  it("includes all three base allergens", () => {
    for (const allergen of GP_BASE_ALLERGENS) {
      expect(stubConfigGP.allergens).toContain(allergen);
    }
  });

  it("has days_to_show defaulting to 4", () => {
    expect(stubConfigGP.days_to_show).toBe(4);
  });

  it("has sort_category_allergens_first defaulting to true", () => {
    expect(stubConfigGP.sort_category_allergens_first).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// discoverGpSensors
// ---------------------------------------------------------------------------

describe("discoverGpSensors: prefix fallback path", () => {
  it("returns empty locations when hass is null", () => {
    const result = discoverGpSensors(null);
    expect(result.locations.size).toBe(0);
  });

  it("returns empty locations when no google_pollen sensors exist", () => {
    const hass = makeHassFallback({
      "sensor.some_other_sensor": {
        state: "3",
        attributes: { display_name: "Birch" },
      },
    });
    const result = discoverGpSensors(hass);
    expect(result.locations.size).toBe(0);
  });

  it("detects a category sensor via display_name 'Grass' -> grass_cat", () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_grass": makeSensor("Grass", 3),
    });
    const result = discoverGpSensors(hass);

    expect(result.locations.size).toBeGreaterThan(0);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.has("grass_cat")).toBe(true);
  });

  it("detects 'Tree' -> trees_cat and 'Weed' -> weeds_cat", () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_tree": makeSensor("Tree", 2),
      "sensor.google_pollen_weed": makeSensor("Weed", 1),
    });
    const result = discoverGpSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.has("trees_cat")).toBe(true);
    expect(loc.entities.has("weeds_cat")).toBe(true);
  });

  it("detects a plant sensor via display_name 'Birch' -> birch", () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_birch": makeSensor("Birch", 4),
    });
    const result = discoverGpSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.has("birch")).toBe(true);
    expect(loc.entities.get("birch")).toBe("sensor.google_pollen_birch");
  });

  it("normalizes multi-word display_name 'Cypress Pine' -> cypress", () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_cypress_pine": makeSensor("Cypress Pine", 2),
    });
    const result = discoverGpSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.has("cypress")).toBe(true);
  });

  it("normalizes 'Cottonwood' -> poplar via ALLERGEN_TRANSLATION", () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_cottonwood": makeSensor("Cottonwood", 1),
    });
    const result = discoverGpSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.has("poplar")).toBe(true);
  });

  it("groups multiple sensors under a single location", () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_grass": makeSensor("Grass", 3),
      "sensor.google_pollen_birch": makeSensor("Birch", 4),
      "sensor.google_pollen_tree": makeSensor("Tree", 2),
    });
    const result = discoverGpSensors(hass);
    expect(result.locations.size).toBe(1);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.size).toBe(3);
  });

  it("skips sensors without display_name", () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_unknown": {
        state: "Moderate",
        attributes: { icon: "mdi:flower-pollen" },
      },
    });
    const result = discoverGpSensors(hass);
    expect(result.locations.size).toBe(0);
  });
});

describe("discoverGpSensors: primary path (hass.entities)", () => {
  it("uses hass.entities when platform === 'google_pollen' sensors exist", () => {
    const statesMap = {
      "sensor.google_pollen_grass": makeSensor("Grass", 3),
    };
    const entitiesMap = {
      "sensor.google_pollen_grass": { device_id: "dev1" },
    };
    const hass = makeHassPrimary(statesMap, entitiesMap);
    const result = discoverGpSensors(hass);

    expect(result.locations.size).toBeGreaterThan(0);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.has("grass_cat")).toBe(true);
  });

  it("resolves config_entry_id from device", () => {
    const statesMap = {
      "sensor.google_pollen_birch": makeSensor("Birch", 4),
    };
    const entitiesMap = {
      "sensor.google_pollen_birch": { device_id: "dev1" },
    };
    const devicesMap = {
      dev1: { name: "Google Pollen", config_entries: ["entry-gp-123"] },
    };
    const hass = makeHassPrimary(statesMap, entitiesMap, devicesMap);
    const result = discoverGpSensors(hass);

    expect(result.locations.has("entry-gp-123")).toBe(true);
    expect(result.locations.get("entry-gp-123").label).toBe("Google Pollen");
  });

  it("excludes entities with entity_category set", () => {
    const statesMap = {
      "sensor.google_pollen_grass": makeSensor("Grass", 3),
      "sensor.google_pollen_diag": makeSensor("Grass", 0),
    };
    const entities = {
      "sensor.google_pollen_grass": {
        entity_id: "sensor.google_pollen_grass",
        platform: GP_DOMAIN,
        device_id: "dev1",
        entity_category: null,
      },
      "sensor.google_pollen_diag": {
        entity_id: "sensor.google_pollen_diag",
        platform: GP_DOMAIN,
        device_id: "dev1",
        entity_category: "diagnostic",
      },
    };
    const hass = { ...createHass(statesMap), entities, devices: {} };
    const result = discoverGpSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.size).toBe(1);
    expect(loc.entities.has("grass_cat")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// discoverGpSensors: unique_id classification (language-independent)
// ---------------------------------------------------------------------------

describe("discoverGpSensors: unique_id classification", () => {
  it("classifies via unique_id when display_name is localized (Swedish)", () => {
    const statesMap = {
      "sensor.google_pollen_svenove_bjork": makeSensor("Björk", 4),
      "sensor.google_pollen_svenove_trad": makeSensor("Träd", 2),
      "sensor.google_pollen_svenove_ogras": makeSensor("Ogräs", 1),
    };
    const entities = {
      "sensor.google_pollen_svenove_bjork": {
        entity_id: "sensor.google_pollen_svenove_bjork",
        platform: GP_DOMAIN,
        device_id: "dev1",
        entity_category: null,
        unique_id: "google_pollen_birch_59.3773_13.5313",
      },
      "sensor.google_pollen_svenove_trad": {
        entity_id: "sensor.google_pollen_svenove_trad",
        platform: GP_DOMAIN,
        device_id: "dev1",
        entity_category: null,
        unique_id: "google_pollen_tree_59.3773_13.5313",
      },
      "sensor.google_pollen_svenove_ogras": {
        entity_id: "sensor.google_pollen_svenove_ogras",
        platform: GP_DOMAIN,
        device_id: "dev1",
        entity_category: null,
        unique_id: "google_pollen_weed_59.3773_13.5313",
      },
    };
    const hass = { ...createHass(statesMap), entities, devices: {} };
    const result = discoverGpSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.has("birch")).toBe(true);
    expect(loc.entities.has("trees_cat")).toBe(true);
    expect(loc.entities.has("weeds_cat")).toBe(true);
  });

  it("distinguishes category 'Gräs' from plant 'Gräs' via unique_id", () => {
    const statesMap = {
      "sensor.google_pollen_svenove_gras": makeSensor("Gräs", 3),
      "sensor.google_pollen_svenove_gras_2": makeSensor("Gräs", 2),
    };
    const entities = {
      "sensor.google_pollen_svenove_gras": {
        entity_id: "sensor.google_pollen_svenove_gras",
        platform: GP_DOMAIN,
        device_id: "dev1",
        entity_category: null,
        unique_id: "google_pollen_graminales_59.3773_13.5313",
      },
      "sensor.google_pollen_svenove_gras_2": {
        entity_id: "sensor.google_pollen_svenove_gras_2",
        platform: GP_DOMAIN,
        device_id: "dev1",
        entity_category: null,
        unique_id: "google_pollen_grass_59.3773_13.5313",
      },
    };
    const hass = { ...createHass(statesMap), entities, devices: {} };
    const result = discoverGpSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.has("graminales")).toBe(true);
    expect(loc.entities.has("grass_cat")).toBe(true);
    expect(loc.entities.size).toBe(2);
  });

  it("handles multi-word pollen codes like cypress_pine", () => {
    const statesMap = {
      "sensor.google_pollen_cp": makeSensor("Cypress Pine", 1),
    };
    const entities = {
      "sensor.google_pollen_cp": {
        entity_id: "sensor.google_pollen_cp",
        platform: GP_DOMAIN,
        device_id: "dev1",
        entity_category: null,
        unique_id: "google_pollen_cypress_pine_59.3773_13.5313",
      },
    };
    const hass = { ...createHass(statesMap), entities, devices: {} };
    const result = discoverGpSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.has("cypress_pine")).toBe(true);
  });

  it("handles negative coordinates in unique_id", () => {
    const statesMap = {
      "sensor.google_pollen_birch": makeSensor("Birch", 3),
    };
    const entities = {
      "sensor.google_pollen_birch": {
        entity_id: "sensor.google_pollen_birch",
        platform: GP_DOMAIN,
        device_id: "dev1",
        entity_category: null,
        unique_id: "google_pollen_birch_-33.8688_151.2093",
      },
    };
    const hass = { ...createHass(statesMap), entities, devices: {} };
    const result = discoverGpSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.has("birch")).toBe(true);
  });

  it("falls back to display_name with slugify when unique_id is absent", () => {
    const statesMap = {
      "sensor.google_pollen_svenove_bjork": makeSensor("Björk", 4),
    };
    const entities = {
      "sensor.google_pollen_svenove_bjork": {
        entity_id: "sensor.google_pollen_svenove_bjork",
        platform: GP_DOMAIN,
        device_id: "dev1",
        entity_category: null,
        // no unique_id
      },
    };
    const hass = { ...createHass(statesMap), entities, devices: {} };
    const result = discoverGpSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    // slugify("Björk") -> "bjork" -> PP_ALIASES -> "birch"
    expect(loc.entities.has("birch")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: basic shape
// ---------------------------------------------------------------------------

describe("fetchForecast: basic shape", () => {
  it("returns an array of sensor dicts with required fields", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_grass": makeSensor("Grass", 3, { tomorrow: 2 }),
      "sensor.google_pollen_birch": makeSensor("Birch", 4, { tomorrow: 3 }),
    });
    const config = makeConfig({
      allergens: ["grass_cat", "birch"],
      pollen_threshold: 0,
      days_to_show: 2,
    });

    const result = await fetchForecast(hass, config);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    for (const sensor of result) {
      assertSensorShape(sensor, { minDays: 1 });
    }
  });

  it("sets allergenReplaced to the allergen key", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_grass": makeSensor("Grass", 2),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);
    expect(result[0].allergenReplaced).toBe("grass_cat");
  });

  it("sets entity_id on each sensor dict", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_birch": makeSensor("Birch", 2),
    });
    const config = makeConfig({
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);
    expect(result[0].entity_id).toBe("sensor.google_pollen_birch");
  });

  it("each day object has required properties", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_grass": makeSensor("Grass", 3),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);
    const day = result[0].day0;

    expect(day).toHaveProperty("name");
    expect(day).toHaveProperty("day");
    expect(day).toHaveProperty("state");
    expect(day).toHaveProperty("display_state");
    expect(day).toHaveProperty("state_text");
    expect(typeof day.name).toBe("string");
    expect(typeof day.day).toBe("string");
    expect(typeof day.state).toBe("number");
    expect(typeof day.state_text).toBe("string");
  });

  it("respects days_to_show", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_birch": makeSensor("Birch", 3, {
        tomorrow: 2, "day 3": 1, "day 4": 0,
      }),
    });
    const config = makeConfig({
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 3,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].days.length).toBe(3);
    expect(result[0].day2).toBeDefined();
    expect(result[0].day3).toBeUndefined();
  });

  it("returns empty array when no matching sensors exist", async () => {
    const hass = makeHassFallback({});
    const config = makeConfig({
      allergens: ["grass_cat", "birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);
    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: reading flat forecast attributes
// ---------------------------------------------------------------------------

describe("fetchForecast: flat forecast attributes", () => {
  it("reads today from index_value, tomorrow, day 3, day 4", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_birch": makeSensor("Birch", 2, {
        tomorrow: 4,
        "day 3": 1,
        "day 4": 3,
      }),
    });
    const config = makeConfig({
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 4,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(2);
    expect(result[0].day1.state).toBe(4);
    expect(result[0].day2.state).toBe(1);
    expect(result[0].day3.state).toBe(3);
  });

  it("pads missing forecast days with state=-1", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_grass": makeSensor("Grass", 3),
      // No forecast attributes
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 3,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].days.length).toBe(3);
    expect(result[0].day0.state).toBe(3);
    expect(result[0].day1.state).toBe(-1);
    expect(result[0].day2.state).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: level scaling (0-5 native to 0-6 display)
// ---------------------------------------------------------------------------

describe("fetchForecast: level scaling (0-5 to 0-6)", () => {
  const scalingCases = [
    [0, 0],
    [1, 1],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 6],
  ];

  for (const [nativeLevel, expectedScaled] of scalingCases) {
    it(`native level ${nativeLevel} produces state_text for scaled level ${expectedScaled}`, async () => {
      const hass = makeHassFallback({
        "sensor.google_pollen_grass": makeSensor("Grass", nativeLevel),
      });
      const config = makeConfig({
        allergens: ["grass_cat"],
        pollen_threshold: 0,
        days_to_show: 1,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].day0.state).toBe(nativeLevel);
      expect(typeof result[0].day0.state_text).toBe("string");
      expect(result[0].day0.state_text.length).toBeGreaterThan(0);
    });
  }

  it("state_text for native level 5 differs from native level 0", async () => {
    const hassHigh = makeHassFallback({
      "sensor.google_pollen_grass": makeSensor("Grass", 5),
    });
    const hassLow = makeHassFallback({
      "sensor.google_pollen_grass": makeSensor("Grass", 0),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const resultHigh = await fetchForecast(hassHigh, config);
    const resultLow = await fetchForecast(hassLow, config);

    expect(resultHigh[0].day0.state_text).not.toBe(resultLow[0].day0.state_text);
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: NaN / negative / out-of-range handling
// ---------------------------------------------------------------------------

describe("fetchForecast: NaN/negative/out-of-range handling", () => {
  it("returns state=-1 for NaN index_value", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_grass": makeSensor("Grass", NaN),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);
    expect(result[0].day0.state).toBe(-1);
  });

  it("returns state=-1 for negative index_value", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_grass": makeSensor("Grass", -3),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);
    expect(result[0].day0.state).toBe(-1);
  });

  it("clamps index_value above 5 to 5", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_grass": makeSensor("Grass", 10),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);
    expect(result[0].day0.state).toBe(5);
  });

  it("returns state=-1 for undefined forecast attribute", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_grass": makeSensor("Grass", 3),
      // tomorrow attribute not set
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 2,
    });

    const result = await fetchForecast(hass, config);
    expect(result[0].day0.state).toBe(3);
    expect(result[0].day1.state).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: threshold filtering
// ---------------------------------------------------------------------------

describe("fetchForecast: threshold filtering", () => {
  it("excludes allergens where all days are below threshold", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_grass": makeSensor("Grass", 3, { tomorrow: 2 }),
      "sensor.google_pollen_birch": makeSensor("Birch", 0, { tomorrow: 0 }),
    });
    const config = makeConfig({
      allergens: ["grass_cat", "birch"],
      pollen_threshold: 1,
      days_to_show: 2,
    });

    const result = await fetchForecast(hass, config);
    expect(result.length).toBe(1);
    expect(result[0].allergenReplaced).toBe("grass_cat");
  });

  it("includes all allergens when pollen_threshold is 0", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_grass": makeSensor("Grass", 0),
      "sensor.google_pollen_birch": makeSensor("Birch", 0),
    });
    const config = makeConfig({
      allergens: ["grass_cat", "birch"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);
    expect(result.length).toBe(2);
  });

  it("includes allergen if any forecast day meets threshold", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_birch": makeSensor("Birch", 0, {
        tomorrow: 0,
        "day 3": 3,
      }),
    });
    const config = makeConfig({
      allergens: ["birch"],
      pollen_threshold: 2,
      days_to_show: 3,
    });

    const result = await fetchForecast(hass, config);
    expect(result.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: sort_category_allergens_first
// ---------------------------------------------------------------------------

describe("fetchForecast: sort_category_allergens_first", () => {
  it("places category allergens before plant allergens", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_birch": makeSensor("Birch", 5),
      "sensor.google_pollen_oak": makeSensor("Oak", 4),
      "sensor.google_pollen_grass": makeSensor("Grass", 1),
      "sensor.google_pollen_tree": makeSensor("Tree", 0),
    });
    const config = makeConfig({
      allergens: ["birch", "oak", "grass_cat", "trees_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
      sort: "value_descending",
      sort_category_allergens_first: true,
    });

    const result = await fetchForecast(hass, config);
    const keys = result.map((s) => s.allergenReplaced);

    const categoryIndices = keys
      .map((k, i) => (GP_BASE_ALLERGENS.includes(k) ? i : -1))
      .filter((i) => i >= 0);
    const plantIndices = keys
      .map((k, i) => (!GP_BASE_ALLERGENS.includes(k) ? i : -1))
      .filter((i) => i >= 0);

    for (const ci of categoryIndices) {
      for (const pi of plantIndices) {
        expect(ci).toBeLessThan(pi);
      }
    }
  });

  it("treats all allergens as one group when disabled", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_oak": makeSensor("Oak", 5),
      "sensor.google_pollen_grass": makeSensor("Grass", 1),
    });
    const config = makeConfig({
      allergens: ["oak", "grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
      sort: "value_descending",
      sort_category_allergens_first: false,
    });

    const result = await fetchForecast(hass, config);
    expect(result[0].allergenReplaced).toBe("oak");
    expect(result[1].allergenReplaced).toBe("grass_cat");
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: sorting modes
// ---------------------------------------------------------------------------

describe("fetchForecast: sorting modes", () => {
  it("sorts by value_ascending: lowest day0 first", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_birch": makeSensor("Birch", 4),
      "sensor.google_pollen_oak": makeSensor("Oak", 1),
      "sensor.google_pollen_alder": makeSensor("Alder", 3),
    });
    const config = makeConfig({
      allergens: ["birch", "oak", "alder"],
      pollen_threshold: 0,
      days_to_show: 1,
      sort: "value_ascending",
      sort_category_allergens_first: false,
    });

    const result = await fetchForecast(hass, config);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].day0.state).toBeLessThanOrEqual(result[i + 1].day0.state);
    }
  });

  it("preserves original order when sort is 'none'", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_oak": makeSensor("Oak", 1),
      "sensor.google_pollen_birch": makeSensor("Birch", 3),
      "sensor.google_pollen_alder": makeSensor("Alder", 2),
    });
    const config = makeConfig({
      allergens: ["oak", "birch", "alder"],
      pollen_threshold: 0,
      days_to_show: 1,
      sort: "none",
      sort_category_allergens_first: false,
    });

    const result = await fetchForecast(hass, config);
    expect(result[0].allergenReplaced).toBe("oak");
    expect(result[1].allergenReplaced).toBe("birch");
    expect(result[2].allergenReplaced).toBe("alder");
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: user phrase overrides
// ---------------------------------------------------------------------------

describe("fetchForecast: user phrase overrides", () => {
  it("uses full phrase override for allergenCapitalized", async () => {
    const hass = makeHassFallback({
      "sensor.google_pollen_grass": makeSensor("Grass", 2),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
      phrases: {
        full: { grass_cat: "My Custom Grass" },
        short: {},
        levels: [],
        days: {},
        no_information: "",
      },
    });

    const result = await fetchForecast(hass, config);
    expect(result[0].allergenCapitalized).toBe("My Custom Grass");
  });
});
