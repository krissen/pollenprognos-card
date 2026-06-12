import { describe, it, expect } from "vitest";
import {
  fetchForecast,
  stubConfigGPL,
  GPL_BASE_ALLERGENS,
  GPL_ATTRIBUTION,
  discoverGplSensors,
  classifySensor,
} from "../../src/adapters/gpl/index.js";
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

  it("strips ' - Pollentyper (lat, lon)' suffix from device name label", () => {
    // The pollenlevels integration names devices
    // "{user-name} - Pollentyper ({lat}, {lon})". Leaking the coordinate-
    // laden suffix into the card header and editor dropdown is noise.
    const statesMap = {
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 3),
    };
    const entitiesMap = {
      "sensor.pollenlevels_grass": { device_id: "dev1" },
    };
    const devicesMap = {
      dev1: {
        name: "Hem - Pollentyper (50.450, 30.523)",
        config_entries: ["entry-abc-123"],
      },
    };
    const hass = makeHasPrimary(statesMap, entitiesMap, devicesMap);
    const result = discoverGplSensors(hass);

    expect(result.locations.get("entry-abc-123").label).toBe("Hem");
  });

  it("strips device-name suffix in a locale-agnostic way (English/German/French/Italian/Japanese)", () => {
    // The cleanDeviceLabel util uses a coordinate-shaped paren regex, not
    // an enumerated list of category words. New HA languages should not
    // regress this behavior.
    const cases = [
      ["Garden - Pollen types (51.5, -0.1)", "Garden"],
      ["Berlin - Pollentypen (52.5, 13.4)", "Berlin"],
      ["Paris - Niveaux de pollen (48.8566, 2.3522)", "Paris"],
      ["Roma - Tipi di polline (41.9028, 12.4964)", "Roma"],
      ["Tokyo - 花粉タイプ (35.6762, 139.6503)", "Tokyo"],
    ];
    for (const [deviceName, expected] of cases) {
      const statesMap = {
        "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 3),
      };
      const entitiesMap = {
        "sensor.pollenlevels_grass": { device_id: "dev1" },
      };
      const devicesMap = {
        dev1: { name: deviceName, config_entries: ["entry-xyz"] },
      };
      const hass = makeHasPrimary(statesMap, entitiesMap, devicesMap);
      const result = discoverGplSensors(hass);
      expect(result.locations.get("entry-xyz").label).toBe(expected);
    }
  });

  it("preserves hyphenated location names like 'Saint-Cloud'", () => {
    const statesMap = {
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 3),
    };
    const entitiesMap = {
      "sensor.pollenlevels_grass": { device_id: "dev1" },
    };
    const devicesMap = {
      dev1: {
        name: "Saint-Cloud - Pollentyper (48.84, 2.21)",
        config_entries: ["entry-sc"],
      },
    };
    const hass = makeHasPrimary(statesMap, entitiesMap, devicesMap);
    const result = discoverGplSensors(hass);
    expect(result.locations.get("entry-sc").label).toBe("Saint-Cloud");
  });

  it("name_by_user wins over device.name stripping", () => {
    const statesMap = {
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 3),
    };
    const entitiesMap = {
      "sensor.pollenlevels_grass": { device_id: "dev1" },
    };
    const devicesMap = {
      dev1: {
        name: "Hem - Pollentyper (50.450, 30.523)",
        name_by_user: "Min plats",
        config_entries: ["entry-abc-123"],
      },
    };
    const hass = makeHasPrimary(statesMap, entitiesMap, devicesMap);
    const result = discoverGplSensors(hass);
    expect(result.locations.get("entry-abc-123").label).toBe("Min plats");
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
// discoverGplSensors: Pollen Levels v3 config subentries (issue #262)
// ---------------------------------------------------------------------------

describe("discoverGplSensors: v3 config subentries", () => {
  const PARENT = "01PARENTENTRYAAAAAAAAAAAAA"; // 26-char ULID-shaped
  const SUB_A = "01SUBENTRYAAAAAAAAAAAAAAAA";
  const SUB_B = "01SUBENTRYBBBBBBBBBBBBBBBB";

  it("keeps two subentry locations under one parent as separate buckets", () => {
    // Both location devices belong to the SAME parent config entry; they
    // differ only in their config_entries_subentries subentry id. Without
    // subentry awareness both collapse into one bucket and the second
    // location's allergens are dropped on key collision.
    const statesMap = {
      "sensor.home_grass": makeTypeSensor("mdi:grass", 3),
      "sensor.home_birch": makePlantSensor("birch", 2),
      "sensor.work_grass": makeTypeSensor("mdi:grass", 1),
      "sensor.work_birch": makePlantSensor("birch", 4),
    };
    const entitiesMap = {
      "sensor.home_grass": { device_id: "dev_a" },
      "sensor.home_birch": { device_id: "dev_a" },
      "sensor.work_grass": { device_id: "dev_b" },
      "sensor.work_birch": { device_id: "dev_b" },
    };
    const devicesMap = {
      dev_a: {
        name: "Home",
        config_entries: [PARENT],
        primary_config_entry: PARENT,
        config_entries_subentries: { [PARENT]: [SUB_A] },
      },
      dev_b: {
        name: "Work",
        config_entries: [PARENT],
        primary_config_entry: PARENT,
        config_entries_subentries: { [PARENT]: [SUB_B] },
      },
    };
    const hass = makeHasPrimary(statesMap, entitiesMap, devicesMap);
    const result = discoverGplSensors(hass);

    expect(result.locations.size).toBe(2);
    expect(result.locations.has(SUB_A)).toBe(true);
    expect(result.locations.has(SUB_B)).toBe(true);
    expect(result.locations.get(SUB_A).label).toBe("Home");
    expect(result.locations.get(SUB_B).label).toBe("Work");
    // Each location keeps its own grass + birch (no collision drop).
    expect(result.locations.get(SUB_A).entities.get("grass_cat")).toBe("sensor.home_grass");
    expect(result.locations.get(SUB_A).entities.get("birch")).toBe("sensor.home_birch");
    expect(result.locations.get(SUB_B).entities.get("grass_cat")).toBe("sensor.work_grass");
    expect(result.locations.get(SUB_B).entities.get("birch")).toBe("sensor.work_birch");
  });

  it("keys a legacy device (subentry list [null]) by its config entry id, not 'default'", () => {
    // Backward compatibility: the current pollenlevels release reports
    // config_entries_subentries = { entry: [null] }. The location key must
    // stay the top-level config entry id so existing card configs resolve.
    const statesMap = {
      "sensor.home_grass": makeTypeSensor("mdi:grass", 3),
    };
    const entitiesMap = {
      "sensor.home_grass": { device_id: "dev_a" },
    };
    const devicesMap = {
      dev_a: {
        name: "Home",
        config_entries: [PARENT],
        primary_config_entry: PARENT,
        config_entries_subentries: { [PARENT]: [null] },
      },
    };
    const hass = makeHasPrimary(statesMap, entitiesMap, devicesMap);
    const result = discoverGplSensors(hass);

    expect(result.locations.size).toBe(1);
    expect(result.locations.has(PARENT)).toBe(true);
  });
});

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

    // day1's label is derived from the forecast date: offset 1 -> "Tomorrow"
    expect(result[0].day1.day).toBe("Tomorrow");
  });

  // Issue #271: the sensor state is the value for the integration's last
  // FETCH day (Google's dailyInfo[0]), and forecast offsets are relative to
  // that day. When the integration has not refreshed since yesterday, the
  // offset=1 item is dated today: the state (yesterday's value) must fall
  // away and the item's value must become the single "Today" column.
  it("shows the today-dated forecast item as the only Today column when the state is a day old (#271)", async () => {
    const staleItem = { ...makeForecastItem(0, 3), offset: 1 };
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 1, [staleItem]),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 2,
    });

    const result = await fetchForecast(hass, config);

    // Today shows the item's value; the state belongs to yesterday
    expect(result[0].day0.day).toBe("Today");
    expect(result[0].day0.state).toBe(3);
    // Second column is a padded empty tomorrow, not a duplicate today
    expect(result[0].day1.day).toBe("Tomorrow");
    expect(result[0].day1.state).toBe(-1);
  });

  it("places a forecast item by its date and drops the day-old state (offset lag)", async () => {
    // date = tomorrow with offset 2 => the fetch day was yesterday: the state
    // is yesterday's value and today's value is genuinely unknown.
    const staleItem = { ...makeForecastItem(1, 4), offset: 2 };
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 1, [staleItem]),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 2,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.day).toBe("Today");
    expect(result[0].day0.state).toBe(-1);
    expect(result[0].day1.day).toBe("Tomorrow");
    expect(result[0].day1.state).toBe(4);
  });

  it("uses the today-dated forecast item when the state is unavailable", async () => {
    const todayItem = { ...makeForecastItem(0, 2), offset: 1 };
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", "unavailable", [todayItem]),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 2,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.day).toBe("Today");
    expect(result[0].day0.state).toBe(2);
    expect(result[0].day1.day).toBe("Tomorrow");
    expect(result[0].day1.state).toBe(-1);
  });

  it("keeps the state as today and items on their dates when the data is fresh", async () => {
    // Well-formed case: fetch day == today, forecast starts tomorrow.
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 2, [
        makeForecastItem(1, 4),
        makeForecastItem(2, 1),
      ]),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 3,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.day).toBe("Today");
    expect(result[0].day0.state).toBe(2);
    expect(result[0].day1.day).toBe("Tomorrow");
    expect(result[0].day1.state).toBe(4);
    expect(result[0].day2.state).toBe(1);
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

