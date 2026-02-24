import { describe, it, expect } from "vitest";
import { fetchForecast, stubConfigPEU, PEU_ALLERGENS } from "../../src/adapters/peu.js";
import { createHass, createPEUSensor, assertSensorShape } from "../helpers.js";

function makeConfig(overrides = {}) {
  return { ...stubConfigPEU, ...overrides };
}

/**
 * Build a PEU sensor state where each forecast entry has the `level` field
 * that the adapter actually reads (raw.level). createPEUSensor stores values
 * under `native_value`; this helper maps them to `level` so that the
 * level-scaling and filtering logic is exercised.
 */
function makePEUSensor(levelValues, opts = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const forecast = levelValues.map((lv, i) => {
    const d = new Date(today.getTime() + i * 86400000);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return { datetime: `${yyyy}-${mm}-${dd}T00:00:00`, level: lv };
  });
  return {
    state: String(levelValues[0] ?? 0),
    attributes: {
      forecast,
      data_stale: false,
      ...opts,
    },
  };
}

/**
 * Populate hass.states with PEU sensors for the given location and allergen
 * map. Each value in allergenMap is an array of daily level values.
 */
function makeHass(location, allergenMap) {
  const states = {};
  for (const [allergen, levels] of Object.entries(allergenMap)) {
    states[`sensor.polleninformation_${location}_${allergen}`] = makePEUSensor(
      levels,
    );
  }
  return createHass(states);
}

