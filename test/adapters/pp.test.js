import { describe, it, expect } from "vitest";
import * as PP from "../../src/adapters/pp.js";
import { createHass, createPPSensor, assertSensorShape, createHassWithRegistry } from "../helpers.js";

const { stubConfigPP } = PP;
// Call fetchForecast as method on module to match production call pattern
// (adapter.fetchForecast(hass, config) where `this` is the module object)
const fetchForecast = PP.fetchForecast.bind(PP);

function makeConfig(overrides = {}) {
  return { ...stubConfigPP, ...overrides };
}

function makeHass(cityKey, allergenMap) {
  const states = {};
  for (const [allergen, levels] of Object.entries(allergenMap)) {
    states[`sensor.pollen_${cityKey}_${allergen}`] = createPPSensor(levels);
  }
  return createHass(states);
}

describe("PP adapter: fetchForecast", () => {
  it("returns array of sensor dicts with correct shape", async () => {
    const hass = makeHass("stockholm", {
      bjork: [3, 4, 2, 1],
      al: [1, 2, 0, 0],
    });
    const config = makeConfig({
      city: "Stockholm",
      allergens: ["Björk", "Al"],
    });

    const result = await fetchForecast(hass, config);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    for (const sensor of result) {
      assertSensorShape(sensor);
    }
  });

  it("normalizes allergen names to canonical slugs", async () => {
    const hass = makeHass("stockholm", { bjork: [3, 2, 1, 0] });
    const config = makeConfig({
      city: "Stockholm",
      allergens: ["Björk"],
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].allergenReplaced).toBe("bjork");
  });

  it("resolves allergen display names via i18n", async () => {
    const hass = makeHass("stockholm", { bjork: [3, 2, 1, 0] });
    const config = makeConfig({
      city: "Stockholm",
      allergens: ["Björk"],
    });

    const result = await fetchForecast(hass, config);

    // allergenCapitalized should be a non-empty string (i18n lookup or fallback)
    expect(result[0].allergenCapitalized).toBeTruthy();
    expect(typeof result[0].allergenCapitalized).toBe("string");
  });

  it("returns correct number of days based on days_to_show", async () => {
    const hass = makeHass("stockholm", { bjork: [3, 2, 1, 0, 5, 4] });
    const config = makeConfig({
      city: "Stockholm",
      allergens: ["Björk"],
      days_to_show: 3,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].days.length).toBe(3);
    expect(result[0].day0).toBeDefined();
    expect(result[0].day1).toBeDefined();
    expect(result[0].day2).toBeDefined();
    expect(result[0].day3).toBeUndefined();
  });

  it("clamps levels to 0-6 range, returns null for NaN", async () => {
    const hass = makeHass("stockholm", { bjork: [8, -1, NaN, 3] });
    const config = makeConfig({
      city: "Stockholm",
      allergens: ["Björk"],
      pollen_threshold: 0, // Show all, even with null days
    });

    const result = await fetchForecast(hass, config);

    // Level 8 should be clamped to 6
    expect(result[0].day0.state).toBe(6);
    // -1 and NaN produce null via clampLevel; with pollen_threshold 0
    // these days still appear but with state: 0
    expect(result[0].day1.state).toBe(0);
    expect(result[0].day2.state).toBe(0);
    // Valid level passes through
    expect(result[0].day3.state).toBe(3);
  });

  it("filters allergens below pollen_threshold", async () => {
    const hass = makeHass("stockholm", {
      bjork: [3, 2, 1, 0],
      al: [0, 0, 0, 0],
    });
    const config = makeConfig({
      city: "Stockholm",
      allergens: ["Björk", "Al"],
      pollen_threshold: 1,
    });

    const result = await fetchForecast(hass, config);

    // Only Björk should pass (Al has all 0s, below threshold 1)
    expect(result.length).toBe(1);
    expect(result[0].allergenReplaced).toBe("bjork");
  });

  it("includes all allergens when pollen_threshold is 0", async () => {
    const hass = makeHass("stockholm", {
      bjork: [3, 2, 1, 0],
      al: [0, 0, 0, 0],
    });
    const config = makeConfig({
      city: "Stockholm",
      allergens: ["Björk", "Al"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(2);
  });

  it("sorts by value_descending by default", async () => {
    const hass = makeHass("stockholm", {
      bjork: [1, 0, 0, 0],
      al: [5, 3, 2, 1],
    });
    const config = makeConfig({
      city: "Stockholm",
      allergens: ["Björk", "Al"],
      sort: "value_descending",
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBeGreaterThanOrEqual(result[1].day0.state);
  });

  it("sorts by value_ascending", async () => {
    const hass = makeHass("stockholm", {
      bjork: [5, 4, 3, 2],
      al: [1, 0, 0, 0],
    });
    const config = makeConfig({
      city: "Stockholm",
      allergens: ["Björk", "Al"],
      sort: "value_ascending",
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBeLessThanOrEqual(result[1].day0.state);
  });

  it("respects user phrase overrides for allergen names", async () => {
    const hass = makeHass("stockholm", { bjork: [3, 2, 1, 0] });
    const config = makeConfig({
      city: "Stockholm",
      allergens: ["Björk"],
      phrases: {
        full: { "Björk": "Custom Birch" },
        short: {},
        levels: [],
        days: {},
        no_information: "",
      },
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].allergenCapitalized).toBe("Custom Birch");
  });

  it("handles manual mode entity resolution", async () => {
    const states = {
      "sensor.my_prefix_bjork_suffix": createPPSensor([4, 3, 2, 1]),
    };
    const hass = createHass(states);
    const config = makeConfig({
      city: "manual",
      allergens: ["Björk"],
      entity_prefix: "my_prefix_",
      entity_suffix: "_suffix",
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].entity_id).toBe("sensor.my_prefix_bjork_suffix");
  });

  it("auto-detects city from sensor entity IDs when city is empty", async () => {
    const states = {
      "sensor.pollen_goteborg_bjork": createPPSensor([3, 2, 1, 0]),
    };
    const hass = createHass(states);
    const config = makeConfig({
      city: "",
      allergens: ["Björk"],
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].entity_id).toBe("sensor.pollen_goteborg_bjork");
  });

  it("each day object has required properties", async () => {
    const hass = makeHass("stockholm", { bjork: [3, 4, 2, 1] });
    const config = makeConfig({
      city: "Stockholm",
      allergens: ["Björk"],
    });

    const result = await fetchForecast(hass, config);
    const day = result[0].day0;

    expect(day).toHaveProperty("name");
    expect(day).toHaveProperty("day");
    expect(day).toHaveProperty("state");
    expect(day).toHaveProperty("state_text");
    expect(typeof day.name).toBe("string");
    expect(typeof day.day).toBe("string");
    expect(typeof day.state).toBe("number");
    expect(typeof day.state_text).toBe("string");
  });

  it("entity_id is set on each sensor dict", async () => {
    const hass = makeHass("stockholm", { bjork: [3, 2, 1, 0] });
    const config = makeConfig({
      city: "Stockholm",
      allergens: ["Björk"],
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].entity_id).toBe("sensor.pollen_stockholm_bjork");
  });
});

describe("PP adapter: resolveEntityIds — device-based discovery", () => {
  const { resolveEntityIds } = PP;

  it("tier 2 hit: entity registry with platform pollenprognos returns correct entity IDs", () => {
    // Simulates tier 2: hass.entities present, no hass.devices with PP identifiers
    const levels = [3, 2, 1, 0];
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.pollen_stockholm_bjork",
        attributes: { forecast: createPPSensor(levels).attributes.forecast },
        platform: "pollenprognos",
        deviceId: "device_sthlm",
        deviceMeta: {
          name: "Stockholm",
          configEntries: ["cfg_sthlm"],
        },
      },
      {
        entityId: "sensor.pollen_stockholm_al",
        attributes: { forecast: createPPSensor(levels).attributes.forecast },
        platform: "pollenprognos",
        deviceId: "device_sthlm",
      },
    ]);

    const cfg = {
      city: "Stockholm",
      allergens: ["Björk", "Al"],
    };
    const result = resolveEntityIds(cfg, hass, false);

    expect(result instanceof Map).toBe(true);
    expect(result.get("bjork")).toBe("sensor.pollen_stockholm_bjork");
    expect(result.get("al")).toBe("sensor.pollen_stockholm_al");
  });

  it("multi-city: two discovered locations, config selects the correct one", () => {
    const levels = [2, 1, 0, 0];
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.pollen_goteborg_bjork",
        attributes: { forecast: createPPSensor(levels).attributes.forecast },
        platform: "pollenprognos",
        deviceId: "device_gbg",
        deviceMeta: { name: "Goteborg", configEntries: ["cfg_gbg"] },
      },
      {
        entityId: "sensor.pollen_stockholm_bjork",
        attributes: { forecast: createPPSensor(levels).attributes.forecast },
        platform: "pollenprognos",
        deviceId: "device_sthlm",
        deviceMeta: { name: "Stockholm", configEntries: ["cfg_sthlm"] },
      },
    ]);

    const cfgGbg = { city: "goteborg", allergens: ["Björk"] };
    const resultGbg = resolveEntityIds(cfgGbg, hass, false);
    expect(resultGbg.get("bjork")).toBe("sensor.pollen_goteborg_bjork");

    const cfgSthlm = { city: "stockholm", allergens: ["Björk"] };
    const resultSthlm = resolveEntityIds(cfgSthlm, hass, false);
    expect(resultSthlm.get("bjork")).toBe("sensor.pollen_stockholm_bjork");
  });

  it("legacy slug config (city as slug) falls through to tier 3 regex fallback when no registry", () => {
    // createHass does not provide hass.entities with platform info,
    // so tiers 1 and 2 yield nothing; tier 3 (regex) must fire.
    const hass = createHass({
      "sensor.pollen_stockholm_bjork": createPPSensor([4, 3, 2, 1]),
      "sensor.pollen_stockholm_al": createPPSensor([1, 0, 0, 0]),
    });

    const cfg = { city: "stockholm", allergens: ["Björk", "Al"] };
    const result = resolveEntityIds(cfg, hass, false);

    expect(result.get("bjork")).toBe("sensor.pollen_stockholm_bjork");
    expect(result.get("al")).toBe("sensor.pollen_stockholm_al");
  });
});