// ---------------------------------------------------------------------------
// Pollen Levels v2.1.0: overall_pollen_risk_today summary sensor (#221)
// ---------------------------------------------------------------------------

describe("classifySensor: overall_pollen_risk_today summary (#221)", () => {
  it("returns 'allergy_risk' when entry.unique_id ends with _overall_pollen_risk_today", () => {
    // Pollen Levels v2.1.0 doesn't put translation_key in state.attributes
    // so we have to detect via the registry entry. unique_id is the
    // language-independent signal -- always English even when the friendly
    // name is translated by HA.
    const state = { state: "3", attributes: {} };
    const entry = { unique_id: "abc123_overall_pollen_risk_today" };
    expect(classifySensor(state, entry)).toBe("allergy_risk");
  });

  it("returns 'allergy_risk' via translation_key fallback when unique_id is missing", () => {
    const state = { state: "3", attributes: {} };
    const entry = { translation_key: "overall_pollen_risk_today" };
    expect(classifySensor(state, entry)).toBe("allergy_risk");
  });

  it("returns null for the other v2.1.0 summary sensors (out of scope for #221, tracked in #222)", () => {
    const state = { state: "Tree", attributes: {} };
    expect(
      classifySensor(state, { unique_id: "abc_top_pollen_types_today" }),
    ).toBeNull();
    expect(
      classifySensor(state, { unique_id: "abc_plants_in_season_today" }),
    ).toBeNull();
  });

  it("still returns the plant code when both code and unique_id are present", () => {
    // Per-allergen sensors keep their attributes.code path; the summary
    // branch is only hit when no code and no icon match.
    const state = { state: "2", attributes: { code: "birch" } };
    const entry = { unique_id: "abc_birch" };
    expect(classifySensor(state, entry)).toBe("birch");
  });

  it("is safe when entry is missing AND no summary attributes are present", () => {
    const state = { state: "3", attributes: {} };
    expect(classifySensor(state)).toBeNull();
    expect(classifySensor(state, null)).toBeNull();
  });

  it("falls back to state.attributes.top_pollen_codes when entry is unavailable", () => {
    // Tier-3 attribution scan and manual-mode fallback don't pass the
    // entity registry entry, so registry-based detection silently fails
    // there. The summary entity ships a `top_pollen_codes` array (only
    // it does -- per-allergen sensors don't), which is a reliable
    // state-only signal.
    const state = {
      state: "3",
      attributes: { top_pollen_codes: ["TREE"] },
    };
    expect(classifySensor(state)).toBe("allergy_risk");
    expect(classifySensor(state, null)).toBe("allergy_risk");
  });

  it("attribute fallback still recognizes summary when top_pollen_codes is empty (Sydney/no-data case)", () => {
    // For locations the upstream Google API has no data on, the summary
    // entity still exists with state="unknown" but top_pollen_codes is
    // an empty array. It's still the summary; detect it.
    const state = {
      state: "unknown",
      attributes: { top_pollen_codes: [] },
    };
    expect(classifySensor(state)).toBe("allergy_risk");
  });
});

