import { describe, it, expect } from "vitest";
import {
  fetchForecast,
  stubConfigATMO,
  ATMO_ALLERGENS,
  ATMO_ALLERGEN_MAP,
  ATMO_POLLUTION_ALLERGENS,
} from "../../src/adapters/atmo.js";
import { createHass, assertSensorShape } from "../helpers.js";

function makeConfig(overrides = {}) {
  return { ...stubConfigATMO, ...overrides };
}

function makeHass(location, allergenStates) {
  const states = {};
  for (const [allergen, todayVal, tomorrowVal] of allergenStates) {
    const frSlug = ATMO_ALLERGEN_MAP[allergen];
    let todayId, j1Id;
    if (allergen === "allergy_risk") {
      todayId = `sensor.qualite_globale_pollen_${location}`;
    } else if (allergen === "qualite_globale") {
      todayId = `sensor.qualite_globale_${location}`;
    } else if (ATMO_POLLUTION_ALLERGENS.has(allergen)) {
      todayId = `sensor.${frSlug}_${location}`;
    } else {
      todayId = `sensor.niveau_${frSlug}_${location}`;
    }
    j1Id = `${todayId}_j_1`;
    states[todayId] = { state: String(todayVal), attributes: { "Libellé": "" } };
    if (tomorrowVal !== undefined) {
      states[j1Id] = { state: String(tomorrowVal), attributes: { "Libellé": "" } };
    }
  }
  return createHass(states, { language: "fr" });
}

