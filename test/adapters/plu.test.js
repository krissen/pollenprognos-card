import { describe, it, expect } from "vitest";
import { fetchForecast, stubConfigPLU, PLU_SUPPORTED_ALLERGENS, discoverPluSensors, resolveEntityIds } from "../../src/adapters/plu.js";
import { createHass, createPLUSensor, assertSensorShape, assertDiscoveryShape, createHassWithRegistry } from "../helpers.js";

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

describe("PLU adapter: discoverPluSensors (tier 2 via entity registry)", () => {
  it("returns valid discovery shape with entities from platform pollen_lu", () => {
    const deviceId = "device_plu_001";
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.pollen_birch",
        state: "25",
        attributes: { unit_of_measurement: "grains/m\u00B3" },
        deviceId,
        platform: "pollen_lu",
        deviceMeta: {
          name: "Pollen.lu",
          identifiers: [["pollen_lu", "pollen_lu_luxembourg"]],
          configEntries: ["cfg_plu_001"],
        },
      },
      {
        entityId: "sensor.pollen_betula",
        state: "30",
        attributes: { unit_of_measurement: "grains/m\u00B3" },
        deviceId,
        platform: "pollen_lu",
      },
      {
        entityId: "sensor.pollen_alder",
        state: "5",
        attributes: { unit_of_measurement: "grains/m\u00B3" },
        deviceId,
        platform: "pollen_lu",
      },
    ]);

    const discovery = discoverPluSensors(hass);

    assertDiscoveryShape(discovery);
    expect(discovery.tierUsed).toBeGreaterThanOrEqual(1);
    expect(discovery.locations.size).toBe(1);

    const [, location] = discovery.locations.entries().next().value;
    // sensor.pollen_birch -> canonical "birch"
    expect(location.entities.get("birch")).toBe("sensor.pollen_birch");
    // sensor.pollen_betula -> also canonical "birch" (Latin alias)
    // Note: collision: first entity wins, second is silently skipped
    // The important guarantee is that at least one birch entity was classified
    expect(["sensor.pollen_birch", "sensor.pollen_betula"]).toContain(location.entities.get("birch"));
    // sensor.pollen_alder -> canonical "alder"
    expect(location.entities.get("alder")).toBe("sensor.pollen_alder");
  });

  it("resolveEntityIds uses discovery when entity registry is available", () => {
    const deviceId = "device_plu_002";
    const hass = createHassWithRegistry([
      {
        entityId: "sensor.pollen_birch",
        state: "25",
        attributes: { unit_of_measurement: "grains/m\u00B3" },
        deviceId,
        platform: "pollen_lu",
        deviceMeta: {
          name: "Pollen Luxembourg",
          identifiers: [["pollen_lu", "pollen_lu_main"]],
          configEntries: ["cfg_plu_002"],
        },
      },
      {
        entityId: "sensor.pollen_alder",
        state: "5",
        attributes: { unit_of_measurement: "grains/m\u00B3" },
        deviceId,
        platform: "pollen_lu",
      },
    ]);

    const cfg = { ...stubConfigPLU, allergens: ["birch", "alder", "hazel"] };
    const result = resolveEntityIds(cfg, hass);

    // birch and alder are in entity registry -> discovery path
    expect(result.get("birch")).toBe("sensor.pollen_birch");
    expect(result.get("alder")).toBe("sensor.pollen_alder");
    // hazel has no entity in the registry -> not in result
    expect(result.has("hazel")).toBe(false);
  });
});

describe("PLU adapter: resolveEntityIds alias-probe fallback", () => {
  it("falls back to alias-probe when no entity registry is present", () => {
    // Plain hass mock without entities/devices -- simulates legacy HA setup
    const states = {
      "sensor.pollen_betula": createPLUSensor(30),
      "sensor.pollen_alder": createPLUSensor(5),
    };
    const hass = createHass(states);
    const cfg = { ...stubConfigPLU, allergens: ["birch", "alder"] };

    const result = resolveEntityIds(cfg, hass);

    // sensor.pollen_betula is a Latin alias for birch -> alias-probe finds it
    expect(result.get("birch")).toBe("sensor.pollen_betula");
    expect(result.get("alder")).toBe("sensor.pollen_alder");
  });

  it("alias-probe classifies both canonical English keys and Latin/French aliases", () => {
    // Verify the reverse-alias map covers all alias forms
    const states = {
      "sensor.pollen_bouleau": createPLUSensor(20),  // French alias for birch
      "sensor.pollen_corylus": createPLUSensor(8),   // Latin alias for hazel
      "sensor.pollen_mugwort": createPLUSensor(3),   // English canonical
    };
    const hass = createHass(states);
    const cfg = { ...stubConfigPLU, allergens: ["birch", "hazel", "mugwort"] };

    const result = resolveEntityIds(cfg, hass);

    expect(result.get("birch")).toBe("sensor.pollen_bouleau");
    expect(result.get("hazel")).toBe("sensor.pollen_corylus");
    expect(result.get("mugwort")).toBe("sensor.pollen_mugwort");
  });
});
