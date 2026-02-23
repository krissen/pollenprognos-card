import { describe, it, expect } from "vitest";
import {
  fetchForecast,
  stubConfigSILAM,
  SILAM_ALLERGENS,
  SILAM_THRESHOLDS,
  grainsToLevel,
  indexToLevel,
} from "../../src/adapters/silam.js";
import { createHass, assertSensorShape } from "../helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides = {}) {
  return { ...stubConfigSILAM, ...overrides };
}

/**
 * Build a minimal hass mock for SILAM integration tests.
 *
 * The regex fallback path in findSilamWeatherEntity iterates all known
 * weather_suffixes. The Swedish "sv" locale adds "pollenprognos_beta" as a
 * suffix, and "en" locale adds "forecast". We use "forecast" (in English
 * states) so the test works regardless of locale order.
 *
 * Setting hass.entities to an empty object ensures discovery is skipped and
 * the regex fallback runs against hass.states.
 */
function makeHass(location, weatherAttrs = {}, extraStates = {}) {
  // Use "forecast" suffix — present in every locale's weather_suffixes list
  const weatherEntityId = `weather.silam_pollen_${location.toLowerCase()}_forecast`;
  const states = {
    [weatherEntityId]: {
      state: "sunny",
      attributes: {
        pollen_birch: 30,
        pollen_alder: 5,
        index: 2,
        forecast: [
          {
            datetime: "2025-06-16T00:00:00",
            pollen_birch: 40,
            pollen_alder: 10,
            index: 3,
          },
          {
            datetime: "2025-06-17T00:00:00",
            pollen_birch: 20,
            pollen_alder: 2,
            index: 1,
          },
        ],
        ...weatherAttrs,
      },
    },
    ...extraStates,
  };
  // Empty hass.entities forces the regex fallback path
  return createHass(states, { entities: {}, language: "en" });
}

// ---------------------------------------------------------------------------
// grainsToLevel
// ---------------------------------------------------------------------------