// Pollen Levels v3 (#262): top_pollen_types_today now ALSO ships
// top_pollen_codes, so the attribute fallback must not misread it as the
// overall-risk summary and collide with the real allergy_risk sensor.
// ---------------------------------------------------------------------------

describe("classifySensor: v3 top_pollen_types_today no longer collides (#262)", () => {
  // Real v3-beta3 shape: a text sensor whose state is a category name, with
  // top_pollen_codes AND a top_value, identified by translation_key (the
  // reduced frontend hass.entities exposes no unique_id).
  const topTypesState = {
    state: "Трава",
    attributes: {
      attribution: GPL_ATTRIBUTION,
      top_value: 3,
      top_pollen_codes: ["GRASS"],
      top_pollen_names: ["Трава"],
      top_pollen_categories: ["Средний"],
      tie_count: 1,
    },
  };
  // Real v3-beta3 overall-risk shape: numeric state, top_pollen_codes but
  // NO top_value, plus a daily forecast/trend.
  const overallRiskState = {
    state: "3",
    attributes: {
      attribution: GPL_ATTRIBUTION,
      category: "Средний",
      top_pollen_codes: ["GRASS"],
      forecast: [{ offset: 1, value: 3 }],
      trend: "flat",
    },
  };

  it("returns null for top_pollen_types_today identified by translation_key", () => {
    const entry = { translation_key: "top_pollen_types_today" };
    expect(classifySensor(topTypesState, entry)).toBeNull();
  });

  it("returns null for plants_in_season_today identified by translation_key", () => {
    const entry = { translation_key: "plants_in_season_today" };
    const state = { state: "5", attributes: { plant_codes: ["BIRCH"] } };
    expect(classifySensor(state, entry)).toBeNull();
  });

  it("still classifies the v3 overall-risk sensor as allergy_risk", () => {
    const entry = { translation_key: "overall_pollen_risk_today" };
    expect(classifySensor(overallRiskState, entry)).toBe("allergy_risk");
  });

  it("tier-3 (no entry): top_value discriminates the text sibling from the risk index", () => {
    // Attribution scan passes no registry entry. Both carry top_pollen_codes;
    // only top_pollen_types_today carries top_value.
    expect(classifySensor(topTypesState)).toBeNull();
    expect(classifySensor(overallRiskState)).toBe("allergy_risk");
  });
});

