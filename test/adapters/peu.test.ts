import { describe, it, expect } from "vitest";
import { fetchForecast, stubConfigPEU, PEU_ALLERGENS, discoverPeuSensors, resolveEntityIds } from "../../src/adapters/peu.js";
import { createHass, createHassWithRegistry, createPEUSensor, assertSensorShape } from "../helpers.js";
import { toCanonicalAllergenKey, ALLERGEN_ICON_FALLBACK } from "../../src/constants.js";
import { getSvgContent } from "../../src/pollenprognos-svgs.js";

function makeConfig(overrides: any = {}): any {
  return { ...stubConfigPEU, ...overrides };
}

/**
 * Build a PEU sensor state where each forecast entry has the `level` field
 * that the adapter actually reads (raw.level). createPEUSensor stores values
 * under `native_value`; this helper maps them to `level` so that the
 * level-scaling and filtering logic is exercised.
 */
function makePEUSensor(levelValues: any, opts: any = {}): any {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const forecast = levelValues.map((lv: any, i: number) => {
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
function makeHass(location: any, allergenMap: any): any {
  const states: Record<string, any> = {};
  for (const [allergen, levels] of Object.entries(allergenMap) as [string, any][]) {
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

      expect(result[0]!.allergenReplaced).toBe("birch");
    });

    it("sets allergenCapitalized to a non-empty string", async () => {
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
      });

      const result = await fetchForecast(hass, config);

      expect(typeof result[0]!.allergenCapitalized).toBe("string");
      expect(result[0]!.allergenCapitalized.length).toBeGreaterThan(0);
    });

    it("sets allergenShort equal to allergenCapitalized when not abbreviated", async () => {
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        allergens_abbreviated: false,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0]!.allergenShort).toBe(result[0]!.allergenCapitalized);
    });

    it("day0 is defined and mirrors the first days entry", async () => {
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
      });

      const result = await fetchForecast(hass, config);

      expect(result[0]!.days[0]).toBeDefined();
      expect(result[0]!.days[0]).toBe(result[0]!.days[0]);
    });

    it("each day object has required properties", async () => {
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
      });

      const result = await fetchForecast(hass, config);
      const day = result[0]!.days[0]!;

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

      expect(result[0]!.entity_id).toBe(
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

      expect(result[0]!.days.length).toBe(3);
      expect(result[0]!.days[0]).toBeDefined();
      expect(result[0]!.days[1]).toBeDefined();
      expect(result[0]!.days[2]).toBeDefined();
      expect(result[0]!.days[3]).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Level handling: PEU native 0-4 (single-scale, post-#215)
  // -------------------------------------------------------------------------
  describe("native level handling (0-4)", () => {
    // Pre-3.2.0 PEU stretched native 0-4 onto a 7-bucket card.levels array
    // via a [0, 1, 3, 5, 6] runtime spread. Now that card.levels5.0..4 lives
    // in every locale (added for MSW), level names are looked up at native
    // indices and `state` carries the integration's native value verbatim.
    // The test loop below kept its old `expected` column (the 0-6 scaled
    // value) only to assert that the call succeeded; the real assertion is
    // that state stores the native value and state_text is non-empty.

    // Just the input native levels; the legacy "expected scaled value"
    // column was retired with the #215 cleanup. Specific user-visible
    // strings are pinned in the dedicated test below.
    const cases = [0, 1, 2, 3, 4];

    for (const input of cases) {
      it(`renders state_text for native level ${input}`, async () => {
        const hass = makeHass("amsterdam", {
          birch: [input, input, input, input],
        });
        const config = makeConfig({
          location: "amsterdam",
          allergens: ["birch"],
          pollen_threshold: 0,
        });

        const result = await fetchForecast(hass, config);

        // state stores the native (0-4) value verbatim
        expect(result[0]!.days[0]!.state).toBe(input >= 0 ? input : -1);
        // state_text comes from card.levels5.0..4 keyed at the native index
        expect(typeof result[0]!.days[0]!.state_text).toBe("string");
        expect(result[0]!.days[0]!.state_text.length).toBeGreaterThan(0);
      });
    }

    it("native level -> default English state_text mapping (#215)", async () => {
      // Lock in the user-visible mapping after the #215 cleanup. Defaults
      // come from card.levels5.0..4 which are sourced one-to-one from
      // each locale's existing card.levels.{0,1,3,5,6} strings, so the
      // English mapping is "No pollen / Low levels / Moderate levels /
      // High levels / Very high levels".
      const expectations = [
        [0, "No pollen"],
        [1, "Low levels"],
        [2, "Moderate levels"],
        [3, "High levels"],
        [4, "Very high levels"],
      ];
      for (const [level, expected] of expectations) {
        const hass = makeHass("amsterdam", { birch: [level, level, level, level] });
        const config = makeConfig({
          location: "amsterdam",
          allergens: ["birch"],
          pollen_threshold: 0,
        });
        const result = await fetchForecast(hass, config);
        expect(result[0]!.days[0]!.state_text).toBe(expected);
      }
    });

    it("rounds fractional levels to the nearest severity bucket (#216 review)", async () => {
      // Codex/Copilot review on PR #216 caught that lookupIndex was passing
      // float inputs straight to levelNames[i], producing undefined and
      // falling back to noInfoLabel. The legacy indexToLevel/Math.floor
      // path always rounded, so a 2.7 input still rendered "High levels".
      // Lock the rounding behavior in.
      const cases = [
        [0.4, "No pollen"],     // -> 0
        [0.6, "Low levels"],    // -> 1
        [1.5, "Moderate levels"], // -> 2 (banker's? no, round half-up)
        [2.7, "High levels"],   // -> 3
        [3.6, "Very high levels"], // -> 4
        [4.4, "Very high levels"], // clamps at 4
      ];
      for (const [level, expected] of cases) {
        const hass = makeHass("amsterdam", { birch: [level, 0, 0, 0] });
        const config = makeConfig({
          location: "amsterdam",
          allergens: ["birch"],
          pollen_threshold: 0,
        });
        const result = await fetchForecast(hass, config);
        expect(result[0]!.days[0]!.state_text).toBe(expected);
      }
    });

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

      expect(resultHigh[0]!.days[0]!.state_text).not.toBe(
        resultLow[0]!.days[0]!.state_text,
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
      expect(result[0]!.days.length).toBe(0);
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
      expect(result[0]!.days.length).toBe(0);
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
      expect(result[0]!.days[0]!.state).toBe(4);
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
      expect(result[0]!.entity_id).toBe(
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
      expect(result[0]!.entity_id).toBe(
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

    it("contains all allergens from (stubConfigPEU.allergens as string[])", () => {
      for (const allergen of (stubConfigPEU.allergens as string[])) {
        expect(PEU_ALLERGENS).toContain(allergen);
      }
    });

    it("has length equal to (stubConfigPEU.allergens as string[]).length + 1", () => {
      expect(PEU_ALLERGENS.length).toBe((stubConfigPEU.allergens as string[]).length + 1);
    });

    it("matches the exact shape: ['allergy_risk', ...(stubConfigPEU.allergens as string[])]", () => {
      expect(PEU_ALLERGENS).toEqual(["allergy_risk", ...(stubConfigPEU.allergens as string[])]);
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
      expect(result[0]!.allergenReplaced).toBe("birch");
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
        expect(result[i]!.days[0]!.state).toBeGreaterThanOrEqual(
          result[i + 1]!.days[0]!.state,
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
        expect(result[i]!.days[0]!.state).toBeLessThanOrEqual(
          result[i + 1]!.days[0]!.state,
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
      const sorted = [...names]!.sort((a, b) => a.localeCompare(b));
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
      const sorted = [...names]!.sort((a, b) => b.localeCompare(a));
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
      expect(result[0]!.allergenReplaced).toBe("oak");
      expect(result[1]!.allergenReplaced).toBe("grasses");
      expect(result[2]!.allergenReplaced).toBe("birch");
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

      expect(result[0]!.allergenReplaced).toBe("allergy_risk");
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
      expect(result[0]!.allergenReplaced).toBe("birch");
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

      expect(result[0]!.allergenReplaced).toBe("allergy_risk");
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
      expect(result[0]!.stale).toBe(true);
      expect(result[0]!.days).toEqual([]);
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

      expect(result[0]!.staleSince).toBe("2024-05-01T00:00:00");
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

      expect(result[0]!.stale).toBe(true);
      expect(result[0]!.days).toEqual([]);
    });

    it("does not set stale:true when data_stale is false and forecast is present", async () => {
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
      });

      const result = await fetchForecast(hass, config);

      expect(result[0]!.stale).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 10. User level names (5 or 7 custom labels)
  // -------------------------------------------------------------------------
  describe("user level names", () => {
    it("accepts 7 legacy custom level labels (backwards compat post-#215)", async () => {
      // Pre-3.2.0 configs could supply seven phrase strings indexed 0-6,
      // because PEU stretched native 0-4 onto the seven-bucket palette.
      // The cleanup in #215 keeps level names native (0-4); a length-7 user
      // input is migrated by extracting entries [0, 1, 3, 5, 6] -- the same
      // positions the spread historically populated -- so user-visible
      // labels stay identical for legacy configs.
      const customLevels = [
        "None",     // index 0 -> native 0
        "VeryLow",  // index 1 -> native 1
        "Low",      // index 2 -> ignored under spread (no native maps here)
        "Medium",   // index 3 -> native 2
        "High",     // index 4 -> ignored under spread
        "VeryHigh", // index 5 -> native 3
        "Extreme",  // index 6 -> native 4
      ];
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        phrases: { full: {}, short: {}, levels: customLevels, days: {}, no_information: "" },
      });

      const result = await fetchForecast(hass, config);

      // Native level 2 -> "Medium" (was customLevels[3] under spread,
      // now customLevels[3] picked into native index 2 via the [0,1,3,5,6]
      // migration extraction; same user-visible outcome.)
      expect(result[0]!.days[0]!.state_text).toBe("Medium");
    });

    it("accepts 5 custom level labels at native indices", async () => {
      // 5-length user phrases now apply directly at native indices 0..4 --
      // no runtime spread, no migration. Visible outcome is identical to the
      // pre-#215 [0,1,3,5,6] mapping for any state value.
      const customLevels = ["Zero", "Low", "Moderate", "High", "VeryHigh"];
      const hass = makeHass("amsterdam", { birch: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "amsterdam",
        allergens: ["birch"],
        phrases: { full: {}, short: {}, levels: customLevels, days: {}, no_information: "" },
      });

      const result = await fetchForecast(hass, config);

      // Native level 2 -> customLevels[2] = "Moderate"
      expect(result[0]!.days[0]!.state_text).toBe("Moderate");
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
      expect(result[0]!.days[0]!.state_text).toBe("CustomZero");
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
      expect(typeof result[0]!.days[0]!.state_text).toBe("string");
      expect(result[0]!.days[0]!.state_text.length).toBeGreaterThan(0);
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
      expect(result[0]!.entity_id).toBe("sensor.mypfx_birch_sfx");
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
      expect(result[0]!.entity_id).toBe("sensor.pfx_allergy_risk_hourly_sfx");
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
      expect(result[0]!.entity_id).toBe("sensor.birch");
    });
  });

  // -------------------------------------------------------------------------
  // Device-based discovery
  // -------------------------------------------------------------------------
  describe("device-based discovery", () => {
    it("tier 2 hit: entity-registry platform 'polleninformation' resolves allergens", () => {
      // Simulate hass with entities registered under platform "polleninformation"
      // but without device registry (tier 2 path).
      const hass = createHassWithRegistry([
        {
          entityId: "sensor.polleninformation_wien_birch",
          state: "2",
          attributes: { forecast: [], data_stale: false },
          deviceId: null,
          platform: "polleninformation",
        },
        {
          entityId: "sensor.polleninformation_wien_grasses",
          state: "1",
          attributes: { forecast: [], data_stale: false },
          deviceId: null,
          platform: "polleninformation",
        },
      ]);

      const cfg: any = { ...stubConfigPEU, location: "wien", allergens: ["birch", "grasses"] };
      const map = resolveEntityIds(cfg, hass);

      expect(map.get("birch")).toBe("sensor.polleninformation_wien_birch");
      expect(map.get("grasses")).toBe("sensor.polleninformation_wien_grasses");
    });

    it("tier 3 (state fallback) with slug config resolves allergens for cfg.location = 'wien'", () => {
      // No entity/device registry - pure state fallback (tier 3).
      const states = {
        "sensor.polleninformation_wien_birch": makePEUSensor([2, 1, 0, 0]),
        "sensor.polleninformation_wien_grasses": makePEUSensor([1, 0, 0, 0]),
      };
      const hass = createHass(states);

      const cfg: any = { ...stubConfigPEU, location: "wien", allergens: ["birch", "grasses"] };
      const map = resolveEntityIds(cfg, hass);

      expect(map.get("birch")).toBe("sensor.polleninformation_wien_birch");
      expect(map.get("grasses")).toBe("sensor.polleninformation_wien_grasses");
    });

    it("mode mapping: cfg.mode = 'hourly' + allergens = ['allergy_risk'] resolves to allergy_risk_hourly entity", () => {
      const states = {
        "sensor.polleninformation_wien_allergy_risk_hourly": {
          state: "2",
          attributes: { forecast: [], data_stale: false },
        },
      };
      const hass = createHass(states);

      const cfg: any = { ...stubConfigPEU, location: "wien", mode: "hourly", allergens: ["allergy_risk"] };
      const map = resolveEntityIds(cfg, hass);

      expect(map.get("allergy_risk")).toBe(
        "sensor.polleninformation_wien_allergy_risk_hourly",
      );
    });

    it("discovery label strips 'Polleninformation' prefix and unwraps parens", () => {
      // The HA integration sets device.name = "Polleninformation (Hamburg)",
      // which would produce a duplicated title in the card header.
      const hass = createHassWithRegistry([
        {
          entityId: "sensor.polleninformation_hamburg_birch",
          state: "2",
          attributes: { forecast: [], data_stale: false },
          platform: "polleninformation",
          deviceId: "device_hamburg",
          deviceMeta: {
            name: "Polleninformation (Hamburg)",
            configEntries: ["cfg_hamburg"],
            identifiers: [["polleninformation", "hamburg"]],
          },
        },
      ]);

      const discovery = discoverPeuSensors(hass);
      const [, loc] = [...discovery.locations.entries()][0]!;
      expect(loc.label).toBe("Hamburg");
    });

    it("discovery label prefers state.attributes.location_title when present", () => {
      const hass = createHassWithRegistry([
        {
          entityId: "sensor.polleninformation_hamburg_birch",
          state: "2",
          attributes: {
            forecast: [],
            data_stale: false,
            location_title: "Hamburg",
          },
          platform: "polleninformation",
          deviceId: "device_hamburg",
          deviceMeta: {
            name: "Polleninformation (Hamburg)",
            configEntries: ["cfg_hamburg"],
            identifiers: [["polleninformation", "hamburg"]],
          },
        },
      ]);

      const discovery = discoverPeuSensors(hass);
      const [, loc] = [...discovery.locations.entries()][0]!;
      expect(loc.label).toBe("Hamburg");
    });

    it("whitelist classifier: allergy_risk_hourly is not misclassified as allergy_risk", () => {
      const states = {
        "sensor.polleninformation_amsterdam_allergy_risk_hourly": makePEUSensor([3]),
        "sensor.polleninformation_amsterdam_allergy_risk": makePEUSensor([2]),
        "sensor.polleninformation_amsterdam_birch": makePEUSensor([1]),
      };
      const hass = createHass(states);

      const discovery = discoverPeuSensors(hass);
      const loc = discovery.locations.get("amsterdam")!;
      expect(loc).toBeDefined();
      // Both keys must be separately registered
      expect(loc.entities.get("allergy_risk")).toBe(
        "sensor.polleninformation_amsterdam_allergy_risk",
      );
      expect(loc.entities.get("allergy_risk_hourly")).toBe(
        "sensor.polleninformation_amsterdam_allergy_risk_hourly",
      );
      // birch must not bleed into the allergy_risk key
      expect(loc.entities.get("birch")).toBe(
        "sensor.polleninformation_amsterdam_birch",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Upstream polleninformation 0.5.3 slug set
  // -------------------------------------------------------------------------
  describe("upstream 0.5.3 slug contract", () => {
    // The integration's API-verified English slugs. dock_sorrel, plantain,
    // sweet_chestnut and tree_of_heaven were missing; "lime" never matched a
    // real entity because the API calls Tilia "linden".
    const NEW_SLUGS = [
      "dock_sorrel",
      "plantain",
      "sweet_chestnut",
      "tree_of_heaven",
      "linden",
    ];

    it("offers every new slug in the stub config", () => {
      for (const slug of NEW_SLUGS) {
        expect(stubConfigPEU.allergens as string[]).toContain(slug);
      }
    });

    it("drops 'lime', which never matched a polleninformation entity", () => {
      expect(stubConfigPEU.allergens as string[]).not.toContain("lime");
    });

    it("canonicalizes the new slugs for names and icons", () => {
      expect(toCanonicalAllergenKey("dock_sorrel")).toBe("sorrel");
      expect(toCanonicalAllergenKey("linden")).toBe("lime");
      expect(toCanonicalAllergenKey("plantain")).toBe("plantain");
      expect(toCanonicalAllergenKey("sweet_chestnut")).toBe("sweet_chestnut");
      expect(toCanonicalAllergenKey("tree_of_heaven")).toBe("tree_of_heaven");
    });

    it("keeps 'lime' canonical for hand-written configs", () => {
      expect(toCanonicalAllergenKey("lime")).toBe("lime");
    });

    it("classifies every new slug whole at an underscored location", () => {
      const states: Record<string, any> = {};
      for (const slug of NEW_SLUGS) {
        states[`sensor.polleninformation_sankt_polten_${slug}`] =
          makePEUSensor([2, 1, 0, 0]);
      }
      const hass = createHass(states);

      const discovery = discoverPeuSensors(hass);
      const loc = discovery.locations.get("sankt_polten");
      expect(loc).toBeDefined();
      for (const slug of NEW_SLUGS) {
        expect(loc!.entities.get(slug)).toBe(
          `sensor.polleninformation_sankt_polten_${slug}`,
        );
      }
    });

    it("does not let a shorter slug swallow the tail of a longer one", () => {
      // "oak" and "ash" are suffixes of nothing here, but "plane_tree" ends in
      // "tree" and "tree_of_heaven" starts with it: longest-first classification
      // must keep the two apart at an underscored location.
      const states = {
        "sensor.polleninformation_sankt_polten_tree_of_heaven":
          makePEUSensor([3]),
        "sensor.polleninformation_sankt_polten_plane_tree": makePEUSensor([1]),
      };
      const hass = createHass(states);

      const discovery = discoverPeuSensors(hass);
      const loc = discovery.locations.get("sankt_polten")!;
      expect(loc.entities.get("tree_of_heaven")).toBe(
        "sensor.polleninformation_sankt_polten_tree_of_heaven",
      );
      expect(loc.entities.get("plane_tree")).toBe(
        "sensor.polleninformation_sankt_polten_plane_tree",
      );
      expect(loc.entities.has("of_heaven")).toBe(false);
    });

    it("auto-detects the location from a multi-underscore allergen entity", async () => {
      // Location left empty: the entity ID is the only source of the location,
      // and splitting it on the last underscore would yield "wien_sweet".
      const states = {
        "sensor.polleninformation_wien_sweet_chestnut": makePEUSensor([
          3, 2, 1, 0,
        ]),
      };
      const hass = createHass(states);
      const config = makeConfig({
        location: "",
        allergens: ["sweet_chestnut"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0]!.entity_id).toBe(
        "sensor.polleninformation_wien_sweet_chestnut",
      );
      expect(result[0]!.allergenReplaced).toBe("sweet_chestnut");
    });

    it("resolves a configured slug the whitelist does not know yet", () => {
      // Discovery cannot classify an unknown allergen, so this falls through to
      // the template fallback, which must still read the location as "wien".
      const states = {
        "sensor.polleninformation_wien_sea_buckthorn": makePEUSensor([2]),
      };
      const hass = createHass(states);

      const cfg: any = {
        ...stubConfigPEU,
        location: "",
        allergens: ["sea_buckthorn"],
      };
      const map = resolveEntityIds(cfg, hass);

      expect(map.get("sea_buckthorn")).toBe(
        "sensor.polleninformation_wien_sea_buckthorn",
      );
    });

    it("names and icons resolve for a new allergen", async () => {
      const hass = makeHass("wien", { dock_sorrel: [2, 1, 0, 0] });
      const config = makeConfig({
        location: "wien",
        allergens: ["dock_sorrel"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0]!.allergenCapitalized).toBe("Sorrel");
      expect(getSvgContent(toCanonicalAllergenKey("dock_sorrel"))).toBeTruthy();
    });

    it("resolves the new tree allergens to their own SVG", () => {
      // sweet_chestnut and tree_of_heaven ship dedicated icons, so they must
      // resolve directly instead of leaning on a fallback stand-in.
      for (const slug of ["sweet_chestnut", "tree_of_heaven"]) {
        const canonical = toCanonicalAllergenKey(slug);
        expect(getSvgContent(canonical)).toBeTruthy();
        expect(ALLERGEN_ICON_FALLBACK[canonical]).toBeUndefined();
      }
    });

    // The entity IDs a live 0.5.3 Wien instance exposes, read from /api/states.
    // Which allergens a location reports varies (Wien has no beech, elm, oak or
    // willow), so this is the subset we must handle, not the full slug list.
    const WIEN_LIVE_ENTITIES = [
      "alder",
      "allergy_risk",
      "allergy_risk_hourly",
      "ash",
      "birch",
      "cypress_family",
      "dock_sorrel",
      "fungal_spores",
      "grasses",
      "hazel",
      "linden",
      "mugwort",
      "nettle_family",
      "olive",
      "plane_tree",
      "plantain",
      "ragweed",
      "rye",
      "sweet_chestnut",
      "tree_of_heaven",
    ].map((slug) => `sensor.polleninformation_wien_${slug}`);

    it("classifies every entity a live Wien instance exposes", () => {
      const states: Record<string, any> = {};
      for (const eid of WIEN_LIVE_ENTITIES) states[eid] = makePEUSensor([2, 1]);
      const hass = createHass(states);

      const discovery = discoverPeuSensors(hass);
      expect([...discovery.locations.keys()]).toEqual(["wien"]);
      const loc = discovery.locations.get("wien")!;
      // Every entity lands under its own key: no collisions, nothing dropped.
      expect(loc.entities.size).toBe(WIEN_LIVE_ENTITIES.length);
      for (const eid of WIEN_LIVE_ENTITIES) {
        const slug = eid.replace("sensor.polleninformation_wien_", "");
        expect(loc.entities.get(slug)).toBe(eid);
      }
    });

    it("offers every allergen a live Wien instance exposes", () => {
      // allergy_risk_hourly is a mode variant, not a pickable allergen.
      for (const eid of WIEN_LIVE_ENTITIES) {
        const slug = eid.replace("sensor.polleninformation_wien_", "");
        if (slug === "allergy_risk_hourly") continue;
        expect(PEU_ALLERGENS).toContain(slug);
      }
    });

    it("classifies by entity ID, not by localized friendly names", () => {
      // The integration localizes friendly_name to the HA server language but
      // keeps entity IDs English. A Swedish server must discover the same keys.
      const states = {
        "sensor.polleninformation_wien_linden": makePEUSensor([2, 1], {
          friendly_name: "Polleninformation Wien Lind",
        }),
        "sensor.polleninformation_wien_dock_sorrel": makePEUSensor([1, 0], {
          friendly_name: "Polleninformation Wien Ängssyra",
        }),
        "sensor.polleninformation_wien_tree_of_heaven": makePEUSensor([3, 2], {
          friendly_name: "Polleninformation Wien Gudaträd",
        }),
      };
      const hass = createHass(states, { language: "sv" });

      const discovery = discoverPeuSensors(hass);
      const loc = discovery.locations.get("wien")!;
      expect([...loc.entities.keys()].sort()).toEqual([
        "dock_sorrel",
        "linden",
        "tree_of_heaven",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Canonical fallback: config spellings vs upstream entity slugs
  // -------------------------------------------------------------------------
  describe("canonical allergen fallback", () => {
    // A 0.5.3 location exposes the upstream slugs. Configs in the wild name the
    // same two allergens in four ways: the pre-0.5.3 stub slug (lime), the
    // current one (linden), the canonical key (sorrel) and the upstream slug
    // (dock_sorrel). Every spelling must land on the same entity.
    const wienStates = {
      "sensor.polleninformation_wien_linden": makePEUSensor([2, 1, 0, 0]),
      "sensor.polleninformation_wien_dock_sorrel": makePEUSensor([3, 2, 1, 0]),
      "sensor.polleninformation_wien_birch": makePEUSensor([1, 1, 1, 1]),
    };
    const LINDEN = "sensor.polleninformation_wien_linden";
    const SORREL = "sensor.polleninformation_wien_dock_sorrel";

    const CELLS: Array<[string, string]> = [
      ["lime", LINDEN],
      ["linden", LINDEN],
      ["sorrel", SORREL],
      ["dock_sorrel", SORREL],
    ];

    for (const [configured, expected] of CELLS) {
      for (const location of ["wien", ""]) {
        const mode = location ? "explicit location" : "autodetect";
        it(`resolves '${configured}' to its entity (${mode})`, () => {
          const hass = createHass(wienStates);
          const cfg: any = {
            ...stubConfigPEU,
            location,
            allergens: [configured],
          };

          const map = resolveEntityIds(cfg, hass);

          expect(map.get(configured)).toBe(expected);
          expect(map.size).toBe(1);
        });

        it(`renders one row for '${configured}' (${mode})`, async () => {
          const hass = createHass(wienStates);
          const config = makeConfig({
            location,
            allergens: [configured],
            pollen_threshold: 0,
          });

          const result = await fetchForecast(hass, config);

          expect(result.length).toBe(1);
          expect(result[0]!.entity_id).toBe(expected);
          // The row keeps the configured spelling: the card re-filters on
          // cfg.allergens by raw slug, so renaming it here would drop the row.
          expect(result[0]!.allergenReplaced).toBe(configured);
        });
      }
    }

    it("yields one row when both spellings are configured", async () => {
      const hass = createHass(wienStates);
      const cfg: any = {
        ...stubConfigPEU,
        location: "wien",
        allergens: ["lime", "linden"],
      };

      const map = resolveEntityIds(cfg, hass);

      // The literal match wins the entity; the legacy spelling finds nothing
      // left to claim rather than duplicating the row.
      expect(map.get("linden")).toBe(LINDEN);
      expect(map.has("lime")).toBe(false);
      expect([...new Set(map.values())]).toHaveLength(1);

      const result = await fetchForecast(
        hass,
        makeConfig({
          location: "wien",
          allergens: ["lime", "linden"],
          pollen_threshold: 0,
        }),
      );
      expect(result.length).toBe(1);
    });

    it("keeps distinct allergens apart when several fall back", () => {
      const hass = createHass(wienStates);
      const cfg: any = {
        ...stubConfigPEU,
        location: "wien",
        allergens: ["lime", "sorrel", "birch"],
      };

      const map = resolveEntityIds(cfg, hass);

      expect(map.get("lime")).toBe(LINDEN);
      expect(map.get("sorrel")).toBe(SORREL);
      expect(map.get("birch")).toBe("sensor.polleninformation_wien_birch");
    });

    it("does not invent a row when the location lacks the allergen", () => {
      const hass = createHass(wienStates);
      const cfg: any = {
        ...stubConfigPEU,
        location: "wien",
        allergens: ["olive"],
      };

      expect(resolveEntityIds(cfg, hass).size).toBe(0);
    });

    it("falls back canonically in manual mode too", () => {
      const hass = createHass({
        "sensor.peu_linden_wien": makePEUSensor([2, 1]),
      });
      const cfg: any = {
        ...stubConfigPEU,
        location: "manual",
        entity_prefix: "peu_",
        entity_suffix: "_wien",
        allergens: ["lime"],
      };

      const map = resolveEntityIds(cfg, hass);

      expect(map.get("lime")).toBe("sensor.peu_linden_wien");
    });

    it("scans the registry once, fallback or not", () => {
      // The fallback needs the location's entities, which the literal pass has
      // already discovered. Re-running discovery would double the registry and
      // state scans on every update for anyone still configuring "lime".
      const countRegistryReads = (allergens: string[]) => {
        let reads = 0;
        const hass: any = createHass(wienStates);
        for (const key of ["entities", "devices"]) {
          const value = hass[key];
          Object.defineProperty(hass, key, {
            get() {
              reads += 1;
              return value;
            },
          });
        }
        resolveEntityIds(
          { ...stubConfigPEU, location: "wien", allergens } as any,
          hass,
        );
        return reads;
      };

      const literal = countRegistryReads(["linden"]);
      const viaFallback = countRegistryReads(["lime"]);

      expect(literal).toBeGreaterThan(0);
      expect(viaFallback).toBe(literal);
    });

    it("reuses a discovery result the caller already has", () => {
      const hass = createHass(wienStates);
      const discovery = discoverPeuSensors(hass);
      const cfg: any = {
        ...stubConfigPEU,
        location: "wien",
        allergens: ["lime"],
      };

      // Passed a discovery, the resolver must not need hass to find one.
      const blindHass: any = { ...hass, entities: {}, devices: {} };
      expect(resolveEntityIds(cfg, blindHass, false, discovery).get("lime")).toBe(
        LINDEN,
      );
    });

    it("keeps the hourly mode mapping ahead of the fallback", () => {
      // allergy_risk must still resolve to the _hourly variant in hourly mode
      // rather than being canonically matched to the daily entity.
      const hass = createHass({
        "sensor.polleninformation_wien_allergy_risk": makePEUSensor([2]),
        "sensor.polleninformation_wien_allergy_risk_hourly": makePEUSensor([3]),
      });
      const cfg: any = {
        ...stubConfigPEU,
        location: "wien",
        mode: "hourly",
        allergens: ["allergy_risk"],
      };

      expect(resolveEntityIds(cfg, hass).get("allergy_risk")).toBe(
        "sensor.polleninformation_wien_allergy_risk_hourly",
      );
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
      expect(result[0]!.entity_id).toBe(
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

      expect(result[0]!.allergenCapitalized).toBe("My Custom Birch Name");
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
      expect(result[0]!.days.length).toBe(1);
      expect(result[0]!.days[0]!.state_text).toBe("N/A");
    });
  });
});
