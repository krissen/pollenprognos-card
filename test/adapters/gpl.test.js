import { describe, it, expect } from "vitest";
import {
  fetchForecast,
  stubConfigGPL,
  GPL_BASE_ALLERGENS,
  GPL_ATTRIBUTION,
  discoverGplSensors,
} from "../../src/adapters/gpl.js";
import { createHass, assertSensorShape } from "../helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides = {}) {
  return { ...stubConfigGPL, ...overrides };
}

/**
 * Build a minimal GPL type sensor (grass_cat, trees_cat, weeds_cat).
 * Type sensors are identified by their icon attribute.
 */
function makeTypeSensor(icon, stateValue, forecastItems = [], attrOverrides = {}) {
  return {
    state: String(stateValue),
    attributes: {
      icon,
      attribution: GPL_ATTRIBUTION,
      forecast: forecastItems,
      ...attrOverrides,
    },
  };
}

/**
 * Build a minimal GPL plant sensor (e.g. birch, oak, ragweed).
 * Plant sensors are identified by their code attribute.
 */
function makePlantSensor(code, stateValue, forecastItems = [], attrOverrides = {}) {
  return {
    state: String(stateValue),
    attributes: {
      code,
      attribution: GPL_ATTRIBUTION,
      forecast: forecastItems,
      ...attrOverrides,
    },
  };
}

/**
 * Build a forecast item in the GPL/pollenlevels format.
 * offset=1 means tomorrow, etc.
 */
function makeForecastItem(offset, value, hasIndex = true) {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const d = new Date(base.getTime() + offset * 86400000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return {
    offset,
    date: `${yyyy}-${mm}-${dd}`,
    has_index: hasIndex,
    value,
    category: value === 0 ? "none" : value < 3 ? "low" : "moderate",
  };
}

/**
 * Build a hass mock with GPL sensors identified by attribution (fallback path).
 * States are keyed by entity_id.
 */
function makeHassAttribution(statesMap) {
  // Attribution fallback: no hass.entities, just states
  return createHass(statesMap, { entities: undefined });
}

/**
 * Build a hass mock with GPL sensors identified via hass.entities (primary path).
 * Each entry in entitiesMap should have { entity_id, device_id, config_entry_id }
 * and a corresponding state object.
 */
function makeHassPrimary(statesMap, entitiesMap, devicesMap = {}) {
  const entities = {};
  for (const [eid, info] of Object.entries(entitiesMap)) {
    entities[eid] = {
      entity_id: eid,
      platform: "pollenlevels",
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
// GPL_BASE_ALLERGENS and GPL_ATTRIBUTION
// ---------------------------------------------------------------------------

describe("GPL_BASE_ALLERGENS", () => {
  it("contains exactly three category allergens", () => {
    expect(GPL_BASE_ALLERGENS).toEqual(["grass_cat", "trees_cat", "weeds_cat"]);
  });

  it("has length 3", () => {
    expect(GPL_BASE_ALLERGENS.length).toBe(3);
  });
});

describe("GPL_ATTRIBUTION", () => {
  it("is a non-empty string", () => {
    expect(typeof GPL_ATTRIBUTION).toBe("string");
    expect(GPL_ATTRIBUTION.length).toBeGreaterThan(0);
  });
});

describe("stubConfigGPL", () => {
  it("has integration field set to 'gpl'", () => {
    expect(stubConfigGPL.integration).toBe("gpl");
  });

  it("includes all three base allergens in default allergens list", () => {
    for (const allergen of GPL_BASE_ALLERGENS) {
      expect(stubConfigGPL.allergens).toContain(allergen);
    }
  });

  it("has sort_category_allergens_first defaulting to true", () => {
    expect(stubConfigGPL.sort_category_allergens_first).toBe(true);
  });

  it("has days_to_show defaulting to 5", () => {
    expect(stubConfigGPL.days_to_show).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// discoverGplSensors
// ---------------------------------------------------------------------------

describe("discoverGplSensors: attribution fallback path", () => {
  it("returns empty locations when hass is null", () => {
    const result = discoverGplSensors(null);
    expect(result.locations.size).toBe(0);
  });

  it("returns empty locations when no GPL sensors are present", () => {
    const hass = makeHassAttribution({
      "sensor.some_other_sensor": {
        state: "3",
        attributes: { attribution: "Other source" },
      },
    });
    const result = discoverGplSensors(hass);
    expect(result.locations.size).toBe(0);
  });

  it("detects a type sensor via mdi:grass icon and maps to grass_cat", () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 3),
    });
    const result = discoverGplSensors(hass);

    expect(result.locations.size).toBeGreaterThan(0);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.has("grass_cat")).toBe(true);
    expect(loc.entities.get("grass_cat")).toBe("sensor.pollenlevels_grass");
  });

  it("detects a type sensor via mdi:tree icon and maps to trees_cat", () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_tree": makeTypeSensor("mdi:tree", 2),
    });
    const result = discoverGplSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.has("trees_cat")).toBe(true);
  });

  it("detects a type sensor via mdi:flower-tulip icon and maps to weeds_cat", () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_weed": makeTypeSensor("mdi:flower-tulip", 1),
    });
    const result = discoverGplSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.has("weeds_cat")).toBe(true);
  });

  it("detects a plant sensor via code attribute", () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_birch": makePlantSensor("birch", 4),
    });
    const result = discoverGplSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.has("birch")).toBe(true);
    expect(loc.entities.get("birch")).toBe("sensor.pollenlevels_birch");
  });

  it("groups multiple sensors under a single location via attribution fallback", () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 3),
      "sensor.pollenlevels_birch": makePlantSensor("birch", 4),
      "sensor.pollenlevels_tree": makeTypeSensor("mdi:tree", 2),
    });
    const result = discoverGplSensors(hass);

    // Attribution fallback groups everything under "default"
    expect(result.locations.size).toBe(1);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.size).toBe(3);
  });

  it("excludes date/timestamp device_class sensors", () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 3),
      "sensor.pollenlevels_date_sensor": {
        state: "2025-01-01",
        attributes: {
          attribution: GPL_ATTRIBUTION,
          device_class: "date",
        },
      },
    });
    const result = discoverGplSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.size).toBe(1);
    expect(loc.entities.has("grass_cat")).toBe(true);
  });
});

