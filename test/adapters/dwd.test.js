import { describe, it, expect } from "vitest";
import { fetchForecast, stubConfigDWD, discoverDwdSensors, resolveEntityIds } from "../../src/adapters/dwd.js";
import { createHass, createDWDSensor, assertSensorShape, assertDiscoveryShape, createHassWithRegistry } from "../helpers.js";

function makeConfig(overrides = {}) {
  return { ...stubConfigDWD, ...overrides };
}

function makeHass(regionId, allergenMap) {
  const states = {};
  for (const [allergen, [today, tomorrow, twoDays]] of Object.entries(allergenMap)) {
    states[`sensor.pollenflug_${allergen}_${regionId}`] = createDWDSensor(
      today, tomorrow, twoDays,
    );
  }
  return createHass(states, { language: "de" });
}

describe("DWD adapter: fetchForecast", () => {
  it("returns array of sensor dicts with correct shape", async () => {
    const hass = makeHass("50", {
      erle: [1, 2, 0],
      birke: [3, 1, 0],
    });
    const config = makeConfig({
      region_id: "50",
      allergens: ["erle", "birke"],
    });

    const result = await fetchForecast(hass, config);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    for (const sensor of result) {
      assertSensorShape(sensor);
    }
  });

  it("uses normalizeDWD for allergen slugs", async () => {
    const hass = makeHass("50", { graeser: [2, 1, 0] });
    const config = makeConfig({
      region_id: "50",
      allergens: ["gräser"],
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].allergenReplaced).toBe("graeser");
  });

  it("scales levels by factor of 2 (DWD 0-3 to display 0-6)", async () => {
    const hass = makeHass("50", { erle: [3, 1.5, 0] });
    const config = makeConfig({
      region_id: "50",
      allergens: ["erle"],
    });

    const result = await fetchForecast(hass, config);

    // DWD level 3 * 2 = 6
    expect(result[0].day0.display_state).toBe(6);
    // DWD level 1.5 * 2 = 3
    expect(result[0].day1.display_state).toBe(3);
    // DWD level 0 * 2 = 0
    // Note: day0.state stores the RAW level (not scaled)
    expect(result[0].day0.state).toBe(3);
  });

  it("returns -1 for NaN values", async () => {
    const states = {
      "sensor.pollenflug_erle_50": {
        state: "unknown",
        attributes: {
          state_tomorrow: "unavailable",
          state_in_2_days: "1",
          state_today_desc: "",
          state_tomorrow_desc: "",
          state_in_2_days_desc: "",
        },
      },
    };
    const hass = createHass(states, { language: "de" });
    const config = makeConfig({
      region_id: "50",
      allergens: ["erle"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    // NaN values produce level -1, which means the day is skipped
    // (level !== null && level >= 0 check at line 186)
    // Only the valid day (day_in_2_days = 1) should appear
    expect(result.length).toBe(1);
    // day0 should be absent or the valid day
  });

  it("default days_to_show is 2 (but DWD always has 3 source days)", async () => {
    const hass = makeHass("50", { erle: [2, 1, 0] });
    const config = makeConfig({
      region_id: "50",
      allergens: ["erle"],
    });

    const result = await fetchForecast(hass, config);

    // DWD always builds 3 levels (today, tomorrow, day_after).
    // days_to_show only affects threshold filtering and padding, not output slicing.
    // All 3 valid days appear in output.
    expect(result[0].days.length).toBe(3);
    expect(stubConfigDWD.days_to_show).toBe(2);
  });

  it("default pollen_threshold is 0.5", async () => {
    const hass = makeHass("50", {
      erle: [1, 0, 0],
      birke: [0, 0, 0],
    });
    const config = makeConfig({
      region_id: "50",
      allergens: ["erle", "birke"],
    });

    const result = await fetchForecast(hass, config);

    // erle has level 1 (meets 0.5 threshold), birke has 0 (below)
    expect(result.length).toBe(1);
    expect(result[0].allergenReplaced).toBe("erle");
  });

  it("handles manual mode", async () => {
    const states = {
      "sensor.custom_erle_end": createDWDSensor(2, 1, 0),
    };
    const hass = createHass(states, { language: "de" });
    const config = makeConfig({
      region_id: "manual",
      allergens: ["erle"],
      entity_prefix: "custom_",
      entity_suffix: "_end",
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].entity_id).toBe("sensor.custom_erle_end");
  });

  it("sorts by value_descending by default", async () => {
    const hass = makeHass("50", {
      erle: [1, 0, 0],
      birke: [3, 2, 1],
    });
    const config = makeConfig({
      region_id: "50",
      allergens: ["erle", "birke"],
      sort: "value_descending",
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBeGreaterThanOrEqual(result[1].day0.state);
  });

  it("each day object has DWD-specific display_state", async () => {
    const hass = makeHass("50", { erle: [2, 1, 0] });
    const config = makeConfig({
      region_id: "50",
      allergens: ["erle"],
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0).toHaveProperty("display_state");
    // display_state should be level * 2
    expect(result[0].day0.display_state).toBe(result[0].day0.state * 2);
  });

  it("entity_id is set on sensor dict", async () => {
    const hass = makeHass("50", { erle: [2, 1, 0] });
    const config = makeConfig({
      region_id: "50",
      allergens: ["erle"],
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].entity_id).toBe("sensor.pollenflug_erle_50");
  });
});

describe("DWD adapter: discoverDwdSensors", () => {
  it("returns empty discovery for null hass", () => {
    const result = discoverDwdSensors(null);
    assertDiscoveryShape(result);
    expect(result.locations.size).toBe(0);
    expect(result.tierUsed).toBe(0);
  });

  it("tier 3 (fallback): discovers sensors via regex when no registry is available", () => {
    const hass = makeHass("50", {
      erle: [1, 0, 0],
      birke: [2, 1, 0],
      graeser: [0, 1, 0],
    });

    const result = discoverDwdSensors(hass);

    assertDiscoveryShape(result);
    expect(result.tierUsed).toBe(3);
    expect(result.locations.size).toBe(1);

    // In tier 3, the location key is the region ID string
    const [locKey, loc] = [...result.locations.entries()][0];
    expect(locKey).toBe("50");
    expect(loc.entities.has("erle")).toBe(true);
    expect(loc.entities.has("birke")).toBe(true);
    expect(loc.entities.has("graeser")).toBe(true);
    expect(loc.entities.get("erle")).toBe("sensor.pollenflug_erle_50");
  });

  it("tier 2 (entity registry): discovers sensors when platform matches", () => {
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.pollenflug_erle_50",
        state: "1",
        attributes: {
          state_tomorrow: "0",
          state_in_2_days: "0",
          state_today_desc: "",
          state_tomorrow_desc: "",
          state_in_2_days_desc: "",
        },
        deviceId: "dev_dwd_50",
        platform: "dwd_pollenflug",
        deviceMeta: {
          identifiers: [],
          configEntries: ["cfg_dwd_50"],
          name: "DWD Region 50",
        },
      },
      {
        entityId: "sensor.pollenflug_birke_50",
        state: "2",
        attributes: {
          state_tomorrow: "1",
          state_in_2_days: "0",
          state_today_desc: "",
          state_tomorrow_desc: "",
          state_in_2_days_desc: "",
        },
        deviceId: "dev_dwd_50",
        platform: "dwd_pollenflug",
      },
    ]);

    const result = discoverDwdSensors(hass);

    assertDiscoveryShape(result);
    expect(result.tierUsed).toBe(2);
    expect(result.locations.size).toBe(1);

    const [, loc] = [...result.locations.entries()][0];
    expect(loc.entities.has("erle")).toBe(true);
    expect(loc.entities.has("birke")).toBe(true);
    expect(loc.entities.get("erle")).toBe("sensor.pollenflug_erle_50");
  });

  it("tier 3: multi-region — two regions, resolveEntityIds picks correct one via region_id", () => {
    // Simulate two DWD regions (50 and 91) in hass.states
    const states = {
      "sensor.pollenflug_erle_50": createDWDSensor(1, 0, 0),
      "sensor.pollenflug_birke_50": createDWDSensor(2, 1, 0),
      "sensor.pollenflug_erle_91": createDWDSensor(3, 2, 1),
      "sensor.pollenflug_birke_91": createDWDSensor(0, 0, 0),
    };
    const hass = createHass(states, { language: "de" });

    // Config selects region 91
    const config = makeConfig({
      region_id: "91",
      allergens: ["erle", "birke"],
      pollen_threshold: 0,
    });

    const entityMap = resolveEntityIds(config, hass);

    // Should resolve to region 91 entities
    expect(entityMap.get("erle")).toBe("sensor.pollenflug_erle_91");
    expect(entityMap.get("birke")).toBe("sensor.pollenflug_birke_91");
  });

  it("tier 3: resolveEntityIds auto-selects single region when region_id is empty", () => {
    const states = {
      "sensor.pollenflug_erle_50": createDWDSensor(1, 0, 0),
      "sensor.pollenflug_birke_50": createDWDSensor(2, 1, 0),
    };
    const hass = createHass(states, { language: "de" });

    const config = makeConfig({
      region_id: "",
      allergens: ["erle", "birke"],
      pollen_threshold: 0,
    });

    const entityMap = resolveEntityIds(config, hass);

    // With a single region and empty region_id, resolveLocationByKey returns first location
    expect(entityMap.get("erle")).toBe("sensor.pollenflug_erle_50");
    expect(entityMap.get("birke")).toBe("sensor.pollenflug_birke_50");
  });

  it("region label falls back to DWD_REGIONS lookup (tier 3)", () => {
    const hass = makeHass("50", { erle: [1, 0, 0] });

    const result = discoverDwdSensors(hass);

    const [, loc] = [...result.locations.entries()][0];
    expect(loc.label).toBe("Brandenburg und Berlin");
  });

  it("region label beats generic device name", () => {
    // The DWD integration sets device.name = "Pollenflug Gefahrenindex" for
    // every region, which is useless as a card title. Region-derived label
    // from entity_id must outrank the generic device name.
    const hass = {
      states: {
        "sensor.pollenflug_erle_50": { state: "1", attributes: {} },
      },
      entities: {
        "sensor.pollenflug_erle_50": {
          device_id: "dev_dwd",
          platform: "dwd_pollenflug",
          entity_category: null,
        },
      },
      devices: {
        dev_dwd: {
          identifiers: [["dwd_pollenflug", "50"]],
          config_entries: ["cfg_dwd"],
          name: "Pollenflug Gefahrenindex",
          name_by_user: null,
        },
      },
      locale: { language: "en" },
      language: "en",
    };

    const result = discoverDwdSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.label).toBe("Brandenburg und Berlin");
  });

  it("user-customized device name wins over region-derived label", () => {
    const hass = {
      states: {
        "sensor.pollenflug_erle_50": { state: "1", attributes: {} },
      },
      entities: {
        "sensor.pollenflug_erle_50": {
          device_id: "dev_dwd",
          platform: "dwd_pollenflug",
          entity_category: null,
        },
      },
      devices: {
        dev_dwd: {
          identifiers: [["dwd_pollenflug", "50"]],
          config_entries: ["cfg_dwd"],
          name: "Pollenflug Gefahrenindex",
          name_by_user: "My custom region",
        },
      },
      locale: { language: "en" },
      language: "en",
    };

    const result = discoverDwdSensors(hass);
    const [, loc] = [...result.locations.entries()][0];
    expect(loc.label).toBe("My custom region");
  });
});