describe("discoverGplSensors: v3 summary siblings don't collide on allergy_risk (#262)", () => {
  it("binds allergy_risk to overall-risk and drops top_pollen_types entirely", () => {
    const statesMap = {
      "sensor.home_grass": makeTypeSensor("mdi:grass", 3),
      "sensor.home_overall": {
        state: "3",
        attributes: {
          attribution: GPL_ATTRIBUTION,
          top_pollen_codes: ["GRASS"],
          forecast: [{ offset: 1, value: 3 }],
        },
      },
      "sensor.home_top_types": {
        state: "Грас",
        attributes: {
          attribution: GPL_ATTRIBUTION,
          top_value: 3,
          top_pollen_codes: ["GRASS"],
        },
      },
    };
    const entitiesMap = {
      "sensor.home_grass": { device_id: "dev1" },
      "sensor.home_overall": { device_id: "dev1" },
      "sensor.home_top_types": { device_id: "dev1" },
    };
    const hass = makeHassPrimary(statesMap, entitiesMap, {
      dev1: { name: "Home", config_entries: ["entry_v3"] },
    });
    // Reduced frontend shape carries translation_key, not unique_id.
    hass.entities["sensor.home_overall"].translation_key =
      "overall_pollen_risk_today";
    hass.entities["sensor.home_top_types"].translation_key =
      "top_pollen_types_today";

    const result = discoverGplSensors(hass);
    const loc = result.locations.get("entry_v3");
    expect(loc).toBeDefined();
    expect(loc.entities.get("allergy_risk")).toBe("sensor.home_overall");
    // The text "top types" sensor must not appear under any allergen key.
    for (const eid of loc.entities.values()) {
      expect(eid).not.toBe("sensor.home_top_types");
    }
  });
});

describe("discoverGplSensors: summary sensor flows through to allergy_risk key", () => {
  it("registers the overall_pollen_risk_today entity under the 'allergy_risk' allergen key", () => {
    const statesMap = {
      "sensor.home_overall_pollen_risk_today": {
        state: "3",
        attributes: { attribution: GPL_ATTRIBUTION },
      },
      "sensor.home_grass": makeTypeSensor("mdi:grass", 2),
    };
    const entitiesMap = {
      "sensor.home_overall_pollen_risk_today": {
        device_id: "dev1",
        unique_id: "cfg_entry_id_overall_pollen_risk_today",
      },
      "sensor.home_grass": { device_id: "dev1" },
    };
    // makeHassPrimary builds entries without unique_id; merge it in here.
    const hass = (() => {
      const base = makeHassPrimary(statesMap, entitiesMap, {
        dev1: { name: "Home", config_entries: ["entry-summary-1"] },
      });
      base.entities["sensor.home_overall_pollen_risk_today"].unique_id =
        "cfg_entry_id_overall_pollen_risk_today";
      return base;
    })();

    const result = discoverGplSensors(hass);
    const loc = result.locations.get("entry-summary-1");
    expect(loc).toBeDefined();
    expect(loc.entities.has("allergy_risk")).toBe(true);
    expect(loc.entities.get("allergy_risk")).toBe(
      "sensor.home_overall_pollen_risk_today",
    );
    // grass_cat is still discovered too -- summary detection doesn't shadow
    // the existing per-allergen flow.
    expect(loc.entities.has("grass_cat")).toBe(true);
  });
});