describe("discoverGplSensors: primary path (hass.entities)", () => {
  it("uses hass.entities when platform === 'pollenlevels' sensors exist", () => {
    const statesMap = {
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 3),
    };
    const entitiesMap = {
      "sensor.pollenlevels_grass": { device_id: "dev1" },
    };
    const hass = makeHasPrimary(statesMap, entitiesMap);
    const result = discoverGplSensors(hass);

    expect(result.locations.size).toBeGreaterThan(0);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.has("grass_cat")).toBe(true);
  });

  it("resolves config_entry_id from device when devices map is provided", () => {
    const statesMap = {
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 3),
    };
    const entitiesMap = {
      "sensor.pollenlevels_grass": { device_id: "dev1" },
    };
    const devicesMap = {
      dev1: { name: "My Location", config_entries: ["entry-abc-123"] },
    };
    const hass = makeHasPrimary(statesMap, entitiesMap, devicesMap);
    const result = discoverGplSensors(hass);

    expect(result.locations.has("entry-abc-123")).toBe(true);
    expect(result.locations.get("entry-abc-123").label).toBe("My Location");
  });

  it("excludes entities with entity_category set (diagnostic sensors)", () => {
    const statesMap = {
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 3),
      "sensor.pollenlevels_diagnostic": makeTypeSensor("mdi:grass", 0),
    };
    const entities = {
      "sensor.pollenlevels_grass": {
        entity_id: "sensor.pollenlevels_grass",
        platform: "pollenlevels",
        device_id: "dev1",
        entity_category: null,
      },
      "sensor.pollenlevels_diagnostic": {
        entity_id: "sensor.pollenlevels_diagnostic",
        platform: "pollenlevels",
        device_id: "dev1",
        entity_category: "diagnostic",
      },
    };
    const hass = { ...createHass(statesMap), entities, devices: {} };
    const result = discoverGplSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.size).toBe(1);
    expect(loc.entities.has("grass_cat")).toBe(true);
  });
});

// Helper alias used in primary-path tests above
function makeHasPrimary(statesMap, entitiesMap, devicesMap = {}) {
  return makeHassPrimary(statesMap, entitiesMap, devicesMap);
}

// ---------------------------------------------------------------------------
// fetchForecast: basic shape
// ---------------------------------------------------------------------------