describe("grainsToLevel", () => {
  it("returns -1 for unknown allergen", () => {
    expect(grainsToLevel("unknown_plant", 100)).toBe(-1);
  });

  it("returns -1 for NaN grains", () => {
    expect(grainsToLevel("birch", NaN)).toBe(-1);
  });

  describe("birch thresholds [1, 25, 50, 100, 500, 1000, 5000]", () => {
    it("grains=0 -> level 0 (below first threshold)", () => {
      expect(grainsToLevel("birch", 0)).toBe(0);
    });

    it("grains=1 -> level 1 (at first threshold)", () => {
      expect(grainsToLevel("birch", 1)).toBe(1);
    });

    it("grains=24 -> level 1 (below second threshold)", () => {
      expect(grainsToLevel("birch", 24)).toBe(1);
    });

    it("grains=25 -> level 2 (at second threshold)", () => {
      expect(grainsToLevel("birch", 25)).toBe(2);
    });

    it("grains=49 -> level 2 (below third threshold)", () => {
      expect(grainsToLevel("birch", 49)).toBe(2);
    });

    it("grains=50 -> level 3 (at third threshold)", () => {
      expect(grainsToLevel("birch", 50)).toBe(3);
    });

    it("grains=100 -> level 4 (at fourth threshold)", () => {
      expect(grainsToLevel("birch", 100)).toBe(4);
    });

    it("grains=500 -> level 5 (at fifth threshold)", () => {
      expect(grainsToLevel("birch", 500)).toBe(5);
    });

    it("grains=1000 -> level 6 (at sixth threshold)", () => {
      expect(grainsToLevel("birch", 1000)).toBe(6);
    });

    it("grains=5000 -> level 6 (at or above max threshold)", () => {
      expect(grainsToLevel("birch", 5000)).toBe(6);
    });

    it("grains=9999 -> level 6 (above all thresholds)", () => {
      expect(grainsToLevel("birch", 9999)).toBe(6);
    });
  });

  describe("alder thresholds [1, 10, 25, 50, 100, 500, 1000]", () => {
    it("grains=0 -> level 0", () => {
      expect(grainsToLevel("alder", 0)).toBe(0);
    });

    it("grains=1 -> level 1", () => {
      expect(grainsToLevel("alder", 1)).toBe(1);
    });

    it("grains=10 -> level 2", () => {
      expect(grainsToLevel("alder", 10)).toBe(2);
    });

    it("grains=1000 -> level 6", () => {
      expect(grainsToLevel("alder", 1000)).toBe(6);
    });
  });

  it("grass uses same thresholds as birch", () => {
    expect(SILAM_THRESHOLDS.grass).toEqual(SILAM_THRESHOLDS.birch);
    expect(grainsToLevel("grass", 50)).toBe(3);
  });

  it("hazel uses same thresholds as birch", () => {
    expect(SILAM_THRESHOLDS.hazel).toEqual(SILAM_THRESHOLDS.birch);
    expect(grainsToLevel("hazel", 1)).toBe(1);
  });

  it("ragweed uses same thresholds as alder", () => {
    expect(SILAM_THRESHOLDS.ragweed).toEqual(SILAM_THRESHOLDS.alder);
    expect(grainsToLevel("ragweed", 10)).toBe(2);
  });

  it("mugwort uses same thresholds as alder", () => {
    expect(SILAM_THRESHOLDS.mugwort).toEqual(SILAM_THRESHOLDS.alder);
    expect(grainsToLevel("mugwort", 25)).toBe(3);
  });

  it("olive uses same thresholds as alder", () => {
    expect(SILAM_THRESHOLDS.olive).toEqual(SILAM_THRESHOLDS.alder);
    expect(grainsToLevel("olive", 100)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// indexToLevel
// ---------------------------------------------------------------------------

describe("indexToLevel", () => {
  describe("numeric input", () => {
    it("0 -> 0", () => {
      expect(indexToLevel(0)).toBe(0);
    });

    it("1 -> 1", () => {
      expect(indexToLevel(1)).toBe(1);
    });

    it("2 -> 3", () => {
      expect(indexToLevel(2)).toBe(3);
    });

    it("3 -> 5", () => {
      expect(indexToLevel(3)).toBe(5);
    });

    it("4 -> 6", () => {
      expect(indexToLevel(4)).toBe(6);
    });

    it("clamps values below 0 to scale[0]=0", () => {
      expect(indexToLevel(-1)).toBe(0);
    });

    it("clamps values above 4 to scale[4]=6", () => {
      expect(indexToLevel(5)).toBe(6);
    });

    it("rounds non-integer numeric input: 2.6 -> round(2.6)=3 -> scale[3]=5", () => {
      expect(indexToLevel(2.6)).toBe(5);
    });

    it("rounds non-integer: 1.4 -> round(1.4)=1 -> scale[1]=1", () => {
      expect(indexToLevel(1.4)).toBe(1);
    });
  });

  describe("string input", () => {
    it("'very_low' -> 0", () => {
      expect(indexToLevel("very_low")).toBe(0);
    });

    it("'low' -> 1", () => {
      expect(indexToLevel("low")).toBe(1);
    });

    it("'moderate' -> 3", () => {
      expect(indexToLevel("moderate")).toBe(3);
    });

    it("'high' -> 5", () => {
      expect(indexToLevel("high")).toBe(5);
    });

    it("'very_high' -> 6", () => {
      expect(indexToLevel("very_high")).toBe(6);
    });

    it("unknown string -> -1", () => {
      expect(indexToLevel("unknown")).toBe(-1);
    });

    it("empty string -> -1", () => {
      expect(indexToLevel("")).toBe(-1);
    });

    it("case-insensitive: 'VERY_LOW' -> 0", () => {
      expect(indexToLevel("VERY_LOW")).toBe(0);
    });

    it("case-insensitive: 'High' -> 5", () => {
      expect(indexToLevel("High")).toBe(5);
    });
  });

  describe("null / undefined / non-parseable", () => {
    it("null -> -1", () => {
      expect(indexToLevel(null)).toBe(-1);
    });

    it("undefined -> -1", () => {
      expect(indexToLevel(undefined)).toBe(-1);
    });
  });
});

// ---------------------------------------------------------------------------
// SILAM_ALLERGENS and stubConfigSILAM
// ---------------------------------------------------------------------------

describe("SILAM_ALLERGENS", () => {
  it("includes all stub allergens plus 'index'", () => {
    for (const allergen of stubConfigSILAM.allergens) {
      expect(SILAM_ALLERGENS).toContain(allergen);
    }
    expect(SILAM_ALLERGENS).toContain("index");
  });

  it("has exactly one more entry than stubConfigSILAM.allergens", () => {
    expect(SILAM_ALLERGENS.length).toBe(stubConfigSILAM.allergens.length + 1);
  });
});

describe("stubConfigSILAM", () => {
  it("has integration field set to 'silam'", () => {
    expect(stubConfigSILAM.integration).toBe("silam");
  });

  it("has index_top defaulting to true", () => {
    expect(stubConfigSILAM.index_top).toBe(true);
  });

  it("has mode defaulting to 'daily'", () => {
    expect(stubConfigSILAM.mode).toBe("daily");
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: weather entity discovery via regex fallback
// ---------------------------------------------------------------------------

describe("fetchForecast: basic shape", () => {
  it("returns empty array when weather entity is missing", async () => {
    const hass = createHass({}, { entities: {} });
    const config = makeConfig({ location: "stockholm", allergens: ["birch"] });

    const result = await fetchForecast(hass, config);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it("returns array of sensor dicts with correct shape", async () => {
    const hass = makeHass("stockholm");
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch", "alder"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    for (const sensor of result) {
      assertSensorShape(sensor);
    }
  });

  it("each day object has required properties", async () => {
    const hass = makeHass("stockholm");
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch"],
      pollen_threshold: 0,
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

  it("allergenReplaced is the canonical allergen key", async () => {
    const hass = makeHass("stockholm");
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].allergenReplaced).toBe("birch");
  });

  it("allergenCapitalized is a non-empty string", async () => {
    const hass = makeHass("stockholm");
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch"],
      pollen_threshold: 0,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].allergenCapitalized).toBeTruthy();
    expect(typeof result[0].allergenCapitalized).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: grain count -> level conversion
// ---------------------------------------------------------------------------

describe("fetchForecast: level computation from grain counts", () => {
  it("converts pollen_birch=30 to level 2 (between thresholds 25 and 50)", async () => {
    const hass = makeHass("stockholm", { pollen_birch: 30, forecast: [] });
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(2);
  });

  it("converts pollen_alder=5 to level 1 (between thresholds 1 and 10)", async () => {
    const hass = makeHass("stockholm", { pollen_alder: 5, forecast: [] });
    const config = makeConfig({
      location: "stockholm",
      allergens: ["alder"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(1);
  });

  it("converts index=2 attribute to level 3 via indexToLevel", async () => {
    const hass = makeHass("stockholm", { index: 2, forecast: [] });
    const config = makeConfig({
      location: "stockholm",
      allergens: ["index"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    // allergens: ["index"] normalizes to "allergy_risk" internally
    expect(result[0].day0.state).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: forecast array (entity.attributes.forecast)
// ---------------------------------------------------------------------------

describe("fetchForecast: daily forecast from entity.attributes.forecast", () => {
  it("uses forecast items for subsequent days beyond today", async () => {
    const hass = makeHass("stockholm");
    // Default weather entity has pollen_birch=30 (current) and
    // forecast[0].pollen_birch=40, forecast[1].pollen_birch=20
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 3,
    });

    const result = await fetchForecast(hass, config);

    // day0: current value 30 -> level 2
    expect(result[0].day0.state).toBe(2);
    // day1: forecast[0] pollen_birch=40 -> level 2
    expect(result[0].day1.state).toBe(2);
    // day2: forecast[1] pollen_birch=20 -> level 1
    expect(result[0].day2.state).toBe(1);
  });

  it("limits forecast to days_to_show", async () => {
    const hass = makeHass("stockholm");
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 2,
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].days.length).toBe(2);
    expect(result[0].day2).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: forecastEvent third parameter
// ---------------------------------------------------------------------------

describe("fetchForecast: forecastEvent parameter", () => {
  it("uses forecastEvent.forecast instead of entity.attributes.forecast", async () => {
    const hass = makeHass("stockholm", {
      // entity.attributes.forecast has pollen_birch=40 for day1
      forecast: [
        { datetime: "2025-06-16T00:00:00", pollen_birch: 40, index: 3 },
        { datetime: "2025-06-17T00:00:00", pollen_birch: 20, index: 1 },
      ],
    });

    // forecastEvent overrides with different values
    const forecastEvent = {
      forecast: [
        { datetime: "2025-06-16T00:00:00", pollen_birch: 600, index: 4 },
        { datetime: "2025-06-17T00:00:00", pollen_birch: 1200, index: 4 },
      ],
    };

    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 3,
    });

    const result = await fetchForecast(hass, config, forecastEvent);

    // day1 comes from forecastEvent.forecast[0]: pollen_birch=600 -> level 5
    expect(result[0].day1.state).toBe(5);
    // day2 comes from forecastEvent.forecast[1]: pollen_birch=1200 -> level 6
    expect(result[0].day2.state).toBe(6);
  });

  it("ignores forecastEvent when forecast array is absent", async () => {
    const hass = makeHass("stockholm");
    const forecastEvent = { type: "weather/subscribe_forecast", message_id: 1 };
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch"],
      pollen_threshold: 0,
      days_to_show: 2,
    });

    // Should not throw and should fall back to entity.attributes.forecast
    const result = await fetchForecast(hass, config, forecastEvent);

    expect(Array.isArray(result)).toBe(true);
    expect(result[0].days.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: pollen_threshold filtering
// ---------------------------------------------------------------------------

describe("fetchForecast: pollen_threshold filtering", () => {
  it("excludes allergens whose max level is below threshold", async () => {
    // pollen_olive=0 everywhere -> level 0 < threshold 1
    const hass = makeHass("stockholm", {
      pollen_birch: 30,
      pollen_olive: 0,
      forecast: [
        { datetime: "2025-06-16T00:00:00", pollen_birch: 40, pollen_olive: 0 },
      ],
    });
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch", "olive"],
      pollen_threshold: 1,
      days_to_show: 2,
    });

    const result = await fetchForecast(hass, config);

    const allergens = result.map((s) => s.allergenReplaced);
    expect(allergens).toContain("birch");
    expect(allergens).not.toContain("olive");
  });

  it("includes all allergens when pollen_threshold is 0", async () => {
    const hass = makeHass("stockholm", {
      pollen_birch: 0,
      pollen_alder: 0,
      forecast: [],
    });
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch", "alder"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: sorting
// ---------------------------------------------------------------------------

describe("fetchForecast: sorting", () => {
  it("sorts by value_descending by default", async () => {
    // birch=5 (level 1), alder=30 (level 3 with alder thresholds: 25<30<50)
    const hass = makeHass("stockholm", {
      pollen_birch: 5,
      pollen_alder: 30,
      forecast: [],
    });
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch", "alder"],
      pollen_threshold: 0,
      sort: "value_descending",
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(2);
    expect(result[0].day0.state).toBeGreaterThanOrEqual(result[1].day0.state);
  });

  it("sorts by value_ascending", async () => {
    const hass = makeHass("stockholm", {
      pollen_birch: 5,
      pollen_alder: 30,
      forecast: [],
    });
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch", "alder"],
      pollen_threshold: 0,
      sort: "value_ascending",
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(2);
    expect(result[0].day0.state).toBeLessThanOrEqual(result[1].day0.state);
  });

  it("sort: 'none' preserves allergen order", async () => {
    const hass = makeHass("stockholm", {
      pollen_birch: 50,
      pollen_alder: 0,
      forecast: [],
    });
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch", "alder"],
      pollen_threshold: 0,
      sort: "none",
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(2);
    expect(result[0].allergenReplaced).toBe("birch");
    expect(result[1].allergenReplaced).toBe("alder");
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: index_top pinning
// ---------------------------------------------------------------------------

describe("fetchForecast: index_top pinning", () => {
  it("moves allergy_risk/index to front when index_top is true", async () => {
    const hass = makeHass("stockholm", {
      pollen_birch: 500,
      pollen_alder: 100,
      index: 3,
      forecast: [],
    });
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch", "alder", "index"],
      pollen_threshold: 0,
      sort: "value_descending",
      index_top: true,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    // allergy_risk (index) must appear first regardless of sort order
    expect(result[0].allergenReplaced).toBe("allergy_risk");
  });

  it("does not rearrange when index_top is false", async () => {
    const hass = makeHass("stockholm", {
      pollen_birch: 500,
      pollen_alder: 100,
      index: 3,
      forecast: [],
    });
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch", "alder", "index"],
      pollen_threshold: 0,
      sort: "value_descending",
      index_top: false,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    // With index_top false and value_descending, birch (level 5) or alder (level 5)
    // should come first, not index
    expect(result[0].allergenReplaced).not.toBe("allergy_risk");
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: hourly / twice_daily mode
// ---------------------------------------------------------------------------

describe("fetchForecast: hourly mode", () => {
  it("uses only forecast items (no current-entity day) in hourly mode", async () => {
    const hass = makeHass("stockholm");
    // Default weather entity has 2 forecast items
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch"],
      pollen_threshold: 0,
      mode: "hourly",
      days_to_show: 2,
    });

    const result = await fetchForecast(hass, config);

    // In hourly mode maxItems = min(forecastArr.length, days_to_show) = min(2, 2) = 2
    expect(result[0].days.length).toBe(2);
  });

  it("uses datetime from forecast items for day labels in hourly mode", async () => {
    const hass = makeHass("stockholm");
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch"],
      pollen_threshold: 0,
      mode: "hourly",
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    // Hourly label should be a time string (HH:MM format), not a weekday name
    const label = result[0].day0.day;
    expect(typeof label).toBe("string");
    expect(label.length).toBeGreaterThan(0);
  });
});

describe("fetchForecast: twice_daily mode", () => {
  it("sets icon for morning/evening slots", async () => {
    const hass = makeHass("stockholm");
    const config = makeConfig({
      location: "stockholm",
      allergens: ["birch"],
      pollen_threshold: 0,
      mode: "twice_daily",
      days_to_show: 2,
    });

    const result = await fetchForecast(hass, config);

    // Even index = morning, odd = evening
    expect(result[0].day0.icon).toBe("mdi:weather-sunset-up");
    expect(result[0].day1.icon).toBe("mdi:weather-sunset-down");
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: manual mode entity resolution
// ---------------------------------------------------------------------------

describe("fetchForecast: manual mode", () => {
  /**
   * In manual mode, config.location === "manual" is treated as an empty
   * configLocation internally. The regex fallback path in findSilamWeatherEntity
   * is skipped when location is empty. So the weather entity must be found via
   * discoverSilamSensors (hass.entities). We supply a minimal entity registry
   * entry with platform "silam_pollen" for a weather entity (no entity_category),
   * which causes discovery to pick it up automatically as the first (and only)
   * location.
   */
  it("resolves sensor via entity_prefix/entity_suffix in manual mode", async () => {
    const weatherEntityId = "weather.silam_pollen_myplace_forecast";
    // The manual mode slug lookup iterates silamAllergenMap.mapping in JSON key order
    // (nl, de, ru, fi, sk, en, ...). For allergen "birch", the Dutch mapping
    // "berk" -> "birch" is found first, so slug = "berk" and the expected
    // candidate entity is "sensor.custom_berk_end".
    const states = {
      [weatherEntityId]: {
        state: "sunny",
        attributes: {
          pollen_birch: 30,
          forecast: [],
        },
      },
      "sensor.custom_berk_end": {
        state: "30",
        attributes: {},
      },
    };
    // Entity registry entry for the weather entity: platform=silam_pollen,
    // no entity_category. The entity ID starts with "weather." so discovery
    // treats it as the weather entity for its config entry group.
    const entities = {
      [weatherEntityId]: {
        entity_id: weatherEntityId,
        platform: "silam_pollen",
        device_id: null,
        entity_category: null,
      },
    };
    const hass = createHass(states, { entities, language: "en" });
    const config = makeConfig({
      location: "manual",
      allergens: ["birch"],
      entity_prefix: "custom_",
      entity_suffix: "_end",
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    // entity_id is set to whichever sensor slug was resolved from the
    // allergen map (first-language match). "berk" is the Dutch slug for birch.
    expect(result[0].entity_id).toBe("sensor.custom_berk_end");
  });
});

// ---------------------------------------------------------------------------
// fetchForecast: index allergen via 'index' config key
// ---------------------------------------------------------------------------

describe("fetchForecast: 'index' allergen alias", () => {
  it("normalizes 'index' in config to 'allergy_risk' internally", async () => {
    const hass = makeHass("stockholm", { index: 2, forecast: [] });
    const config = makeConfig({
      location: "stockholm",
      allergens: ["index"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].allergenReplaced).toBe("allergy_risk");
  });

  it("uses pollen_index attribute as fallback when index is absent", async () => {
    const hass = makeHass("stockholm", {
      pollen_index: 3,
      forecast: [],
    });
    // Explicitly remove the 'index' attribute from the weather entity
    const weatherEntity =
      hass.states["weather.silam_pollen_stockholm_forecast"];
    delete weatherEntity.attributes.index;

    const config = makeConfig({
      location: "stockholm",
      allergens: ["index"],
      pollen_threshold: 0,
      days_to_show: 1,
    });

    const result = await fetchForecast(hass, config);

    // index=3 via indexToLevel(3) -> scale[3] = 5
    expect(result[0].day0.state).toBe(5);
  });
});
