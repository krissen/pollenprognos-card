import { describe, it, expect } from "vitest";
import {
  fetchForecast,
  stubConfigATMO,
  ATMO_ALLERGENS,
  ATMO_ALLERGEN_MAP,
  ATMO_POLLUTION_ALLERGENS,
  discoverAtmoSensors,
  findAtmoLocationBySlug,
  resolveEntityIds,
  classifyAtmoEntityRelaxed,
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

    it("uses localized label for level 0 (Indisponible) in French UI", async () => {
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

    it("uses localized label for level 0 in non-French UI even when Libelle is French", async () => {
      // Regression: the integration always reports 'Libellé: "Indisponible"' for
      // level 0, which previously leaked into non-French UIs.
      const states = {
        "sensor.niveau_bouleau_paris": {
          state: "0",
          attributes: { "Libellé": "Indisponible" },
        },
      };
      const hass = createHass(states, { language: "sv" });
      const config = makeConfig({
        location: "paris",
        allergens: ["birch"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].day0.state_text).toBe("Otillgänglig");
    });

    it("uses localized label for level 7 (Événement) in French UI", async () => {
      const states = {
        "sensor.niveau_bouleau_paris": {
          state: "7",
          attributes: { "Libellé": "Événement" },
        },
      };
      const hass = createHass(states, { language: "fr" });
      const config = makeConfig({
        location: "paris",
        allergens: ["birch"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].day0.state_text).toBe("Événement");
    });

    it("uses localized label for level 7 in non-French UI", async () => {
      const states = {
        "sensor.niveau_bouleau_paris": {
          state: "7",
          attributes: { "Libellé": "Événement" },
        },
      };
      const hass = createHass(states, { language: "sv" });
      const config = makeConfig({
        location: "paris",
        allergens: ["birch"],
        pollen_threshold: 0,
      });

      const result = await fetchForecast(hass, config);

      expect(result[0].day0.state_text).toBe("Händelse");
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

// Helper: create a hass mock with prefixed entity IDs (multi-instance pattern)
function makePrefixedHass(prefix, location, allergenStates, configEntryId) {
  const states = {};
  const entities = {};
  const deviceId = `device_${location}`;
  for (const [allergen, todayVal, tomorrowVal] of allergenStates) {
    const frSlug = ATMO_ALLERGEN_MAP[allergen];
    let todayId;
    if (allergen === "allergy_risk") {
      todayId = `sensor.${prefix}_qualite_globale_pollen_${location}`;
    } else if (allergen === "qualite_globale") {
      todayId = `sensor.${prefix}_qualite_globale_${location}`;
    } else if (ATMO_POLLUTION_ALLERGENS.has(allergen)) {
      todayId = `sensor.${prefix}_${frSlug}_${location}`;
    } else {
      todayId = `sensor.${prefix}_niveau_${frSlug}_${location}`;
    }
    const j1Id = `${todayId}_j_1`;
    states[todayId] = { state: String(todayVal), attributes: { "Libellé": "", "Nom de la zone": location.charAt(0).toUpperCase() + location.slice(1) } };
    entities[todayId] = { platform: "atmofrance", device_id: deviceId };
    if (tomorrowVal !== undefined) {
      states[j1Id] = { state: String(tomorrowVal), attributes: { "Libellé": "" } };
      entities[j1Id] = { platform: "atmofrance", device_id: deviceId };
    }
  }
  const cityLabel = location.charAt(0).toUpperCase() + location.slice(1);
  const devices = {
    [deviceId]: {
      name: "Atmo France",
      config_entries: [configEntryId],
      identifiers: [["atmofrance", `Test-${cityLabel}`]],
    },
  };
  return createHass(states, { language: "fr", entities, devices });
}

describe("discoverAtmoSensors", () => {
  it("discovers entities grouped by config_entry_id via hass.entities", () => {
    const hass = makePrefixedHass("toulouse", "toulouse", [
      ["birch", 3, 2],
      ["pm25", 4, 3],
    ], "entry_toulouse");

    const result = discoverAtmoSensors(hass);

    expect(result.locations.size).toBe(1);
    expect(result.locations.has("entry_toulouse")).toBe(true);
    const loc = result.locations.get("entry_toulouse");
    expect(loc.entities.get("birch")).toBe("sensor.toulouse_niveau_bouleau_toulouse");
    expect(loc.entities.get("pm25")).toBe("sensor.toulouse_pm25_toulouse");
  });

  it("discovers multiple locations from different config entries", () => {
    const hass1 = makePrefixedHass("toulouse", "toulouse", [["birch", 3, 2]], "entry_toulouse");
    const hass2 = makeHass("nice", [["birch", 4, 3]]);
    // Merge: nice uses non-prefixed entities, add entity registry entries for nice
    const merged = createHass(
      { ...hass1.states, ...hass2.states },
      {
        language: "fr",
        entities: {
          ...hass1.entities,
          "sensor.niveau_bouleau_nice": { platform: "atmofrance", device_id: "device_nice" },
          "sensor.niveau_bouleau_nice_j_1": { platform: "atmofrance", device_id: "device_nice" },
        },
        devices: {
          ...hass1.devices,
          device_nice: { name: "Atmo France", config_entries: ["entry_nice"], identifiers: [["atmofrance", "AtmoSud-Nice"]] },
        },
      },
    );

    const result = discoverAtmoSensors(merged);

    expect(result.locations.size).toBe(2);
    expect(result.locations.has("entry_toulouse")).toBe(true);
    expect(result.locations.has("entry_nice")).toBe(true);
  });

  it("classifies all allergen types correctly", () => {
    const hass = makePrefixedHass("pfx", "city", [
      ["birch", 3, 2],
      ["ragweed", 2, 1],
      ["mugwort", 1, 0],
      ["alder", 2, 1],
      ["grass", 3, 2],
      ["olive", 1, 0],
      ["allergy_risk", 4, 3],
      ["qualite_globale", 3, 2],
      ["pm25", 2, 1],
      ["pm10", 3, 2],
      ["ozone", 1, 0],
      ["no2", 2, 1],
      ["so2", 1, 0],
    ], "entry_city");

    const result = discoverAtmoSensors(hass);
    const entities = result.locations.get("entry_city").entities;

    expect(entities.size).toBe(13);
    expect(entities.get("birch")).toContain("niveau_bouleau");
    expect(entities.get("allergy_risk")).toContain("qualite_globale_pollen");
    expect(entities.get("qualite_globale")).toMatch(/qualite_globale_city$/);
    expect(entities.get("pm25")).toContain("pm25");
    expect(entities.get("no2")).toContain("dioxyde_d_azote");
  });

  it("excludes concentration entities", () => {
    const states = {
      "sensor.toulouse_concentration_ambroisie_toulouse": { state: "42", attributes: {} },
      "sensor.toulouse_niveau_bouleau_toulouse": { state: "3", attributes: { "Libellé": "" } },
    };
    const entities = {
      "sensor.toulouse_concentration_ambroisie_toulouse": { platform: "atmofrance", device_id: "d1" },
      "sensor.toulouse_niveau_bouleau_toulouse": { platform: "atmofrance", device_id: "d1" },
    };
    const hass = createHass(states, {
      language: "fr",
      entities,
      devices: { d1: { name: "Test", config_entries: ["e1"] } },
    });

    const result = discoverAtmoSensors(hass);
    const loc = result.locations.get("e1");

    expect(loc.entities.has("birch")).toBe(true);
    // concentration entity should not produce a ragweed entry
    expect(loc.entities.has("ragweed")).toBe(false);
  });

  it("falls back to regex scan when hass.entities is unavailable", () => {
    const states = {
      "sensor.niveau_bouleau_nice": { state: "3", attributes: { "Libellé": "" } },
      "sensor.pm25_nice": { state: "2", attributes: {} },
    };
    const hass = createHass(states, { language: "fr", entities: undefined });

    const result = discoverAtmoSensors(hass);

    // Falls back to "default" grouping (no config_entry_id)
    expect(result.locations.size).toBe(1);
    expect(result.locations.has("default")).toBe(true);
    expect(result.locations.get("default").entities.get("birch")).toBe("sensor.niveau_bouleau_nice");
  });
});

describe("resolveEntityIds with discovery (prefixed entities)", () => {
  it("resolves prefixed entities via config_entry_id", () => {
    const hass = makePrefixedHass("toulouse", "toulouse", [
      ["birch", 3, 2],
      ["pm25", 4, 3],
      ["allergy_risk", 2, 1],
    ], "entry_toulouse");

    const config = makeConfig({
      location: "entry_toulouse",
      allergens: ["birch", "pm25", "allergy_risk"],
    });

    const map = resolveEntityIds(config, hass);

    expect(map.get("birch")).toBe("sensor.toulouse_niveau_bouleau_toulouse");
    expect(map.get("pm25")).toBe("sensor.toulouse_pm25_toulouse");
    expect(map.get("allergy_risk")).toBe("sensor.toulouse_qualite_globale_pollen_toulouse");
  });

  it("auto-detects prefixed location when location is empty", () => {
    const hass = makePrefixedHass("toulouse", "toulouse", [
      ["birch", 3, 2],
    ], "entry_toulouse");

    const config = makeConfig({ location: "", allergens: ["birch"] });

    const map = resolveEntityIds(config, hass);

    expect(map.get("birch")).toBe("sensor.toulouse_niveau_bouleau_toulouse");
  });

  it("falls back to slug-based resolution for old configs", () => {
    const hass = makeHass("nice", [["birch", 3, 2]]);
    const config = makeConfig({ location: "nice", allergens: ["birch"] });

    const map = resolveEntityIds(config, hass);

    expect(map.get("birch")).toBe("sensor.niveau_bouleau_nice");
  });

  it("recovers when location is a stale config_entry_id", () => {
    // 26-char Crockford-base32 ULIDs — isConfigEntryId() detects this format.
    const realEntryId = "01ABCDEFGHJKMNPQRSTVWXYZ01";
    const staleEntryId = "01ZZZZZZZZZZZZZZZZZZZZZZZZ";
    const hass = makePrefixedHass("toulouse", "toulouse", [
      ["birch", 3, 2],
      ["pm25", 4, 3],
    ], realEntryId);

    // Saved config_entry_id no longer matches (integration removed/reinstalled).
    // Adapter should fall back to first discovered location instead of returning empty.
    const config = makeConfig({
      location: staleEntryId,
      allergens: ["birch", "pm25"],
    });

    const map = resolveEntityIds(config, hass);

    expect(map.get("birch")).toBe("sensor.toulouse_niveau_bouleau_toulouse");
    expect(map.get("pm25")).toBe("sensor.toulouse_pm25_toulouse");
  });
});

describe("fetchForecast with prefixed entities", () => {
  it("returns correct data for prefixed entity IDs", async () => {
    const hass = makePrefixedHass("toulouse", "toulouse", [
      ["birch", 3, 2],
      ["grass", 5, 4],
    ], "entry_toulouse");

    const config = makeConfig({
      location: "entry_toulouse",
      allergens: ["birch", "grass"],
    });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(2);
    expect(result[0].entity_id).toContain("toulouse_niveau_");
    expect(result[0].day0.state).toBeGreaterThan(0);
    expect(result[0].day1.state).toBeGreaterThan(0);
  });

  it("reads j+1 forecast from {entity_id}_j_1 for prefixed entities", async () => {
    const hass = makePrefixedHass("toulouse", "toulouse", [
      ["birch", 3, 5],
    ], "entry_toulouse");

    const config = makeConfig({
      location: "entry_toulouse",
      allergens: ["birch"],
    });

    const result = await fetchForecast(hass, config);

    expect(result[0].day0.state).toBe(3);
    expect(result[0].day1.state).toBe(5);
  });

  it("handles mixed prefixed and non-prefixed locations", async () => {
    // Nice (non-prefixed) via old slug config still works
    const hass = makeHass("nice", [["birch", 4, 2]]);
    const config = makeConfig({ location: "nice", allergens: ["birch"] });

    const result = await fetchForecast(hass, config);

    expect(result.length).toBe(1);
    expect(result[0].entity_id).toBe("sensor.niveau_bouleau_nice");
    expect(result[0].day0.state).toBe(4);
    expect(result[0].day1.state).toBe(2);
  });
});

describe("classifyAtmoEntityRelaxed", () => {
  it("matches standard niveau_ entities", () => {
    expect(classifyAtmoEntityRelaxed("sensor.niveau_ambroisie_nice")).toBe("ragweed");
    expect(classifyAtmoEntityRelaxed("sensor.niveau_bouleau_paris")).toBe("birch");
    expect(classifyAtmoEntityRelaxed("sensor.niveau_gramine_nice")).toBe("grass");
    expect(classifyAtmoEntityRelaxed("sensor.niveau_olivier_nice")).toBe("olive");
    expect(classifyAtmoEntityRelaxed("sensor.niveau_armoise_nice")).toBe("mugwort");
    expect(classifyAtmoEntityRelaxed("sensor.niveau_aulne_nice")).toBe("alder");
  });

  it("matches old-style niveau_alerte_ entities", () => {
    expect(classifyAtmoEntityRelaxed("sensor.niveau_alerte_ambroisie_nice")).toBe("ragweed");
    expect(classifyAtmoEntityRelaxed("sensor.niveau_alerte_bouleau_paris")).toBe("birch");
  });

  it("matches bare allergen slug (no niveau_ prefix)", () => {
    expect(classifyAtmoEntityRelaxed("sensor.ambroisie_nice")).toBe("ragweed");
    expect(classifyAtmoEntityRelaxed("sensor.bouleau_paris")).toBe("birch");
  });

  it("matches prefixed entities (HA disambiguation)", () => {
    expect(classifyAtmoEntityRelaxed("sensor.chambray_les_tours_niveau_ambroisie_chambray_les_tours")).toBe("ragweed");
    expect(classifyAtmoEntityRelaxed("sensor.plouha_niveau_bouleau_plouha")).toBe("birch");
  });

  it("prefers niveau_{slug} over a slug-shaped user prefix", () => {
    // bouleau appears in the prefix but ambroisie is the actual pollen slug;
    // classifier must return ragweed, not birch.
    expect(classifyAtmoEntityRelaxed("sensor.bouleau_niveau_ambroisie_nice")).toBe("ragweed");
    expect(classifyAtmoEntityRelaxed("sensor.ambroisie_niveau_bouleau_nice")).toBe("birch");
  });

  it("rejects concentration entities", () => {
    expect(classifyAtmoEntityRelaxed("sensor.concentration_ambroisie_nice")).toBeNull();
    expect(classifyAtmoEntityRelaxed("sensor.chambray_les_tours_concentration_bouleau_chambray_les_tours")).toBeNull();
  });

  it("classifies summary entities", () => {
    expect(classifyAtmoEntityRelaxed("sensor.qualite_globale_pollen_nice")).toBe("allergy_risk");
    expect(classifyAtmoEntityRelaxed("sensor.chambray_les_tours_qualite_globale_pollen_chambray_les_tours")).toBe("allergy_risk");
    expect(classifyAtmoEntityRelaxed("sensor.qualite_globale_nice")).toBe("qualite_globale");
  });

  it("classifies pollution entities", () => {
    expect(classifyAtmoEntityRelaxed("sensor.pm25_nice")).toBe("pm25");
    expect(classifyAtmoEntityRelaxed("sensor.ozone_nice")).toBe("ozone");
    expect(classifyAtmoEntityRelaxed("sensor.dioxyde_d_azote_nice")).toBe("no2");
    expect(classifyAtmoEntityRelaxed("sensor.dioxyde_de_soufre_nice")).toBe("so2");
  });
});

describe("discoverAtmoSensors: device-based discovery", () => {
  it("discovers entities via device identifiers (tier 1)", () => {
    const hass = makePrefixedHass("toulouse", "toulouse", [
      ["birch", 3, 2],
      ["pm25", 4, 3],
    ], "entry_toulouse");

    const result = discoverAtmoSensors(hass);

    expect(result.locations.size).toBe(1);
    expect(result.locations.has("entry_toulouse")).toBe(true);
    const loc = result.locations.get("entry_toulouse");
    expect(loc.entities.get("birch")).toBe("sensor.toulouse_niveau_bouleau_toulouse");
    expect(loc.entities.get("pm25")).toBe("sensor.toulouse_pm25_toulouse");
  });

  it("discovers multi-word prefix entities via device path", () => {
    const states = {
      "sensor.chambray_les_tours_niveau_ambroisie_chambray_les_tours": {
        state: "3", attributes: { "Libellé": "", "Nom de la zone": "Chambray-lès-Tours" },
      },
      "sensor.chambray_les_tours_niveau_bouleau_chambray_les_tours": {
        state: "5", attributes: { "Libellé": "", "Nom de la zone": "Chambray-lès-Tours" },
      },
      "sensor.chambray_les_tours_qualite_globale_pollen_chambray_les_tours": {
        state: "4", attributes: { "Libellé": "", "Nom de la zone": "Chambray-lès-Tours" },
      },
    };
    const entities = {};
    for (const eid of Object.keys(states)) {
      entities[eid] = { platform: "atmofrance", device_id: "dev_chambray" };
    }
    const devices = {
      dev_chambray: {
        name: "Atmo France",
        config_entries: ["entry_chambray"],
        identifiers: [["atmofrance", "Lig'Air-Chambray-lès-Tours"]],
      },
    };
    const hass = createHass(states, { language: "fr", entities, devices });

    const result = discoverAtmoSensors(hass);

    expect(result.locations.size).toBe(1);
    expect(result.locations.has("entry_chambray")).toBe(true);
    const loc = result.locations.get("entry_chambray");
    expect(loc.entities.get("ragweed")).toBe("sensor.chambray_les_tours_niveau_ambroisie_chambray_les_tours");
    expect(loc.entities.get("birch")).toBe("sensor.chambray_les_tours_niveau_bouleau_chambray_les_tours");
    expect(loc.entities.get("allergy_risk")).toBe("sensor.chambray_les_tours_qualite_globale_pollen_chambray_les_tours");
  });

  it("resolves label from device identifier (city after first dash)", () => {
    const states = {
      "sensor.pfx_niveau_bouleau_city": { state: "3", attributes: { "Libellé": "", "Nom de la zone": "Some Admin Zone" } },
    };
    const entities = {
      "sensor.pfx_niveau_bouleau_city": { platform: "atmofrance", device_id: "d1" },
    };
    const devices = {
      d1: {
        name: "Atmo France",
        config_entries: ["e1"],
        identifiers: [["atmofrance", "Air Breizh-Plouha"]],
      },
    };
    const hass = createHass(states, { language: "fr", entities, devices });

    const result = discoverAtmoSensors(hass);
    // Identifier city takes precedence over "Nom de la zone"
    expect(result.locations.get("e1").label).toBe("Plouha");
  });

  it("resolves label from device name_by_user (highest priority)", () => {
    const states = {
      "sensor.pfx_niveau_bouleau_city": { state: "3", attributes: { "Libellé": "", "Nom de la zone": "Zone Name" } },
    };
    const entities = {
      "sensor.pfx_niveau_bouleau_city": { platform: "atmofrance", device_id: "d1" },
    };
    const devices = {
      d1: {
        name: "Atmo France",
        name_by_user: "Mon Emplacement",
        config_entries: ["e1"],
        identifiers: [["atmofrance", "Test-City"]],
      },
    };
    const hass = createHass(states, { language: "fr", entities, devices });

    const result = discoverAtmoSensors(hass);
    // name_by_user wins over identifier and zone name
    expect(result.locations.get("e1").label).toBe("Mon Emplacement");
  });

  it("falls back to Nom de la zone when no device info", () => {
    const states = {
      "sensor.niveau_bouleau_nice": { state: "3", attributes: { "Libellé": "", "Nom de la zone": "Nice" } },
    };
    // Tier 3 fallback: no entities, no devices
    const hass = createHass(states, { language: "fr", entities: undefined });

    const result = discoverAtmoSensors(hass);
    expect(result.locations.get("default").label).toBe("Nice");
  });

  it("falls back to tier 2 when no devices have atmofrance identifiers", () => {
    const states = {
      "sensor.niveau_bouleau_nice": { state: "3", attributes: { "Libellé": "" } },
    };
    const entities = {
      "sensor.niveau_bouleau_nice": { platform: "atmofrance", device_id: "d1" },
    };
    const devices = {
      d1: { name: "Something Else", config_entries: ["e1"] },
    };
    const hass = createHass(states, { language: "fr", entities, devices });

    const result = discoverAtmoSensors(hass);

    expect(result.locations.size).toBe(1);
    expect(result.locations.has("e1")).toBe(true);
    expect(result.locations.get("e1").entities.get("birch")).toBe("sensor.niveau_bouleau_nice");
  });

  it("falls back to tier 3 (regex) when hass.entities is unavailable", () => {
    const states = {
      "sensor.niveau_bouleau_nice": { state: "3", attributes: { "Libellé": "" } },
      "sensor.pm25_nice": { state: "2", attributes: {} },
    };
    const hass = createHass(states, { language: "fr", entities: undefined });

    const result = discoverAtmoSensors(hass);

    expect(result.locations.size).toBe(1);
    expect(result.locations.has("default")).toBe(true);
    expect(result.locations.get("default").entities.get("birch")).toBe("sensor.niveau_bouleau_nice");
  });

  it("regex fallback handles multi-word prefix", () => {
    const states = {
      "sensor.chambray_les_tours_niveau_bouleau_chambray_les_tours": {
        state: "3", attributes: { "Libellé": "" },
      },
    };
    const hass = createHass(states, { language: "fr", entities: undefined });

    const result = discoverAtmoSensors(hass);

    expect(result.locations.size).toBe(1);
    expect(result.locations.get("default").entities.get("birch"))
      .toBe("sensor.chambray_les_tours_niveau_bouleau_chambray_les_tours");
  });

  it("regex fallback handles legacy niveau_alerte_{slug} entities", () => {
    const states = {
      "sensor.niveau_alerte_bouleau_nice": { state: "3", attributes: { "Libellé": "" } },
      "sensor.niveau_alerte_ambroisie_nice": { state: "2", attributes: { "Libellé": "" } },
    };
    const hass = createHass(states, { language: "fr", entities: undefined });

    const result = discoverAtmoSensors(hass);

    expect(result.locations.size).toBe(1);
    expect(result.locations.get("default").entities.get("birch"))
      .toBe("sensor.niveau_alerte_bouleau_nice");
    expect(result.locations.get("default").entities.get("ragweed"))
      .toBe("sensor.niveau_alerte_ambroisie_nice");
  });
});

describe("findAtmoLocationBySlug", () => {
  it("maps a legacy slug to a discovered config_entry_id (non-prefixed)", () => {
    const hass = makeHass("nice", [["birch", 3, 2]]);
    const discovery = discoverAtmoSensors(hass);
    expect(findAtmoLocationBySlug(discovery, "nice")).toBe("default");
  });

  it("maps a legacy slug to a discovered config_entry_id (prefixed)", () => {
    const hass = makePrefixedHass("toulouse", "toulouse", [["birch", 3, 2]], "entry_toulouse");
    const discovery = discoverAtmoSensors(hass);
    expect(findAtmoLocationBySlug(discovery, "toulouse")).toBe("entry_toulouse");
  });

  it("handles multi-word slugs", () => {
    const hass = makePrefixedHass("chambray_les_tours", "chambray_les_tours", [
      ["birch", 3, 2],
    ], "entry_chambray");
    const discovery = discoverAtmoSensors(hass);
    expect(findAtmoLocationBySlug(discovery, "chambray_les_tours")).toBe("entry_chambray");
  });

  it("returns null for unknown slugs", () => {
    const hass = makeHass("nice", [["birch", 3, 2]]);
    const discovery = discoverAtmoSensors(hass);
    expect(findAtmoLocationBySlug(discovery, "marseille")).toBeNull();
    expect(findAtmoLocationBySlug(discovery, "")).toBeNull();
    expect(findAtmoLocationBySlug(discovery, null)).toBeNull();
  });

  it("lets resolveEntityIds serve prefixed entities when config carries a legacy slug", () => {
    const hass = makePrefixedHass("toulouse", "toulouse", [
      ["birch", 3, 2],
    ], "entry_toulouse");
    const cfg = makeConfig({ location: "toulouse", allergens: ["birch"] });

    const map = resolveEntityIds(cfg, hass);

    expect(map.get("birch")).toBe("sensor.toulouse_niveau_bouleau_toulouse");
  });
});