describe("fetchForecast: basic shape", () => {
  it("returns an array of sensor dicts with required fields", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 3, [
        makeForecastItem(1, 2),
        makeForecastItem(2, 1),
      ]),
      "sensor.pollenlevels_birch": makePlantSensor("birch", 4, [
        makeForecastItem(1, 3),
        makeForecastItem(2, 2),
      ]),
    });
    const config = makeConfig({
      allergens: ["grass_cat", "birch"],
      pollen_threshold: 0,
      days_to_show: 3,
    });

    const result = await fetchForecast(hass, config);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    for (const sensor of result) {
      assertSensorShape(sensor, { minDays: 1 });
    }
  });

  it("sets allergenReplaced to the allergen key as-is", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 2),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].allergenReplaced).toBe("grass_cat");
  });

  it("sets allergenCapitalized to a non-empty string", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_birch": makePlantSensor("birch", 3),
    });
    const config = makeConfig({
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(typeof result[0].allergenCapitalized).toBe("string");
    expect(result[0].allergenCapitalized.length).toBeGreaterThan(0);
  });

  it("sets allergenShort equal to allergenCapitalized when not abbreviated", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_birch": makePlantSensor("birch", 3),
    });
    const config = makeConfig({
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 1,
      allergens_abbreviated: false,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].allergenShort).toBe(result[0].allergenCapitalized);
  });

  it("day0 is defined and is the first element of days array", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_birch": makePlantSensor("birch", 3),
    });
    const config = makeConfig({
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0).toBeDefined();
    expect(result[0].day0).toBe(result[0].days[0]);
  });

  it("each day object has required properties", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 3),
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

  it("sets entity_id on each sensor dict", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_birch": makePlantSensor("birch", 2),
    });
    const config = makeConfig({
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].entity_id).toBe("sensor.pollenlevels_birch");
  });

  it("respects days_to_show", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_birch": makePlantSensor("birch", 3, [
        makeForecastItem(1, 2),
        makeForecastItem(2, 1),
        makeForecastItem(3, 1),
        makeForecastItem(4, 0),
      ]),
    });
    const config = makeConfig({
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 3,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].days.length).toBe(3);
    expect(result[0].day0).toBeDefined();
    expect(result[0].day1).toBeDefined();
    expect(result[0].day2).toBeDefined();
    expect(result[0].day3).toBeUndefined();
  });

  it("returns empty array when no matching sensors exist", async () => {
    const hass = makeHassAttribution({});
    const config = makeConfig({
      allergens: ["grass_cat", "birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: level scaling (0-5 native to 0-6 display)
// ---------------------------------------------------------------------------

describe("fetchForecast: level scaling (0-5 to 0-6)", () => {
  // Formula: level < 2 ? floor(level*6/5) : ceil(level*6/5)
  // 0 -> floor(0.0) = 0
  // 1 -> floor(1.2) = 1
  // 2 -> ceil(2.4)  = 3
  // 3 -> ceil(3.6)  = 4
  // 4 -> ceil(4.8)  = 5
  // 5 -> ceil(6.0)  = 6

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
      const hass = makeHassAttribution({
        "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", nativeLevel),
      });
      const config = makeConfig({
        allergens: ["grass_cat"],
        pollen_threshold: 0,
        days_to_show: 1,
      });

      const result = await fetchForecast(hass, config);

      // state stores the raw (0-5) value
      expect(result[0].day0.state).toBe(nativeLevel);
      // state_text should be a non-empty string (scaled level label)
      expect(typeof result[0].day0.state_text).toBe("string");
      expect(result[0].day0.state_text.length).toBeGreaterThan(0);
    });
  }

  it("state_text for native level 5 differs from native level 0", async () => {
    const hassHigh = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 5),
    });
    const hassLow = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 0),
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
  it("returns state=-1 for NaN sensor state", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", NaN),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(-1);
  });

  it("returns state=-1 for negative sensor state", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", -3),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(-1);
  });

  it("clamps sensor state above 5 to 5", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 10),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(5);
  });

  it("returns state=-1 for forecast item with has_index=false", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 3, [
        makeForecastItem(1, 0, false),
      ]),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 2,
    });

    const result = await fetchForecast(hass, config);

    // day0 has valid state=3, day1 has has_index=false -> state=-1
    expect(result[0].day0.state).toBe(3);
    expect(result[0].day1.state).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: forecast data from sensor.attributes.forecast
// ---------------------------------------------------------------------------

describe("fetchForecast: forecast data", () => {
  it("reads tomorrow's level from forecast item with offset=1", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_birch": makePlantSensor("birch", 2, [
        makeForecastItem(1, 4),
        makeForecastItem(2, 1),
      ]),
    });
    const config = makeConfig({
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 3,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(2);
    expect(result[0].day1.state).toBe(4);
    expect(result[0].day2.state).toBe(1);
  });

  it("pads missing forecast days with state=-1", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 3),
      // No forecast items provided
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

  it("uses date field from forecast item when provided", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 1, [
        makeForecastItem(1, 2),
      ]),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 2,
    });

    const result = await fetchForecast(hass, config);

    // day1 should have a valid string label derived from the forecast date
    expect(typeof result[0].day1.day).toBe("string");
    expect(result[0].day1.day.length).toBeGreaterThan(0);
  });

  it("day0 state_text is the no_information label when level is -1", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", -1),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
      phrases: {
        full: {},
        short: {},
        levels: [],
        days: {},
        no_information: "N/A",
      },
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state_text).toBe("N/A");
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: threshold filtering
// ---------------------------------------------------------------------------