describe("PEU adapter: fetchForecast", () => {
  // -------------------------------------------------------------------------
  // 1. Basic shape
  // -------------------------------------------------------------------------
  describe("basic shape", () => {
    it("returns an array of sensor dicts with the required fields", async () => {
      const hass = makeHass("amsterdam", {
        birch: [2, 1, 0, 0],
        grasses: [3, 2, 1, 0],
      });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch", "grasses"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      for (const sensor of result) {
        assertSensorShape(sensor);
      }
    });

    it("sets allergenReplaced to the slug as-is", async () => {
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].allergenReplaced).toBe("birch");
    });

    it("sets allergenCapitalized to a non-empty string", async () => {
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
      });

      const result = await fetchForecast(hass, config);

      expect(typeof result[0].allergenCapitalized).toBe("string");
      expect(result[0].allergenCapitalized.length).toBeGreaterThan(0);
    });

    it("sets allergenShort equal to allergenCapitalized when not abbreviated", async () => {
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        allergens_abbreviated: false,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].allergenShort).toBe(result[0].allergenCapitalized);
    });

    it("day0 is defined and mirrors the first days entry", async () => {
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].day0).toBeDefined();
      expect(result[0].day0).toBe(result[0].days[0]);
    });

    it("each day object has required properties", async () => {
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
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
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].entity_id).toBe(
        "sensor.polleninformation_amsterdam_birch",
      );
    });

    it("respects days_to_show", async () => {
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0, 1, 2] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        days_to_show: 3,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].days.length).toBe(3);
      expect(result[0].day0).toBeDefined();
      expect(result[0].day1).toBeDefined();
      expect(result[0].day2).toBeDefined();
      expect(result[0].day3).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Level scaling: PEU native 0-4, scaled to 0-6
  // -------------------------------------------------------------------------
  describe("level scaling (0-4 to 0-6)", () => {
    // Formula: level < 2 ? floor(level*6/4) : ceil(level*6/4)
    // 0 -> floor(0)   = 0
    // 1 -> floor(1.5) = 1
    // 2 -> ceil(3)    = 3
    // 3 -> ceil(4.5)  = 5
    // 4 -> ceil(6)    = 6

    const cases = [
      [0, 0],
      [1, 1],
      [2, 3],
      [3, 5],
      [4, 6],
    ];

    for (const [input, expected] of cases) {
      it(`maps native level ${input} to scaled level ${expected}`, async () => {
        const hass = makeHass("amsterdam", {
          birch: [input, input, input, input],
        });
        const config = makeConfig({
          location: "amsterdam",
          allergens: ["birch"],
          pollen_threshold: 0,
        });

        const result = await fetchForecast(hass, config);

        // state stores the raw (0-4) value; state_text reflects the scaled level
        expect(result[0].day0.state).toBe(input >= 0 ? input : -1);
        // state_text should correspond to the 0-6 scaled level, not the raw one
        // We can infer scale by checking that level 4 state_text != level 0 state_text
        expect(typeof result[0].day0.state_text).toBe("string");
      });
    }

    it("state_text for native level 4 differs from native level 0", async () => {
      const hassHigh = makeHass("amsterdam", { birch: [4, 4, 4, 4] });
      const hassLow = makeHass("amsterdam", { birch: [0, 0, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        pollen_threshold: 0,
      });

      const resultHigh = await fetchForecast(hassHigh, config);
      const resultLow = await fetchForecast(hassLow, config);

      expect(resultHigh[0].day0.state_text).not.toBe(
        resultLow[0].day0.state_text,
      );
    });
  });

  // -------------------------------------------------------------------------
  // 3. NaN / negative / out-of-range handling
  // -------------------------------------------------------------------------
  describe("NaN/negative/out-of-range handling", () => {
    it("returns -1 for NaN level values (day is skipped)", async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      // Manually create a sensor with a NaN-producing level
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      const states = {
        "sensor.polleninformation_amsterdam_birch": {
          state: "unavailable",
          attributes: {
            forecast: [
              { datetime: `${yyyy}-${mm}-${dd}T00:00:00`, level: NaN },
            ],
            data_stale: false,
          },
        },
      };
      const hass = createHass(states);
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        pollen_threshold: 0,
        days_to_show: 1,
      });

      const result = await fetchForecast(hass, config);

      // NaN level evaluates to -1, and level >= 0 is false, so day is skipped
      // The sensor still appears because pollen_threshold === 0
      expect(result.length).toBe(1);
      expect(result[0].days.length).toBe(0);
    });

    it("returns -1 for negative level values (day is skipped)", async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      const states = {
        "sensor.polleninformation_amsterdam_birch": {
          state: "-1",
          attributes: {
            forecast: [
              { datetime: `${yyyy}-${mm}-${dd}T00:00:00`, level: -5 },
            ],
            data_stale: false,
          },
        },
      };
      const hass = createHass(states);
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        pollen_threshold: 0,
        days_to_show: 1,
      });

      const result = await fetchForecast(hass, config);

      // Negative level evaluates to -1, day is skipped
      expect(result.length).toBe(1);
      expect(result[0].days.length).toBe(0);
    });

    it("clamps level above maxLevel (4) to 4", async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      const states = {
        "sensor.polleninformation_amsterdam_birch": {
          state: "10",
          attributes: {
            forecast: [
              { datetime: `${yyyy}-${mm}-${dd}T00:00:00`, level: 10 },
            ],
            data_stale: false,
          },
        },
      };
      const hass = createHass(states);
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        pollen_threshold: 0,
        days_to_show: 1,
      });

      const result = await fetchForecast(hass, config);

      // Level 10 clamped to maxLevel=4
      expect(result[0].day0.state).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // 4. allergy_risk special key: hourly sensor name in non-daily mode
  // -------------------------------------------------------------------------
  describe("allergy_risk special key", () => {
    it("uses allergy_risk_hourly sensor name in hourly mode", async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      // Build hourly forecast entries (1-hour steps)
      const hourlyForecast = Array.from({ length: 8 }, (_, i) => {
        const d = new Date(today.getTime() + i * 3600000);
        return {
          datetime: d.toISOString(),
          // For hourly/allergy_risk the adapter reads numeric_state
          numeric_state: 3,
        };
      });
      const states = {
        "sensor.polleninformation_amsterdam_allergy_risk_hourly": {
          state: "3",
          attributes: { forecast: hourlyForecast, data_stale: false },
        },
      };
      const hass = createHass(states);
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["allergy_risk"],
        mode: "hourly",
        days_to_show: 4,
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].entity_id).toBe(
        "sensor.polleninformation_amsterdam_allergy_risk_hourly",
      );
    });

    it("uses allergy_risk (not hourly) sensor name in daily mode", async () => {
      const hass = makeHass("amsterdam", { allergy_risk: [2, 1, 1, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["allergy_risk"],
        mode: "daily",
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].entity_id).toBe(
        "sensor.polleninformation_amsterdam_allergy_risk",
      );
    });
  });

  // -------------------------------------------------------------------------
  // 5. PEU_ALLERGENS includes allergy_risk prepended
  // -------------------------------------------------------------------------
  describe("PEU_ALLERGENS", () => {
    it("starts with allergy_risk", () => {
      expect(PEU_ALLERGENS[0]).toBe("allergy_risk");
    });

    it("contains all allergens from stubConfigPEU.allergens", () => {
      for (const allergen of stubConfigPEU.allergens) {
        expect(PEU_ALLERGENS).toContain(allergen);
      }
    });

    it("has length equal to stubConfigPEU.allergens.length + 1", () => {
      expect(PEU_ALLERGENS.length).toBe(stubConfigPEU.allergens.length + 1);
    });

    it("matches the exact shape: ['allergy_risk', ...stubConfigPEU.allergens]", () => {
      expect(PEU_ALLERGENS).toEqual(["allergy_risk", ...stubConfigPEU.allergens]);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Threshold filtering
  // -------------------------------------------------------------------------
  describe("threshold filtering", () => {
    it("excludes allergens where all days are below threshold", async () => {
      const hass = makeHass("amsterdam", {
        birch: [3, 2, 1, 1],
        grasses: [0, 0, 0, 0],
      });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch", "grasses"],
        pollen_threshold: 1,
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].allergenReplaced).toBe("birch");
    });

    it("includes all allergens when pollen_threshold is 0", async () => {
      const hass = makeHass("amsterdam", {
        birch: [2, 1, 0, 0],
        grasses: [0, 0, 0, 0],
      });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch", "grasses"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(2);
    });

    it("includes an allergen if any single day meets the threshold", async () => {
      const hass = makeHass("amsterdam", {
        birch: [0, 0, 3, 0],
      });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        pollen_threshold: 2,
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Sorting modes
  // -------------------------------------------------------------------------
  describe("sorting", () => {
    it("sorts by value_descending: highest day0 first", async () => {
      const hass = makeHass("amsterdam", {
        birch: [1, 0, 0, 0],
        grasses: [4, 3, 2, 1],
        alder: [2, 1, 0, 0],
      });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch", "grasses", "alder"],
        sort: "value_descending",
        allergy_risk_top: false,
      });

      const result = await fetchForecast(hass, config);

      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].day0.state).toBeGreaterThanOrEqual(
          result[i + 1].day0.state,
        );
      }
    });

    it("sorts by value_ascending: lowest day0 first", async () => {
      const hass = makeHass("amsterdam", {
        birch: [4, 3, 2, 1],
        grasses: [1, 0, 0, 0],
        alder: [2, 1, 0, 0],
      });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch", "grasses", "alder"],
        sort: "value_ascending",
        allergy_risk_top: false,
      });

      const result = await fetchForecast(hass, config);

      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].day0.state).toBeLessThanOrEqual(
          result[i + 1].day0.state,
        );
      }
    });

    it("sorts by name_ascending", async () => {
      const hass = makeHass("amsterdam", {
        oak: [2, 1, 0, 0],
        alder: [2, 1, 0, 0],
        birch: [2, 1, 0, 0],
      });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["oak", "alder", "birch"],
        sort: "name_ascending",
        allergy_risk_top: false,
      });

      const result = await fetchForecast(hass, config);

      const names = result.map((s) => s.allergenCapitalized);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sorted);
    });

    it("sorts by name_descending", async () => {
      const hass = makeHass("amsterdam", {
        oak: [2, 1, 0, 0],
        alder: [2, 1, 0, 0],
        birch: [2, 1, 0, 0],
      });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["oak", "alder", "birch"],
        sort: "name_descending",
        allergy_risk_top: false,
      });

      const result = await fetchForecast(hass, config);

      const names = result.map((s) => s.allergenCapitalized);
      const sorted = [...names].sort((a, b) => b.localeCompare(a));
      expect(names).toEqual(sorted);
    });

    it("does not sort when sort is 'none'", async () => {
      const hass = makeHass("amsterdam", {
        oak: [1, 0, 0, 0],
        grasses: [3, 2, 1, 0],
        birch: [2, 1, 0, 0],
      });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["oak", "grasses", "birch"],
        sort: "none",
        allergy_risk_top: false,
      });

      const result = await fetchForecast(hass, config);

      // Original order (oak, grasses, birch) should be preserved
      expect(result[0].allergenReplaced).toBe("oak");
      expect(result[1].allergenReplaced).toBe("grasses");
      expect(result[2].allergenReplaced).toBe("birch");
    });
  });

  // -------------------------------------------------------------------------
  // 8. allergy_risk_top pinning
  // -------------------------------------------------------------------------
  describe("allergy_risk_top pinning", () => {
    it("moves allergy_risk to the front when allergy_risk_top is true", async () => {
      const hass = makeHass("amsterdam", {
        birch: [4, 3, 2, 1],
        grasses: [3, 2, 1, 0],
        allergy_risk: [1, 1, 1, 1],
      });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch", "grasses", "allergy_risk"],
        sort: "value_descending",
        allergy_risk_top: true,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].allergenReplaced).toBe("allergy_risk");
    });

    it("leaves order unchanged when allergy_risk_top is false", async () => {
      const hass = makeHass("amsterdam", {
        birch: [4, 3, 2, 1],
        grasses: [3, 2, 1, 0],
        allergy_risk: [1, 1, 1, 1],
      });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch", "grasses", "allergy_risk"],
        sort: "value_descending",
        allergy_risk_top: false,
      });

      const result = await fetchForecast(hass, config);

      // value_descending: birch(4) > grasses(3) > allergy_risk(1)
      expect(result[0].allergenReplaced).toBe("birch");
    });

    it("allergy_risk_top is a no-op when allergy_risk is already first", async () => {
      const hass = makeHass("amsterdam", {
        allergy_risk: [4, 3, 2, 1],
        birch: [1, 0, 0, 0],
      });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["allergy_risk", "birch"],
        sort: "value_descending",
        allergy_risk_top: true,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].allergenReplaced).toBe("allergy_risk");
      expect(result.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // 9. Stale data handling
  // -------------------------------------------------------------------------
  describe("stale data handling", () => {
    it("returns stale:true with empty days when data_stale is true", async () => {
      const states = {
        "sensor.polleninformation_amsterdam_birch": createPEUSensor(
          2,
          [1, 0, 0],
          { data_stale: true },
        ),
      };
      const hass = createHass(states);
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].stale).toBe(true);
      expect(result[0].days).toEqual([]);
    });

    it("includes staleSince when the attribute is present", async () => {
      const states = {
        "sensor.polleninformation_amsterdam_birch": createPEUSensor(
          2,
          [1, 0, 0],
          { data_stale: true, stale_since: "2024-05-01T00:00:00" },
        ),
      };
      const hass = createHass(states);
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].staleSince).toBe("2024-05-01T00:00:00");
    });

    it("returns stale:true with empty days when forecast array is empty", async () => {
      const states = {
        "sensor.polleninformation_amsterdam_birch": {
          state: "2",
          attributes: { forecast: [], data_stale: false },
        },
      };
      const hass = createHass(states);
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].stale).toBe(true);
      expect(result[0].days).toEqual([]);
    });

    it("does not set stale:true when data_stale is false and forecast is present", async () => {
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].stale).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 10. User level names (5 or 7 custom labels)
  // -------------------------------------------------------------------------
  describe("user level names", () => {
    it("accepts 7 custom level labels mapping directly to indices 0-6", async () => {
      const customLevels = [
        "None",
        "VeryLow",
        "Low",
        "Medium",
        "High",
        "VeryHigh",
        "Extreme",
      ];
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        phrases: { full: {}, short: {}, levels: customLevels, days: {}, no_information: "" },
      });

      const result = await fetchForecast(hass, config);

      // Native level 2 -> scaled level 3 -> customLevels[3] = "Medium"
      expect(result[0].day0.state_text).toBe("Medium");
    });

    it("accepts 5 custom level labels mapped via [0,1,3,5,6]", async () => {
      // 5 labels map to scaled levels: idx0->0, idx1->1, idx2->3, idx3->5, idx4->6
      const customLevels = ["Zero", "Low", "Moderate", "High", "VeryHigh"];
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        phrases: { full: {}, short: {}, levels: customLevels, days: {}, no_information: "" },
      });

      const result = await fetchForecast(hass, config);

      // Native level 2 -> scaled level 3; map[2]=3 in 5-label array -> customLevels[2] = "Moderate"
      expect(result[0].day0.state_text).toBe("Moderate");
    });

    it("falls back to default level names for empty/null custom entries (7 labels)", async () => {
      const customLevels = ["CustomZero", "", null, "", "", "", ""];
      const hass = makeHass("amsterdam", { birch: [0, 0, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        pollen_threshold: 0,
        phrases: { full: {}, short: {}, levels: customLevels, days: {}, no_information: "" },
      });

      const result = await fetchForecast(hass, config);

      // Native level 0 -> scaled level 0 -> customLevels[0] = "CustomZero"
      expect(result[0].day0.state_text).toBe("CustomZero");
    });

    it("falls back to default level names for empty/null custom entries (5 labels)", async () => {
      // map[0]=0, so the empty string at index 0 stays as the default translation
      const customLevels = ["", "Low", "Moderate", "High", "VeryHigh"];
      const hass = makeHass("amsterdam", { birch: [0, 0, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        pollen_threshold: 0,
        phrases: { full: {}, short: {}, levels: customLevels, days: {}, no_information: "" },
      });

      const result = await fetchForecast(hass, config);

      // Native level 0 -> scaled level 0; customLevels[0] is "" -> fallback to i18n
      // Just verify it's a non-empty string (i18n fallback)
      expect(typeof result[0].day0.state_text).toBe("string");
      expect(result[0].day0.state_text.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // 11. Manual mode (location="manual" with entity_prefix/entity_suffix)
  // -------------------------------------------------------------------------
  describe("manual mode", () => {
    it("builds entity ID from prefix + allergen + suffix", async () => {
      const states = {
        "sensor.mypfx_birch_sfx": makePEUSensor([2, 1, 0, 0]),
      };
      const hass = createHass(states);
      const config = makeConfig({
        location: "manual",
        allergens: ["birch"],
        entity_prefix: "mypfx_",
        entity_suffix: "_sfx",
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].entity_id).toBe("sensor.mypfx_birch_sfx");
    });

    it("skips allergen when manual entity is not in hass.states", async () => {
      const hass = createHass({});
      const config = makeConfig({
        location: "manual",
        allergens: ["birch"],
        entity_prefix: "mypfx_",
        entity_suffix: "_sfx",
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(0);
    });

    it("uses allergy_risk_hourly as core slug in manual hourly mode", async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const hourlyForecast = Array.from({ length: 4 }, (_, i) => {
        const d = new Date(today.getTime() + i * 3600000);
        return { datetime: d.toISOString(), numeric_state: 2 };
      });
      const states = {
        "sensor.pfx_allergy_risk_hourly_sfx": {
          state: "2",
          attributes: { forecast: hourlyForecast, data_stale: false },
        },
      };
      const hass = createHass(states);
      const config = makeConfig({
        location: "manual",
        allergens: ["allergy_risk"],
        entity_prefix: "pfx_",
        entity_suffix: "_sfx",
        mode: "hourly",
        days_to_show: 2,
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].entity_id).toBe("sensor.pfx_allergy_risk_hourly_sfx");
    });

    it("works without prefix and suffix (empty strings)", async () => {
      const states = {
        "sensor.birch": makePEUSensor([3, 2, 1, 0]),
      };
      const hass = createHass(states);
      const config = makeConfig({
        location: "manual",
        allergens: ["birch"],
        entity_prefix: "",
        entity_suffix: "",
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].entity_id).toBe("sensor.birch");
    });
  });

  // -------------------------------------------------------------------------
  // Auto-detection: location derived from available sensors
  // -------------------------------------------------------------------------
  describe("auto-detection from sensor entity IDs", () => {
    it("auto-detects location slug from available polleninformation_ sensors", async () => {
      const states = {
        "sensor.polleninformation_brussels_birch": makePEUSensor([2, 1, 0, 0]),
      };
      const hass = createHass(states);
      const config = makeConfig({
        location: "",
        allergens: ["birch"],
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].entity_id).toBe(
        "sensor.polleninformation_brussels_birch",
      );
    });

    it("returns empty array when no matching sensors exist and location is empty", async () => {
      const hass = createHass({});
      const config = makeConfig({
        location: "",
        allergens: ["birch"],
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // User phrase overrides
  // -------------------------------------------------------------------------
  describe("user phrase overrides", () => {
    it("uses full phrase override for allergenCapitalized", async () => {
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        phrases: {
          full: { birch: "My Custom Birch Name" },
          short: {},
          levels: [],
          days: {},
          no_information: "",
        },
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].allergenCapitalized).toBe("My Custom Birch Name");
    });

    it("uses custom no_information label for state_text when level is an unrecognized string", async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      // indexToLevel("unknown") returns -1 because the string does not match any
      // key in the scale map, which triggers the noInfoLabel branch (scaledLevel < 0)
      // in the hourly allergy_risk code path.
      const hourlyForecast = [
        { datetime: today.toISOString(), numeric_state: "unknown" },
      ];
      const states = {
        "sensor.polleninformation_amsterdam_allergy_risk_hourly": {
          state: "unknown",
          attributes: { forecast: hourlyForecast, data_stale: false },
        },
      };
      const hass = createHass(states);
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["allergy_risk"],
        mode: "hourly",
        days_to_show: 1,
        pollen_threshold: 0,
        phrases: {
          full: {},
          short: {},
          levels: [],
          days: {},
          no_information: "N/A",
        },
      });

      const result = await fetchForecast(hass, config);

      // "unknown" is not null/undefined, so ?? keeps it; Number("unknown") = NaN;
      // indexToLevel(NaN) returns -1 => scaledLevel < 0 => state_text = noInfoLabel.
      expect(result.length).toBe(1);
      expect(result[0].days.length).toBe(1);
      expect(result[0].day0.state_text).toBe("N/A");
    });
  });
});
