import { describe, it, expect } from "vitest";
import { fetchForecast, stubConfigPLU, PLU_SUPPORTED_ALLERGENS } from "../../src/adapters/plu.js";
import { createHass, createPLUSensor, assertSensorShape } from "../helpers.js";

function makeConfig(overrides = {}) {
  return { ...stubConfigPLU, ...overrides };
}

/**
 * Create hass mock with PLU sensors using canonical allergen names as entity IDs.
 * PLU has no location component: entity pattern is sensor.pollen_{alias}.
 */
function makeHass(allergenMap) {
  const states = {};
  for (const [allergen, value] of Object.entries(allergenMap)) {
    states[`sensor.pollen_${allergen}`] = createPLUSensor(value);
  }
  return createHass(states);
}

describe("PLU adapter: fetchForecast", () => {
  it("returns array of sensor dicts with correct shape", async () => {
    const hass = makeHass({
      birch: 25,
      alder: 5,
    });
    const config = makeConfig({
      allergens: ["birch", "alder"],
    });

    const result = await fetchForecast(hass, config);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    for (const sensor of result) {
      assertSensorShape(sensor);
    }
  });

  it("converts raw grain counts to 0-3 levels using thresholds", async () => {
    // birch thresholds: moderate=11, high=51
    // Use pollen_threshold: 0 to include all results
    const base = { allergens: ["birch"], pollen_threshold: 0 };

    const hass = makeHass({ birch: 0 });
    const result = await fetchForecast(hass, makeConfig(base));
    expect(result[0].day0.state).toBe(0); // 0 grains = level 0

    const hass2 = makeHass({ birch: 5 });
    const result2 = await fetchForecast(hass2, makeConfig(base));
    expect(result2[0].day0.state).toBe(1); // 5 < 11 = level 1 (low)

    const hass3 = makeHass({ birch: 25 });
    const result3 = await fetchForecast(hass3, makeConfig(base));
    expect(result3[0].day0.state).toBe(2); // 11 <= 25 < 51 = level 2 (moderate)

    const hass4 = makeHass({ birch: 100 });
    const result4 = await fetchForecast(hass4, makeConfig(base));
    expect(result4[0].day0.state).toBe(3); // 100 >= 51 = level 3 (high)
  });

  it("returns -1 for NaN/negative values", async () => {
    const states = {
      "sensor.pollen_birch": { state: "unavailable", attributes: {} },
    };
    const hass = createHass(states);
    const config = makeConfig({
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(-1);
  });

  it("has display_state with raw numeric value", async () => {
    const hass = makeHass({ birch: 25 });
    const config = makeConfig({ allergens: ["birch"] });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.display_state).toBe(25);
  });

  it("has PLU-specific extra day properties", async () => {
    const states = {
      "sensor.pollen_birch": createPLUSensor(25, {
        level: "moderate",
        last_update: "2025-06-15T10:00:00",
        next_poll: "2025-06-16T06:00:00",
        moderate_threshold: 11,
        high_threshold: 51,
      }),
    };
    const hass = createHass(states);
    const config = makeConfig({ allergens: ["birch"] });

    const result = await fetchForecast(hass, config);
    const day = result[0].day0;

    expect(day).toHaveProperty("thresholds");
    expect(day.thresholds).toEqual({ moderate: 11, high: 51 });
    expect(day).toHaveProperty("level_string", "moderate");
    expect(day).toHaveProperty("last_update", "2025-06-15T10:00:00");
    expect(day).toHaveProperty("next_poll", "2025-06-16T06:00:00");
  });

  it("default days_to_show is 1", async () => {
    const hass = makeHass({ birch: 25 });
    const config = makeConfig({ allergens: ["birch"] });

    const result = await fetchForecast(hass, config);

    expect(result[0].days.length).toBe(1);
  });

  it("pads days array to days_to_show with empty entries", async () => {
    const hass = makeHass({ birch: 25 });
    const config = makeConfig({ allergens: ["birch"], days_to_show: 3 });

    const result = await fetchForecast(hass, config);

    expect(result[0].days.length).toBe(3);
    // Padded days should have state -1
    expect(result[0].days[1].state).toBe(-1);
    expect(result[0].days[2].state).toBe(-1);
  });

  it("resolves sensors via alias map (Latin name)", async () => {
    // PLU tries multiple aliases: birch -> betula, birch, etc.
    const states = {
      "sensor.pollen_betula": createPLUSensor(30),
    };
    const hass = createHass(states);
    const config = makeConfig({ allergens: ["birch"] });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].entity_id).toBe("sensor.pollen_betula");
  });

  it("skips allergens not in PLU_SUPPORTED_ALLERGENS", async () => {
    const hass = makeHass({ birch: 25 });
    const config = makeConfig({ allergens: ["birch", "unknown_allergen"] });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].allergenReplaced).toBe("birch");
  });

  it("has no manual mode (no location field)", () => {
    expect(stubConfigPLU).not.toHaveProperty("city");
    expect(stubConfigPLU).not.toHaveProperty("location");
    expect(stubConfigPLU).not.toHaveProperty("region_id");
    expect(stubConfigPLU).not.toHaveProperty("entity_prefix");
    expect(stubConfigPLU).not.toHaveProperty("entity_suffix");
  });

  it("filters allergens below pollen_threshold", async () => {
    const hass = makeHass({
      birch: 25,  // level 2
      alder: 0,   // level 0
    });
    const config = makeConfig({
      allergens: ["birch", "alder"],
      pollen_threshold: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].allergenReplaced).toBe("birch");
  });

  it("sorts with locale-aware comparison for name sorting", async () => {
    const hass = makeHass({
      birch: 25,
      alder: 30,
    });
    const config = makeConfig({
      allergens: ["birch", "alder"],
      sort: "name_ascending",
    });

    const result = await fetchForecast(hass, config);

    // PLU passes lang to localeCompare (unique among adapters)
    expect(result.length).toBe(2);
    const names = result.map((s) => s.allergenCapitalized);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it("PLU_SUPPORTED_ALLERGENS is alphabetically sorted", () => {
    const sorted = [...PLU_SUPPORTED_ALLERGENS].sort();
    expect(PLU_SUPPORTED_ALLERGENS).toEqual(sorted);
  });
});