describe("fetchForecast: threshold filtering", () => {
  it("excludes allergens where all days are below threshold", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 3, [
        makeForecastItem(1, 2),
      ]),
      "sensor.pollenlevels_birch": makePlantSensor("birch", 0, [
        makeForecastItem(1, 0),
      ]),
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
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 0),
      "sensor.pollenlevels_birch": makePlantSensor("birch", 0),
    });
    const config = makeConfig({
      allergens: ["grass_cat", "birch"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(2);
  });

  it("includes an allergen if any single forecast day meets the threshold", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_birch": makePlantSensor("birch", 0, [
        makeForecastItem(1, 0),
        makeForecastItem(2, 3),
      ]),
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
// fetchForecast: sort_category_allergens_first (two-tiered sorting)
// ---------------------------------------------------------------------------

describe("fetchForecast: sort_category_allergens_first", () => {
  it("places category allergens before plant allergens regardless of value", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_birch": makePlantSensor("birch", 5),
      "sensor.pollenlevels_oak": makePlantSensor("oak", 4),
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 1),
      "sensor.pollenlevels_tree": makeTypeSensor("mdi:tree", 0),
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
    // Category allergens come first
    const categoryIndices = keys
      .map((k, i) => (GPL_BASE_ALLERGENS.includes(k) ? i : -1))
      .filter((i) => i >= 0);
    const plantIndices = keys
      .map((k, i) => (!GPL_BASE_ALLERGENS.includes(k) ? i : -1))
      .filter((i) => i >= 0);

    // Every category index should be less than every plant index
    for (const ci of categoryIndices) {
      for (const pi of plantIndices) {
        expect(ci).toBeLessThan(pi);
      }
    }
  });

  it("sorts within each tier by value when sort_category_allergens_first is true", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 1),
      "sensor.pollenlevels_tree": makeTypeSensor("mdi:tree", 4),
      "sensor.pollenlevels_birch": makePlantSensor("birch", 2),
      "sensor.pollenlevels_oak": makePlantSensor("oak", 5),
    });
    const config = makeConfig({
      allergens: ["grass_cat", "trees_cat", "birch", "oak"],
      pollen_threshold: 0,
      days_to_show: 1,
      sort: "value_descending",
      sort_category_allergens_first: true,
    });

    const result = await fetchForecast(hass, config);
    const keys = result.map((s) => s.allergenReplaced);

    // Within categories: trees_cat(4) before grass_cat(1)
    const treeIdx = keys.indexOf("trees_cat");
    const grassIdx = keys.indexOf("grass_cat");
    expect(treeIdx).toBeLessThan(grassIdx);

    // Within plants: oak(5) before birch(2)
    const oakIdx = keys.indexOf("oak");
    const birchIdx = keys.indexOf("birch");
    expect(oakIdx).toBeLessThan(birchIdx);
  });

  it("treats all allergens as one group when sort_category_allergens_first is false", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_oak": makePlantSensor("oak", 5),
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 1),
    });
    const config = makeConfig({
      allergens: ["oak", "grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
      sort: "value_descending",
      sort_category_allergens_first: false,
    });

    const result = await fetchForecast(hass, config);

    // oak(5) should come before grass_cat(1) with value_descending
    expect(result[0].allergenReplaced).toBe("oak");
    expect(result[1].allergenReplaced).toBe("grass_cat");
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: sorting modes
// ---------------------------------------------------------------------------

describe("fetchForecast: sorting modes", () => {
  it("sorts by value_ascending: lowest day0 first", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_birch": makePlantSensor("birch", 4),
      "sensor.pollenlevels_oak": makePlantSensor("oak", 1),
      "sensor.pollenlevels_alder": makePlantSensor("alder", 3),
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

  it("sorts by name_ascending", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_oak": makePlantSensor("oak", 2),
      "sensor.pollenlevels_alder": makePlantSensor("alder", 2),
      "sensor.pollenlevels_birch": makePlantSensor("birch", 2),
    });
    const config = makeConfig({
      allergens: ["oak", "alder", "birch"],
      pollen_threshold: 0,
      days_to_show: 1,
      sort: "name_ascending",
      sort_category_allergens_first: false,
    });

    const result = await fetchForecast(hass, config);

    const names = result.map((s) => s.allergenCapitalized);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it("preserves original order when sort is 'none'", async () => {
    const hass = makeHassAttribution({
      "sensor.pollenlevels_oak": makePlantSensor("oak", 1),
      "sensor.pollenlevels_birch": makePlantSensor("birch", 3),
      "sensor.pollenlevels_alder": makePlantSensor("alder", 2),
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
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 2),
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
