import { describe, it, expect } from "vitest";
import {
  fetchForecast,
  resolveEntityIds,
  stubConfigMSW,
} from "../../src/adapters/msw.js";
import { createHass, createMSWSensor, assertSensorShape } from "../helpers.js";

function makeConfig(overrides = {}) {
  return { ...stubConfigMSW, ...overrides };
}

function makeHass(allergenMap) {
  // allergenMap: { canonical_allergen: [mswSlug, levelStr, postcode?, station?] }
  const states = {};
  for (const [canonical, [mswSlug, levelStr, postcode, station]] of Object.entries(allergenMap)) {
    const pc = postcode ?? "8000";
    const st = station ?? "za";
    states[`sensor.pollen_${mswSlug}_level_at_${pc}_${st}`] = createMSWSensor(levelStr);
  }
  return createHass(states, { language: "en" });
}

describe("MSW adapter: resolveEntityIds", () => {
  it("maps canonical allergen to hass-swissweather entity id", () => {
    const hass = makeHass({ birch: ["birch", "Low"] });
    const config = makeConfig({ allergens: ["birch"] });

    const result = resolveEntityIds(config, hass);

    expect(result.get("birch")).toBe("sensor.pollen_birch_level_at_8000_za");
  });

  it("maps grass (canonical) to grasses (swissweather slug) entity", () => {
    const hass = makeHass({ grass: ["grasses", "Medium"] });
    const config = makeConfig({ allergens: ["grass"] });

    const result = resolveEntityIds(config, hass);

    expect(result.get("grass")).toBe("sensor.pollen_grasses_level_at_8000_za");
  });

  it("ignores unknown allergens", () => {
    const hass = createHass({});
    const config = makeConfig({ allergens: ["unknownpollen"] });

    const result = resolveEntityIds(config, hass);

    expect(result.size).toBe(0);
  });

  it("skips allergen when no matching entity exists", () => {
    const hass = createHass({});
    const config = makeConfig({ allergens: ["birch"] });

    const result = resolveEntityIds(config, hass);

    expect(result.has("birch")).toBe(false);
  });
});

describe("MSW adapter: fetchForecast", () => {
  it("returns array of sensor dicts with correct contract shape", async () => {
    const hass = makeHass({ birch: ["birch", "Medium"] });
    const config = makeConfig({ allergens: ["birch"] });

    const result = await fetchForecast(hass, config);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    assertSensorShape(result[0]);
  });

  it("maps all 5 hass-swissweather levels to correct 0-6 values", async () => {
    const levelCases = [
      ["None", 0],
      ["Low", 1],
      ["Medium", 3],
      ["Strong", 5],
      ["Very Strong", 6],
    ];

    for (const [levelStr, expected] of levelCases) {
      const hass = makeHass({ birch: ["birch", levelStr] });
      const config = makeConfig({ allergens: ["birch"] });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].day0.state).toBe(expected);
      expect(result[0].day0.display_state).toBe(expected);
    }
  });

  it("returns only one day per allergen", async () => {
    const hass = makeHass({ birch: ["birch", "Low"] });
    const config = makeConfig({ allergens: ["birch"] });

    const result = await fetchForecast(hass, config);

    expect(result[0].days.length).toBe(1);
  });

  it("allergenReplaced matches canonical key", async () => {
    const hass = makeHass({ grass: ["grasses", "Low"] });
    const config = makeConfig({ allergens: ["grass"] });

    const result = await fetchForecast(hass, config);

    expect(result[0].allergenReplaced).toBe("grass");
  });

  it("entity_id is set correctly", async () => {
    const hass = makeHass({ alder: ["alder", "Low"] });
    const config = makeConfig({ allergens: ["alder"] });

    const result = await fetchForecast(hass, config);

    expect(result[0].entity_id).toBe("sensor.pollen_alder_level_at_8000_za");
  });

  it("skips allergen with unavailable / unknown state", async () => {
    const states = {
      "sensor.pollen_birch_level_at_8000_za": { state: "unavailable", attributes: {} },
    };
    const hass = createHass(states);
    const config = makeConfig({ allergens: ["birch"] });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(0);
  });

  it("pollen_threshold=0 includes None-level allergens", async () => {
    const hass = makeHass({ birch: ["birch", "None"] });
    const config = makeConfig({ allergens: ["birch"], pollen_threshold: 0 });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].day0.state).toBe(0);
  });

  it("pollen_threshold>0 filters out None-level allergens", async () => {
    const hass = makeHass({
      birch: ["birch", "None"],
      oak: ["oak", "Low"],
    });
    const config = makeConfig({
      allergens: ["birch", "oak"],
      pollen_threshold: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].allergenReplaced).toBe("oak");
  });

  it("sorts by value_descending by default", async () => {
    const hass = makeHass({
      birch: ["birch", "Low"],
      oak: ["oak", "Strong"],
    });
    const config = makeConfig({
      allergens: ["birch", "oak"],
      sort: "value_descending",
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBeGreaterThanOrEqual(result[1].day0.state);
  });

  it("handles multiple allergens", async () => {
    const hass = makeHass({
      birch: ["birch", "Medium"],
      grass: ["grasses", "Low"],
      alder: ["alder", "None"],
    });
    const config = makeConfig({
      allergens: ["birch", "grass", "alder"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(3);
  });

  it("stubConfigMSW has days_to_show set to 1", () => {
    expect(stubConfigMSW.days_to_show).toBe(1);
  });

  it("integration key is msw", () => {
    expect(stubConfigMSW.integration).toBe("msw");
  });
});