describe("fetchForecast: allergy_risk summary row (#221)", () => {
  function makeSummaryHass({
    summaryState = "3",
    grassState = 2,
    pinTopUnique = "entry_a_overall_pollen_risk_today",
  } = {}) {
    const statesMap = {
      "sensor.home_overall_pollen_risk_today": {
        state: String(summaryState),
        attributes: { attribution: GPL_ATTRIBUTION },
      },
      "sensor.home_grass": makeTypeSensor("mdi:grass", grassState),
    };
    const entitiesMap = {
      "sensor.home_overall_pollen_risk_today": { device_id: "dev1" },
      "sensor.home_grass": { device_id: "dev1" },
    };
    const hass = makeHassPrimary(statesMap, entitiesMap, {
      dev1: { name: "Home", config_entries: ["entry_a"] },
    });
    hass.entities["sensor.home_overall_pollen_risk_today"].unique_id =
      pinTopUnique;
    return hass;
  }

  it("includes an allergy_risk row when the summary sensor is present", async () => {
    const hass = makeSummaryHass({ summaryState: "3" });
    const config = makeConfig({
      allergens: ["allergy_risk", "grass_cat"],
      pollen_threshold: 0,
      days_to_show: 3,
      allergy_risk_top: false, // test ordering separately
    });

    const result = await fetchForecast(hass, config);
    const ar = result.find((s) => s.allergenReplaced === "allergy_risk");
    expect(ar).toBeDefined();
    expect(ar.day0.state).toBe(3);
  });

  it("renders day1..N as no-data sentinels (-1) since the summary has no forecast", async () => {
    const hass = makeSummaryHass({ summaryState: "2" });
    const config = makeConfig({
      allergens: ["allergy_risk"],
      pollen_threshold: 0,
      days_to_show: 4,
      allergy_risk_top: false,
    });

    const result = await fetchForecast(hass, config);
    const ar = result.find((s) => s.allergenReplaced === "allergy_risk");
    expect(ar.day0.state).toBe(2);
    // The card treats level=-1 as the fuzzy no-data variant (#228); padding
    // future days as -1 is what keeps the row from inventing fake values.
    expect(ar.day1.state).toBe(-1);
    expect(ar.day2.state).toBe(-1);
    expect(ar.day3.state).toBe(-1);
  });

  it("pins allergy_risk to position 0 when allergy_risk_top: true", async () => {
    const hass = makeSummaryHass();
    const config = makeConfig({
      allergens: ["allergy_risk", "grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
      allergy_risk_top: true,
    });

    const result = await fetchForecast(hass, config);
    expect(result[0].allergenReplaced).toBe("allergy_risk");
  });

  it("leaves allergy_risk in its natural sort position when allergy_risk_top: false", async () => {
    // With value_descending sort and summary=1 < grass=3, allergy_risk
    // should sort after grass_cat.
    const hass = makeSummaryHass({ summaryState: "1", grassState: 3 });
    const config = makeConfig({
      allergens: ["allergy_risk", "grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
      allergy_risk_top: false,
      sort: "value_descending",
      sort_category_allergens_first: false,
    });

    const result = await fetchForecast(hass, config);
    expect(result[0].allergenReplaced).toBe("grass_cat");
    expect(result[1].allergenReplaced).toBe("allergy_risk");
  });

  it("pre-v2.1.0 installs (no summary sensor) keep working", async () => {
    // Regression check: the new classifier branch must not change behavior
    // when the summary entity is absent.
    const hass = makeHassAttribution({
      "sensor.pollenlevels_grass": makeTypeSensor("mdi:grass", 2),
    });
    const config = makeConfig({
      allergens: ["grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
      allergy_risk_top: true, // even with the flag on, no summary present
    });

    const result = await fetchForecast(hass, config);
    expect(result.length).toBe(1);
    expect(result[0].allergenReplaced).toBe("grass_cat");
  });
});

// ---------------------------------------------------------------------------
// Summary block: isSummary tag + v2.1.0 extras enrichment (#222)
// ---------------------------------------------------------------------------

describe("fetchForecast: summary block tagging and extras (#222)", () => {
  function makeSummaryHass({
    summaryState = "3",
    grassState = 2,
    summaryAttrs = {},
    plants = null, // { state, plant_codes, plant_names } -> sibling entity
    language = "en",
  } = {}) {
    const statesMap = {
      "sensor.home_overall_pollen_risk_today": {
        state: String(summaryState),
        attributes: { attribution: GPL_ATTRIBUTION, ...summaryAttrs },
      },
      "sensor.home_grass": makeTypeSensor("mdi:grass", grassState),
    };
    const entitiesMap = {
      "sensor.home_overall_pollen_risk_today": { device_id: "dev1" },
      "sensor.home_grass": { device_id: "dev1" },
    };
    if (plants) {
      statesMap["sensor.home_plants_in_season_today"] = {
        state: String(plants.state ?? ""),
        attributes: {
          attribution: GPL_ATTRIBUTION,
          ...(plants.plant_codes ? { plant_codes: plants.plant_codes } : {}),
          ...(plants.plant_names ? { plant_names: plants.plant_names } : {}),
        },
      };
      entitiesMap["sensor.home_plants_in_season_today"] = { device_id: "dev1" };
    }
    const hass = makeHassPrimary(statesMap, entitiesMap, {
      dev1: { name: "Home", config_entries: ["entry_a"] },
    });
    hass.entities["sensor.home_overall_pollen_risk_today"].unique_id =
      "entry_a_overall_pollen_risk_today";
    if (plants) {
      hass.entities["sensor.home_plants_in_season_today"].unique_id =
        "entry_a_plants_in_season_today";
      hass.entities["sensor.home_plants_in_season_today"].translation_key =
        "plants_in_season_today";
    }
    // Force the card language (detectLang reads hass.locale.language).
    hass.language = language;
    hass.locale = { language };
    return hass;
  }

  it("tags the allergy_risk aggregate with isSummary: true", async () => {
    const hass = makeSummaryHass();
    const config = makeConfig({
      allergens: ["allergy_risk", "grass_cat"],
      pollen_threshold: 0,
      days_to_show: 1,
    });
    const result = await fetchForecast(hass, config);
    const ar = result.find((s) => s.allergenReplaced === "allergy_risk");
    expect(ar.isSummary).toBe(true);
    // Per-allergen rows are never tagged as summary.
    const grass = result.find((s) => s.allergenReplaced === "grass_cat");
    expect(grass.isSummary).toBeUndefined();
  });

  it("localizes top_pollen_codes (TREE/GRASS) in the card language", async () => {
    const hass = makeSummaryHass({
      summaryAttrs: { top_pollen_codes: ["TREE", "GRASS"] },
      language: "sv",
    });
    const config = makeConfig({
      allergens: ["allergy_risk"],
      pollen_threshold: 0,
      days_to_show: 1,
    });
    const result = await fetchForecast(hass, config);
    const ar = result.find((s) => s.allergenReplaced === "allergy_risk");
    expect(ar.topPollen).toEqual(["Träd", "Gräsarter"]);
  });

  // The integration may fetch its *_names in another language than the card
  // (the bug that showed "Дерево" on a Swedish card). We localize from the
  // code, so the card language wins over the integration's name.
  it("localizes from the code even when top_pollen_names is another language", async () => {
    const hass = makeSummaryHass({
      summaryAttrs: { top_pollen_codes: ["TREE"], top_pollen_names: ["Дерево"] },
      language: "sv",
    });
    const config = makeConfig({
      allergens: ["allergy_risk"],
      pollen_threshold: 0,
      days_to_show: 1,
    });
    const result = await fetchForecast(hass, config);
    const ar = result.find((s) => s.allergenReplaced === "allergy_risk");
    expect(ar.topPollen).toEqual(["Träd"]);
  });

  it("localizes the same codes per the card language (sv/fi/en)", async () => {
    const cases = [
      ["sv", ["Träd", "Gräsarter"]],
      ["fi", ["Puut", "Heinät"]],
      ["en", ["Trees", "Grasses"]],
    ];
    for (const [language, expected] of cases) {
      const hass = makeSummaryHass({
        summaryAttrs: { top_pollen_codes: ["TREE", "GRASS"] },
        language,
      });
      const config = makeConfig({
        allergens: ["allergy_risk"],
        pollen_threshold: 0,
        days_to_show: 1,
      });
      const result = await fetchForecast(hass, config);
      const ar = result.find((s) => s.allergenReplaced === "allergy_risk");
      expect(ar.topPollen, `lang=${language}`).toEqual(expected);
    }
  });

  it("omits topPollen when top_pollen_codes is empty/absent", async () => {
    for (const attrs of [{ top_pollen_codes: [] }, {}]) {
      const hass = makeSummaryHass({ summaryAttrs: attrs });
      const config = makeConfig({
        allergens: ["allergy_risk"],
        pollen_threshold: 0,
        days_to_show: 1,
      });
      const result = await fetchForecast(hass, config);
      const ar = result.find((s) => s.allergenReplaced === "allergy_risk");
      expect(ar.topPollen).toBeUndefined();
    }
  });

  it("localizes plant_codes from the sibling entity per card language (sv/fi)", async () => {
    for (const [language, expected] of [
      ["sv", ["Tall", "Björk", "Oliv"]],
      ["fi", ["Mänty", "Koivu", "Oliivipuu"]],
    ]) {
      const hass = makeSummaryHass({
        plants: { state: "3", plant_codes: ["PINE", "BIRCH", "OLIVE"] },
        language,
      });
      const config = makeConfig({
        allergens: ["allergy_risk"],
        pollen_threshold: 0,
        days_to_show: 1,
      });
      const result = await fetchForecast(hass, config);
      const ar = result.find((s) => s.allergenReplaced === "allergy_risk");
      expect(ar.plantsInSeasonList, `lang=${language}`).toEqual(expected);
    }
  });

  it("resolves the sibling via translation_key when unique_id is absent", async () => {
    // The frontend's reduced hass.entities often omits unique_id; resolution
    // must still work via translation_key + device scoping.
    const hass = makeSummaryHass({
      plants: { state: "2", plant_codes: ["BIRCH", "PINE"] },
      language: "sv",
    });
    delete hass.entities["sensor.home_plants_in_season_today"].unique_id;
    const config = makeConfig({
      allergens: ["allergy_risk"],
      pollen_threshold: 0,
      days_to_show: 1,
    });
    const result = await fetchForecast(hass, config);
    const ar = result.find((s) => s.allergenReplaced === "allergy_risk");
    expect(ar.plantsInSeasonList).toEqual(["Björk", "Tall"]);
  });

  it("resolves the sibling across devices within the same config entry", async () => {
    // pollenlevels splits a location: the summary sits on the "pollen types"
    // device while plants_in_season sits on a separate "plants" device, same
    // config entry. Resolution must scope by config entry, not device.
    const statesMap = {
      "sensor.home_overall_pollen_risk_today": {
        state: "3",
        attributes: { attribution: GPL_ATTRIBUTION, top_pollen_codes: ["TREE"] },
      },
      "sensor.home_grass": makeTypeSensor("mdi:grass", 2),
      "sensor.home_plants_in_season_today": {
        state: "2",
        attributes: { attribution: GPL_ATTRIBUTION, plant_codes: ["BIRCH", "PINE"] },
      },
    };
    const entitiesMap = {
      "sensor.home_overall_pollen_risk_today": { device_id: "dev_types" },
      "sensor.home_grass": { device_id: "dev_types" },
      "sensor.home_plants_in_season_today": { device_id: "dev_plants" },
    };
    const hass = makeHassPrimary(statesMap, entitiesMap, {
      dev_types: { name: "Home types", config_entries: ["entry_a"] },
      dev_plants: { name: "Home plants", config_entries: ["entry_a"] },
    });
    hass.entities["sensor.home_plants_in_season_today"].translation_key =
      "plants_in_season_today";
    hass.language = "sv";
    hass.locale = { language: "sv" };
    const config = makeConfig({
      allergens: ["allergy_risk"],
      pollen_threshold: 0,
      days_to_show: 1,
    });
    const result = await fetchForecast(hass, config);
    const ar = result.find((s) => s.allergenReplaced === "allergy_risk");
    expect(ar.plantsInSeasonList).toEqual(["Björk", "Tall"]);
  });

  it("resolves the sibling across devices within the same subentry (v3, issue #262)", async () => {
    // v3 analogue of the cross-device case: pollenlevels splits a single
    // subentry location across a "pollen types" device and a "plants" device.
    // Both devices carry the SAME subentry id, so the summary on dev_types must
    // bind the plants_in_season sibling on dev_plants.
    const PARENT = "01PARENTENTRYAAAAAAAAAAAAA";
    const SUB_A = "01SUBENTRYAAAAAAAAAAAAAAAA";
    const statesMap = {
      "sensor.home_overall_pollen_risk_today": {
        state: "3",
        attributes: { attribution: GPL_ATTRIBUTION, top_pollen_codes: ["TREE"] },
      },
      "sensor.home_grass": makeTypeSensor("mdi:grass", 2),
      "sensor.home_plants_in_season_today": {
        state: "2",
        attributes: { attribution: GPL_ATTRIBUTION, plant_codes: ["BIRCH", "PINE"] },
      },
    };
    const entitiesMap = {
      "sensor.home_overall_pollen_risk_today": { device_id: "dev_types" },
      "sensor.home_grass": { device_id: "dev_types" },
      "sensor.home_plants_in_season_today": { device_id: "dev_plants" },
    };
    const hass = makeHassPrimary(statesMap, entitiesMap, {
      dev_types: {
        name: "Home types",
        config_entries: [PARENT],
        primary_config_entry: PARENT,
        config_entries_subentries: { [PARENT]: [SUB_A] },
      },
      dev_plants: {
        name: "Home plants",
        config_entries: [PARENT],
        primary_config_entry: PARENT,
        config_entries_subentries: { [PARENT]: [SUB_A] },
      },
    });
    hass.entities["sensor.home_plants_in_season_today"].translation_key =
      "plants_in_season_today";
    hass.language = "sv";
    hass.locale = { language: "sv" };
    const config = makeConfig({
      location: SUB_A,
      allergens: ["allergy_risk"],
      pollen_threshold: 0,
      days_to_show: 1,
    });
    const result = await fetchForecast(hass, config);
    const ar = result.find((s) => s.allergenReplaced === "allergy_risk");
    expect(ar.plantsInSeasonList).toEqual(["Björk", "Tall"]);
  });

  it("scopes the sibling to the same subentry location (v3, issue #262)", async () => {
    // Two locations under one parent config entry, each with its own summary
    // and plants_in_season sibling. The summary must bind the sibling from its
    // OWN subentry, not the other location's (both share the parent entry, so
    // config-entry scoping alone would cross the boundary).
    const PARENT = "01PARENTENTRYAAAAAAAAAAAAA";
    const SUB_A = "01SUBENTRYAAAAAAAAAAAAAAAA";
    const SUB_B = "01SUBENTRYBBBBBBBBBBBBBBBB";
    const statesMap = {
      "sensor.home_overall_pollen_risk_today": {
        state: "3",
        attributes: { attribution: GPL_ATTRIBUTION, top_pollen_codes: ["TREE"] },
      },
      "sensor.home_plants_in_season_today": {
        state: "2",
        attributes: { attribution: GPL_ATTRIBUTION, plant_codes: ["BIRCH", "PINE"] },
      },
      "sensor.work_overall_pollen_risk_today": {
        state: "1",
        attributes: { attribution: GPL_ATTRIBUTION, top_pollen_codes: ["GRASS"] },
      },
      "sensor.work_plants_in_season_today": {
        state: "1",
        attributes: { attribution: GPL_ATTRIBUTION, plant_codes: ["OAK"] },
      },
    };
    const entitiesMap = {
      "sensor.home_overall_pollen_risk_today": { device_id: "dev_a" },
      "sensor.home_plants_in_season_today": { device_id: "dev_a" },
      "sensor.work_overall_pollen_risk_today": { device_id: "dev_b" },
      "sensor.work_plants_in_season_today": { device_id: "dev_b" },
    };
    const hass = makeHassPrimary(statesMap, entitiesMap, {
      dev_a: {
        name: "Home",
        config_entries: [PARENT],
        primary_config_entry: PARENT,
        config_entries_subentries: { [PARENT]: [SUB_A] },
      },
      dev_b: {
        name: "Work",
        config_entries: [PARENT],
        primary_config_entry: PARENT,
        config_entries_subentries: { [PARENT]: [SUB_B] },
      },
    });
    hass.entities["sensor.home_plants_in_season_today"].translation_key =
      "plants_in_season_today";
    hass.entities["sensor.work_plants_in_season_today"].translation_key =
      "plants_in_season_today";
    hass.language = "sv";
    hass.locale = { language: "sv" };
    const config = makeConfig({
      location: SUB_A,
      allergens: ["allergy_risk"],
      pollen_threshold: 0,
      days_to_show: 1,
    });
    const result = await fetchForecast(hass, config);
    const ar = result.find((s) => s.allergenReplaced === "allergy_risk");
    // Home's summary must list Home's plants (Björk/Tall), not Work's (Ek).
    expect(ar.plantsInSeasonList).toEqual(["Björk", "Tall"]);
  });

  it("omits plantsInSeasonList when the sibling has no plant codes/names", async () => {
    const hass = makeSummaryHass({ plants: { state: "0" } });
    const config = makeConfig({
      allergens: ["allergy_risk"],
      pollen_threshold: 0,
      days_to_show: 1,
    });
    const result = await fetchForecast(hass, config);
    const ar = result.find((s) => s.allergenReplaced === "allergy_risk");
    expect(ar.plantsInSeasonList).toBeUndefined();
  });

  it("omits plantsInSeasonList when the sibling entity is absent", async () => {
    const hass = makeSummaryHass();
    const config = makeConfig({
      allergens: ["allergy_risk"],
      pollen_threshold: 0,
      days_to_show: 1,
    });
    const result = await fetchForecast(hass, config);
    const ar = result.find((s) => s.allergenReplaced === "allergy_risk");
    expect(ar.plantsInSeasonList).toBeUndefined();
  });

  it("retains the aggregate below threshold when show_summary_block is on", async () => {
    // summary level 0 (none) is below threshold 1; with the block on it must
    // still be returned so the card has data to render the block.
    const hass = makeSummaryHass({ summaryState: "0" });
    const config = makeConfig({
      allergens: ["allergy_risk"],
      pollen_threshold: 1,
      days_to_show: 1,
      show_summary_block: true,
    });
    const result = await fetchForecast(hass, config);
    expect(result.find((s) => s.allergenReplaced === "allergy_risk")).toBeDefined();
  });

  it("still drops a below-threshold aggregate when the block is off (no behaviour change)", async () => {
    const hass = makeSummaryHass({ summaryState: "0" });
    const config = makeConfig({
      allergens: ["allergy_risk"],
      pollen_threshold: 1,
      days_to_show: 1,
      show_summary_block: false,
    });
    const result = await fetchForecast(hass, config);
    expect(result.find((s) => s.allergenReplaced === "allergy_risk")).toBeUndefined();
  });
});