describe("ATMO adapter: fetchForecast", () => {
  // 1. Basic shape
  describe("basic shape", () => {
    it("returns an array of sensor dicts with correct shape", async () => {
      const hass = makeHass("paris", [
        ["birch", 3, 2],
        ["grass", 2, 1],
      ]);
      const config = makeConfig({
        location: "paris",
        allergens: ["birch", "grass"],
      });

      const result = await fetchForecast(hass, config);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      for (const sensor of result) {
        assertSensorShape(sensor, { minDays: 2 });
      }
    });

    it("sets allergenReplaced to the canonical allergen key", async () => {
      const hass = makeHass("paris", [["birch", 3, 2]]);
      const config = makeConfig({ location: "paris", allergens: ["birch"] });

      const result = await fetchForecast(hass, config);

      expect(result[0].allergenReplaced).toBe("birch");
    });

    it("sets entity_id on each sensor dict", async () => {
      const hass = makeHass("paris", [["birch", 3, 2]]);
      const config = makeConfig({ location: "paris", allergens: ["birch"] });

      const result = await fetchForecast(hass, config);

      expect(result[0].entity_id).toBe("sensor.niveau_bouleau_paris");
    });

    it("each day object has required properties", async () => {
      const hass = makeHass("paris", [["birch", 3, 2]]);
      const config = makeConfig({ location: "paris", allergens: ["birch"] });

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
      expect(typeof day.display_state).toBe("number");
      expect(typeof day.state_text).toBe("string");
    });

    it("days_to_show default is 2 (today + j+1)", async () => {
      const hass = makeHass("paris", [["birch", 3, 2]]);
      const config = makeConfig({ location: "paris", allergens: ["birch"] });

      expect(stubConfigATMO.days_to_show).toBe(2);

      const result = await fetchForecast(hass, config);

      expect(result[0].days.length).toBe(2);
      expect(result[0].day0).toBeDefined();
      expect(result[0].day1).toBeDefined();
      expect(result[0].day2).toBeUndefined();
    });

    it("fills j+1 with state -1 when tomorrow entity is absent", async () => {
      // Provide only today, no tomorrow
      const hass = makeHass("paris", [["birch", 3]]);
      const config = makeConfig({ location: "paris", allergens: ["birch"] });

      const result = await fetchForecast(hass, config);

      expect(result[0].day1.state).toBe(-1);
      expect(result[0].day1.display_state).toBe(-1);
    });
  });

  // 2. ATMO level mapping
  describe("ATMO level mapping", () => {
    it("maps level 0 (indisponible) to state=0 and display_state=-1", async () => {
      const hass = makeHass("paris", [["birch", 0, 0]]);
      const config = makeConfig({
        location: "paris",
        allergens: ["birch"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].day0.state).toBe(0);
      expect(result[0].day0.display_state).toBe(-1);
    });

    it("maps levels 1-6 to state=raw and display_state=raw", async () => {
      for (const level of [1, 2, 3, 4, 5, 6]) {
        const hass = makeHass("paris", [["birch", level, level]]);
        const config = makeConfig({
          location: "paris",
          allergens: ["birch"],
          pollen_threshold: 0,
        });

        const result = await fetchForecast(hass, config);

        expect(result[0].day0.state).toBe(level);
        expect(result[0].day0.display_state).toBe(level);
      }
    });

    it("maps level 7 (evenement) to state=7 and display_state=6 (capped)", async () => {
      const hass = makeHass("paris", [["birch", 7, 7]]);
      const config = makeConfig({
        location: "paris",
        allergens: ["birch"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].day0.state).toBe(7);
      expect(result[0].day0.display_state).toBe(6);
    });

    it("maps NaN/unavailable to state=-1 and display_state=-1", async () => {
      const states = {
        "sensor.niveau_bouleau_paris": {
          state: "unavailable",
          attributes: { "Libellé": "" },
        },
        "sensor.niveau_bouleau_paris_j_1": {
          state: "unknown",
          attributes: { "Libellé": "" },
        },
      };
      const hass = createHass(states, { language: "fr" });
      const config = makeConfig({
        location: "paris",
        allergens: ["birch"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].day0.state).toBe(-1);
      expect(result[0].day0.display_state).toBe(-1);
    });

    it("returns state_text for level 0 (uses Libelle or unavailable label)", async () => {
      const states = {
        "sensor.niveau_bouleau_paris": {
          state: "0",
          attributes: { "Libellé": "Indisponible" },
        },
      };
      const hass = createHass(states, { language: "fr" });
      const config = makeConfig({
        location: "paris",
        allergens: ["birch"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].day0.state_text).toBe("Indisponible");
    });

    it("returns state_text for level 7 (uses Libelle or event label)", async () => {
      const states = {
        "sensor.niveau_bouleau_paris": {
          state: "7",
          attributes: { "Libellé": "Evenement" },
        },
      };
      const hass = createHass(states, { language: "fr" });
      const config = makeConfig({
        location: "paris",
        allergens: ["birch"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].day0.state_text).toBe("Evenement");
    });
  });

  // 3. Dual pollen/pollution support
  describe("group property", () => {
    it("sets group='pollen' for pollen allergens", async () => {
      const pollenAllergens = ["birch", "ragweed", "mugwort", "alder", "grass", "olive"];
      for (const allergen of pollenAllergens) {
        const hass = makeHass("paris", [[allergen, 3, 2]]);
        const config = makeConfig({
          location: "paris",
          allergens: [allergen],
        });

        const result = await fetchForecast(hass, config);

        expect(result[0].group).toBe("pollen");
      }
    });

    it("sets group='pollen' for allergy_risk", async () => {
      const hass = makeHass("paris", [["allergy_risk", 3, 2]]);
      const config = makeConfig({
        location: "paris",
        allergens: ["allergy_risk"],
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].group).toBe("pollen");
    });

    it("sets group='pollution' for pollution allergens", async () => {
      const pollutionAllergens = ["pm25", "pm10", "ozone", "no2", "so2"];
      for (const allergen of pollutionAllergens) {
        const hass = makeHass("paris", [[allergen, 3, 2]]);
        const config = makeConfig({
          location: "paris",
          allergens: [allergen],
        });

        const result = await fetchForecast(hass, config);

        expect(result[0].group).toBe("pollution");
      }
    });

    it("sets group='pollution' for qualite_globale", async () => {
      const hass = makeHass("paris", [["qualite_globale", 3, 2]]);
      const config = makeConfig({
        location: "paris",
        allergens: ["qualite_globale"],
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].group).toBe("pollution");
    });
  });

  // 4. Block sorting
  describe("sort_pollution_block and pollution_block_position", () => {
    it("separates pollen and pollution into blocks when sort_pollution_block=true", async () => {
      const hass = makeHass("paris", [
        ["pm25", 5, 4],
        ["birch", 3, 2],
        ["pm10", 4, 3],
        ["grass", 2, 1],
      ]);
      const config = makeConfig({
        location: "paris",
        allergens: ["pm25", "birch", "pm10", "grass"],
        sort_pollution_block: true,
        pollution_block_position: "bottom",
        allergy_risk_top: false,
      });

      const result = await fetchForecast(hass, config);

      // All pollen should come before all pollution
      const groups = result.map((s) => s.group);
      const lastPollen = groups.lastIndexOf("pollen");
      const firstPollution = groups.indexOf("pollution");
      expect(lastPollen).toBeLessThan(firstPollution);
    });

    it("pollution_block_position='top' puts pollution before pollen", async () => {
      const hass = makeHass("paris", [
        ["pm25", 3, 2],
        ["birch", 4, 3],
      ]);
      const config = makeConfig({
        location: "paris",
        allergens: ["pm25", "birch"],
        sort_pollution_block: true,
        pollution_block_position: "top",
        allergy_risk_top: false,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].group).toBe("pollution");
      expect(result[1].group).toBe("pollen");
    });

    it("sorts within pollen block by value_descending", async () => {
      const hass = makeHass("paris", [
        ["birch", 2, 1],
        ["grass", 5, 4],
        ["alder", 3, 2],
      ]);
      const config = makeConfig({
        location: "paris",
        allergens: ["birch", "grass", "alder"],
        sort_pollution_block: true,
        sort: "value_descending",
        allergy_risk_top: false,
      });

      const result = await fetchForecast(hass, config);

      const pollenResults = result.filter((s) => s.group === "pollen");
      for (let i = 0; i < pollenResults.length - 1; i++) {
        expect(pollenResults[i].day0.display_state).toBeGreaterThanOrEqual(
          pollenResults[i + 1].day0.display_state,
        );
      }
    });

    it("sorts within pollution block by value_descending", async () => {
      const hass = makeHass("paris", [
        ["pm25", 2, 1],
        ["pm10", 5, 4],
        ["ozone", 3, 2],
      ]);
      const config = makeConfig({
        location: "paris",
        allergens: ["pm25", "pm10", "ozone"],
        sort_pollution_block: true,
        sort: "value_descending",
        allergy_risk_top: false,
      });

      const result = await fetchForecast(hass, config);

      const pollutionResults = result.filter((s) => s.group === "pollution");
      for (let i = 0; i < pollutionResults.length - 1; i++) {
        expect(pollutionResults[i].day0.display_state).toBeGreaterThanOrEqual(
          pollutionResults[i + 1].day0.display_state,
        );
      }
    });
  });

  // 5. allergy_risk_top pinning
  describe("allergy_risk_top pinning", () => {
    it("pins allergy_risk to top of pollen block when allergy_risk_top=true", async () => {
      const hass = makeHass("paris", [
        ["birch", 5, 4],   // higher value than allergy_risk
        ["grass", 4, 3],
        ["allergy_risk", 2, 1],
      ]);
      const config = makeConfig({
        location: "paris",
        allergens: ["birch", "grass", "allergy_risk"],
        sort_pollution_block: true,
        sort: "value_descending",
        allergy_risk_top: true,
      });

      const result = await fetchForecast(hass, config);

      const pollenResults = result.filter((s) => s.group === "pollen");
      expect(pollenResults[0].allergenReplaced).toBe("allergy_risk");
    });

    it("pins qualite_globale to top of pollution block when allergy_risk_top=true", async () => {
      const hass = makeHass("paris", [
        ["pm25", 5, 4],   // higher value than qualite_globale
        ["pm10", 4, 3],
        ["qualite_globale", 2, 1],
      ]);
      const config = makeConfig({
        location: "paris",
        allergens: ["pm25", "pm10", "qualite_globale"],
        sort_pollution_block: true,
        sort: "value_descending",
        allergy_risk_top: true,
      });

      const result = await fetchForecast(hass, config);

      const pollutionResults = result.filter((s) => s.group === "pollution");
      expect(pollutionResults[0].allergenReplaced).toBe("qualite_globale");
    });

    it("does not pin when allergy_risk_top=false", async () => {
      const hass = makeHass("paris", [
        ["birch", 5, 4],
        ["allergy_risk", 1, 1],
        ["grass", 4, 3],
      ]);
      const config = makeConfig({
        location: "paris",
        allergens: ["birch", "allergy_risk", "grass"],
        sort_pollution_block: true,
        sort: "value_descending",
        allergy_risk_top: false,
      });

      const result = await fetchForecast(hass, config);

      const pollenResults = result.filter((s) => s.group === "pollen");
      // allergy_risk has the lowest value so it should be last
      expect(pollenResults[pollenResults.length - 1].allergenReplaced).toBe("allergy_risk");
    });

    it("pins both summaries to absolute top when sort_pollution_block=false", async () => {
      const hass = makeHass("paris", [
        ["birch", 5, 4],
        ["pm25", 5, 4],
        ["allergy_risk", 2, 1],
        ["qualite_globale", 2, 1],
      ]);
      const config = makeConfig({
        location: "paris",
        allergens: ["birch", "pm25", "allergy_risk", "qualite_globale"],
        sort_pollution_block: false,
        sort: "value_descending",
        allergy_risk_top: true,
      });

      const result = await fetchForecast(hass, config);

      // allergy_risk and qualite_globale should be at positions 0 and 1
      const topTwo = result.slice(0, 2).map((s) => s.allergenReplaced);
      expect(topTwo).toContain("allergy_risk");
      expect(topTwo).toContain("qualite_globale");
    });
  });

  // 6. Entity pattern differences
  describe("entity patterns", () => {
    it("pollen allergens use niveau_ prefix", async () => {
      const hass = makeHass("paris", [["birch", 3, 2]]);
      const config = makeConfig({ location: "paris", allergens: ["birch"] });

      const result = await fetchForecast(hass, config);

      expect(result[0].entity_id).toBe("sensor.niveau_bouleau_paris");
    });

    it("pollution allergens do not use niveau_ prefix", async () => {
      const hass = makeHass("paris", [["pm25", 3, 2]]);
      const config = makeConfig({ location: "paris", allergens: ["pm25"] });

      const result = await fetchForecast(hass, config);

      expect(result[0].entity_id).toBe("sensor.pm25_paris");
    });

    it("allergy_risk uses qualite_globale_pollen_ pattern", async () => {
      const hass = makeHass("paris", [["allergy_risk", 3, 2]]);
      const config = makeConfig({ location: "paris", allergens: ["allergy_risk"] });

      const result = await fetchForecast(hass, config);

      expect(result[0].entity_id).toBe("sensor.qualite_globale_pollen_paris");
    });

    it("qualite_globale uses qualite_globale_ pattern (no pollen suffix)", async () => {
      const hass = makeHass("paris", [["qualite_globale", 3, 2]]);
      const config = makeConfig({ location: "paris", allergens: ["qualite_globale"] });

      const result = await fetchForecast(hass, config);

      expect(result[0].entity_id).toBe("sensor.qualite_globale_paris");
    });

    it("forecast j+1 appends _j_1 to base entity ID", async () => {
      const states = {
        "sensor.niveau_bouleau_paris": { state: "3", attributes: { "Libellé": "" } },
        "sensor.niveau_bouleau_paris_j_1": { state: "2", attributes: { "Libellé": "" } },
      };
      const hass = createHass(states, { language: "fr" });
      const config = makeConfig({ location: "paris", allergens: ["birch"] });

      const result = await fetchForecast(hass, config);

      expect(result[0].day0.state).toBe(3);
      expect(result[0].day1.state).toBe(2);
    });

    it("no2 maps to dioxyde_d_azote entity slug", async () => {
      const hass = makeHass("paris", [["no2", 3, 2]]);
      const config = makeConfig({ location: "paris", allergens: ["no2"] });

      const result = await fetchForecast(hass, config);

      expect(result[0].entity_id).toBe("sensor.dioxyde_d_azote_paris");
    });

    it("so2 maps to dioxyde_de_soufre entity slug", async () => {
      const hass = makeHass("paris", [["so2", 3, 2]]);
      const config = makeConfig({ location: "paris", allergens: ["so2"] });

      const result = await fetchForecast(hass, config);

      expect(result[0].entity_id).toBe("sensor.dioxyde_de_soufre_paris");
    });
  });

  // 7. Manual mode
  describe("manual mode", () => {
    it("pollen allergens in manual mode use niveau_ stem", async () => {
      const states = {
        "sensor.pfx_niveau_bouleau_sfx": {
          state: "3",
          attributes: { "Libellé": "" },
        },
      };
      const hass = createHass(states, { language: "fr" });
      const config = makeConfig({
        location: "manual",
        allergens: ["birch"],
        entity_prefix: "pfx_",
        entity_suffix: "_sfx",
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].entity_id).toBe("sensor.pfx_niveau_bouleau_sfx");
    });

    it("pollution allergens in manual mode use bare slug stem", async () => {
      const states = {
        "sensor.pfx_pm25_sfx": {
          state: "4",
          attributes: { "Libellé": "" },
        },
      };
      const hass = createHass(states, { language: "fr" });
      const config = makeConfig({
        location: "manual",
        allergens: ["pm25"],
        entity_prefix: "pfx_",
        entity_suffix: "_sfx",
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].entity_id).toBe("sensor.pfx_pm25_sfx");
    });

    it("allergy_risk in manual mode uses qualite_globale_pollen stem", async () => {
      const states = {
        "sensor.pfx_qualite_globale_pollen_sfx": {
          state: "3",
          attributes: { "Libellé": "" },
        },
      };
      const hass = createHass(states, { language: "fr" });
      const config = makeConfig({
        location: "manual",
        allergens: ["allergy_risk"],
        entity_prefix: "pfx_",
        entity_suffix: "_sfx",
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].entity_id).toBe("sensor.pfx_qualite_globale_pollen_sfx");
    });

    it("qualite_globale in manual mode uses qualite_globale stem", async () => {
      const states = {
        "sensor.pfx_qualite_globale_sfx": {
          state: "3",
          attributes: { "Libellé": "" },
        },
      };
      const hass = createHass(states, { language: "fr" });
      const config = makeConfig({
        location: "manual",
        allergens: ["qualite_globale"],
        entity_prefix: "pfx_",
        entity_suffix: "_sfx",
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].entity_id).toBe("sensor.pfx_qualite_globale_sfx");
    });

    it("manual mode reads j+1 from {sensorId}_j_1", async () => {
      const states = {
        "sensor.niveau_bouleau_manual": {
          state: "3",
          attributes: { "Libellé": "" },
        },
        "sensor.niveau_bouleau_manual_j_1": {
          state: "5",
          attributes: { "Libellé": "" },
        },
      };
      const hass = createHass(states, { language: "fr" });
      const config = makeConfig({
        location: "manual",
        allergens: ["birch"],
        entity_prefix: "",
        entity_suffix: "_manual",
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].day0.state).toBe(3);
      expect(result[0].day1.state).toBe(5);
    });
  });

  // 8. Threshold filtering
  describe("threshold filtering", () => {
    it("filters out allergens where all days are below pollen_threshold", async () => {
      const hass = makeHass("paris", [
        ["birch", 3, 2],
        ["grass", 0, 0],
      ]);
      const config = makeConfig({
        location: "paris",
        allergens: ["birch", "grass"],
        pollen_threshold: 1,
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].allergenReplaced).toBe("birch");
    });

    it("includes allergens when any day meets pollen_threshold", async () => {
      const hass = makeHass("paris", [
        ["birch", 0, 3],  // today=0 but tomorrow=3 meets threshold
      ]);
      const config = makeConfig({
        location: "paris",
        allergens: ["birch"],
        pollen_threshold: 1,
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
    });

    it("includes all allergens when pollen_threshold is 0", async () => {
      const hass = makeHass("paris", [
        ["birch", 0, 0],
        ["grass", 0, 0],
      ]);
      const config = makeConfig({
        location: "paris",
        allergens: ["birch", "grass"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(2);
    });

    it("level 0 (indisponible) does not meet threshold 1", async () => {
      const hass = makeHass("paris", [["birch", 0, 0]]);
      const config = makeConfig({
        location: "paris",
        allergens: ["birch"],
        pollen_threshold: 1,
      });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(0);
    });
  });

  // 9. ATMO_ALLERGEN_MAP
  describe("ATMO_ALLERGEN_MAP", () => {
    it("maps canonical pollen names to correct French slugs", () => {
      expect(ATMO_ALLERGEN_MAP["birch"]).toBe("bouleau");
      expect(ATMO_ALLERGEN_MAP["ragweed"]).toBe("ambroisie");
      expect(ATMO_ALLERGEN_MAP["mugwort"]).toBe("armoise");
      expect(ATMO_ALLERGEN_MAP["alder"]).toBe("aulne");
      expect(ATMO_ALLERGEN_MAP["grass"]).toBe("gramine");
      expect(ATMO_ALLERGEN_MAP["olive"]).toBe("olivier");
    });

    it("maps canonical pollution names to correct French slugs", () => {
      expect(ATMO_ALLERGEN_MAP["pm25"]).toBe("pm25");
      expect(ATMO_ALLERGEN_MAP["pm10"]).toBe("pm10");
      expect(ATMO_ALLERGEN_MAP["ozone"]).toBe("ozone");
      expect(ATMO_ALLERGEN_MAP["no2"]).toBe("dioxyde_d_azote");
      expect(ATMO_ALLERGEN_MAP["so2"]).toBe("dioxyde_de_soufre");
    });

    it("maps summary allergens to their entity slug prefixes", () => {
      expect(ATMO_ALLERGEN_MAP["allergy_risk"]).toBe("qualite_globale_pollen");
      expect(ATMO_ALLERGEN_MAP["qualite_globale"]).toBe("qualite_globale");
    });
  });

  // 10. ATMO_POLLUTION_ALLERGENS
  describe("ATMO_POLLUTION_ALLERGENS", () => {
    it("contains the five pollution allergen keys", () => {
      expect(ATMO_POLLUTION_ALLERGENS.has("pm25")).toBe(true);
      expect(ATMO_POLLUTION_ALLERGENS.has("pm10")).toBe(true);
      expect(ATMO_POLLUTION_ALLERGENS.has("ozone")).toBe(true);
      expect(ATMO_POLLUTION_ALLERGENS.has("no2")).toBe(true);
      expect(ATMO_POLLUTION_ALLERGENS.has("so2")).toBe(true);
    });

    it("does not contain pollen allergens", () => {
      expect(ATMO_POLLUTION_ALLERGENS.has("birch")).toBe(false);
      expect(ATMO_POLLUTION_ALLERGENS.has("grass")).toBe(false);
      expect(ATMO_POLLUTION_ALLERGENS.has("allergy_risk")).toBe(false);
      expect(ATMO_POLLUTION_ALLERGENS.has("qualite_globale")).toBe(false);
    });
  });

  // Exports
  describe("ATMO_ALLERGENS export", () => {
    it("is an array containing all allergen keys from stubConfigATMO", () => {
      expect(Array.isArray(ATMO_ALLERGENS)).toBe(true);
      expect(ATMO_ALLERGENS).toEqual(stubConfigATMO.allergens);
    });
  });

  // Sorting
  describe("sorting", () => {
    it("sorts by value_descending by default", async () => {
      const hass = makeHass("paris", [
        ["birch", 2, 1],
        ["grass", 5, 4],
      ]);
      const config = makeConfig({
        location: "paris",
        allergens: ["birch", "grass"],
        sort: "value_descending",
        sort_pollution_block: false,
        allergy_risk_top: false,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].day0.display_state).toBeGreaterThanOrEqual(
        result[1].day0.display_state,
      );
    });

    it("sorts by value_ascending", async () => {
      const hass = makeHass("paris", [
        ["birch", 5, 4],
        ["grass", 2, 1],
      ]);
      const config = makeConfig({
        location: "paris",
        allergens: ["birch", "grass"],
        sort: "value_ascending",
        sort_pollution_block: false,
        allergy_risk_top: false,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].day0.display_state).toBeLessThanOrEqual(
        result[1].day0.display_state,
      );
    });

    it("level 7 (evenement) sorts as display_state=6 (equal to max)", async () => {
      const hass = makeHass("paris", [
        ["birch", 7, 6],   // display_state=6
        ["grass", 6, 5],   // display_state=6
        ["alder", 3, 2],   // display_state=3
      ]);
      const config = makeConfig({
        location: "paris",
        allergens: ["birch", "grass", "alder"],
        sort: "value_descending",
        sort_pollution_block: false,
        allergy_risk_top: false,
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      // alder (display_state=3) should be last
      expect(result[result.length - 1].allergenReplaced).toBe("alder");
    });
  });

  // Auto-detection
  describe("location auto-detection", () => {
    it("auto-detects location from pollen entity IDs when location is empty", async () => {
      const states = {
        "sensor.niveau_bouleau_lyon": { state: "3", attributes: { "Libellé": "" } },
        "sensor.niveau_bouleau_lyon_j_1": { state: "2", attributes: { "Libellé": "" } },
      };
      const hass = createHass(states, { language: "fr" });
      const config = makeConfig({ location: "", allergens: ["birch"] });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].entity_id).toBe("sensor.niveau_bouleau_lyon");
    });

    it("auto-detects location from pollution entity IDs as fallback", async () => {
      const states = {
        "sensor.pm25_marseille": { state: "4", attributes: { "Libellé": "" } },
        "sensor.pm25_marseille_j_1": { state: "3", attributes: { "Libellé": "" } },
      };
      const hass = createHass(states, { language: "fr" });
      const config = makeConfig({ location: "", allergens: ["pm25"] });

      const result = await fetchForecast(hass, config);

      expect(result.length).toBe(1);
      expect(result[0].entity_id).toBe("sensor.pm25_marseille");
    });

    it("returns empty array when no location and no entities to detect from", async () => {
      const hass = createHass({}, { language: "fr" });
      const config = makeConfig({ location: "", allergens: ["birch"] });

      const result = await fetchForecast(hass, config);

      expect(result).toEqual([]);
    });
  });

  // User phrase overrides
  describe("phrase overrides", () => {
    it("respects user phrase overrides for allergen display names", async () => {
      const hass = makeHass("paris", [["birch", 3, 2]]);
      const config = makeConfig({
        location: "paris",
        allergens: ["birch"],
        phrases: {
          full: { birch: "Mon Bouleau" },
          short: {},
          levels: [],
          days: {},
          no_information: "",
        },
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].allergenCapitalized).toBe("Mon Bouleau");
    });

    it("uses abbreviated allergenShort from phrases.short when allergens_abbreviated=true", async () => {
      const hass = makeHass("paris", [["birch", 3, 2]]);
      const config = makeConfig({
        location: "paris",
        allergens: ["birch"],
        allergens_abbreviated: true,
        phrases: {
          full: {},
          short: { birch: "Bou." },
          levels: [],
          days: {},
          no_information: "",
        },
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].allergenShort).toBe("Bou.");
    });
  });
});
