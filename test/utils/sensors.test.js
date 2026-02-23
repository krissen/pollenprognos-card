import { describe, it, expect } from "vitest";
import { findAvailableSensors } from "../../src/utils/sensors.js";
import { createHass } from "../helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal sensor state object. */
function s(state = "3", attrs = {}) {
  return { state, attributes: attrs };
}

// ===========================================================================
// PP (Pollenprognos, Sweden) - city-based
// ===========================================================================

describe("findAvailableSensors", () => {
  describe("PP", () => {
    it("returns sensors for a configured city and allergens", () => {
      const hass = createHass({
        "sensor.pollen_stockholm_birch": s(),
        "sensor.pollen_stockholm_grass": s(),
      });
      const cfg = {
        integration: "pp",
        city: "Stockholm",
        allergens: ["birch", "grass"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([
        "sensor.pollen_stockholm_birch",
        "sensor.pollen_stockholm_grass",
      ]);
    });

    it("auto-detects city when cfg.city is empty", () => {
      const hass = createHass({
        "sensor.pollen_goteborg_birch": s(),
        "sensor.pollen_goteborg_grass": s(),
      });
      const cfg = {
        integration: "pp",
        city: "",
        allergens: ["birch"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.pollen_goteborg_birch"]);
    });

    it("returns empty when no matching entities exist", () => {
      const hass = createHass({});
      const cfg = {
        integration: "pp",
        city: "stockholm",
        allergens: ["birch"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([]);
    });

    it("falls back to unique candidate search when city matches but entity missing", () => {
      // The sensor id uses a compound city key
      const hass = createHass({
        "sensor.pollen_brakne_hoby_birch": s(),
      });
      const cfg = {
        integration: "pp",
        city: "Bräkne-Hoby",
        allergens: ["birch"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.pollen_brakne_hoby_birch"]);
    });
  });

  // ===========================================================================
  // DWD (Pollenflug, Germany) - region-based
  // ===========================================================================

  describe("DWD", () => {
    it("returns sensors for a configured region_id using German allergen names", () => {
      // normalizeDWD("birch") => "birch", but DWD sensors use German names
      // The function calls normalizeDWD(allergen) which lowercases + replaces umlauts.
      // For "birch" -> "birch", but actual DWD sensors use "birke"
      // The user config uses German names like "birke" or the canonical English name
      // is looked up. Let's test with the actual DWD pattern.
      const hass = createHass({
        "sensor.pollenflug_birke_50": s(),
        "sensor.pollenflug_graeser_50": s(),
      });
      const cfg = {
        integration: "dwd",
        region_id: "50",
        allergens: ["birke", "graeser"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([
        "sensor.pollenflug_birke_50",
        "sensor.pollenflug_graeser_50",
      ]);
    });

    it("handles German umlauts via normalizeDWD", () => {
      // "gräser" -> normalizeDWD -> "graeser"
      const hass = createHass({
        "sensor.pollenflug_graeser_50": s(),
      });
      const cfg = {
        integration: "dwd",
        region_id: "50",
        allergens: ["gräser"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.pollenflug_graeser_50"]);
    });

    it("falls back to unique candidate when region_id not set", () => {
      const hass = createHass({
        "sensor.pollenflug_birke_50": s(),
      });
      const cfg = {
        integration: "dwd",
        region_id: "",
        allergens: ["birke"],
      };

      const result = findAvailableSensors(cfg, hass);

      // Falls back to unique candidate starting with sensor.pollenflug_birke_
      expect(result).toEqual(["sensor.pollenflug_birke_50"]);
    });

    it("returns empty when multiple candidates exist without explicit region_id", () => {
      const hass = createHass({
        "sensor.pollenflug_birke_50": s(),
        "sensor.pollenflug_birke_91": s(),
      });
      const cfg = {
        integration: "dwd",
        region_id: "",
        allergens: ["birke"],
      };

      const result = findAvailableSensors(cfg, hass);

      // Two candidates -> no unique match -> empty
      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // PEU (Polleninformation EU) - location-based
  // ===========================================================================

  describe("PEU", () => {
    it("returns sensors for a configured location and allergens", () => {
      const hass = createHass({
        "sensor.polleninformation_wien_birch": s(),
        "sensor.polleninformation_wien_grass": s(),
      });
      const cfg = {
        integration: "peu",
        location: "Wien",
        allergens: ["birch", "grass"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([
        "sensor.polleninformation_wien_birch",
        "sensor.polleninformation_wien_grass",
      ]);
    });

    it("handles locations with special characters via slugify", () => {
      // slugify("München") => "munchen"
      const hass = createHass({
        "sensor.polleninformation_munchen_birch": s(),
      });
      const cfg = {
        integration: "peu",
        location: "München",
        allergens: ["birch"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.polleninformation_munchen_birch"]);
    });

    it("falls back to unique candidate when location empty", () => {
      const hass = createHass({
        "sensor.polleninformation_wien_birch": s(),
      });
      const cfg = {
        integration: "peu",
        location: "",
        allergens: ["birch"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.polleninformation_wien_birch"]);
    });

    it("returns empty when no matching entities exist", () => {
      const hass = createHass({});
      const cfg = {
        integration: "peu",
        location: "Wien",
        allergens: ["birch"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // SILAM - discovery-based + regex fallback
  // ===========================================================================

  describe("SILAM", () => {
    describe("discovery path (hass.entities available)", () => {
      it("returns sensors via entity registry discovery", () => {
        const deviceId = "device_1";
        const configEntryId = "01ABCDEFGHIJKLMNOPQRSTUVWX";
        const hass = createHass(
          {
            "sensor.silam_pollen_london_birch_pollen": s(),
            "sensor.silam_pollen_london_grass_pollen": s(),
          },
          {
            entities: {
              "sensor.silam_pollen_london_birch_pollen": {
                platform: "silam_pollen",
                device_id: deviceId,
                entity_category: null,
                translation_key: "birch",
              },
              "sensor.silam_pollen_london_grass_pollen": {
                platform: "silam_pollen",
                device_id: deviceId,
                entity_category: null,
                translation_key: "grass",
              },
            },
            devices: {
              [deviceId]: {
                name: "London",
                config_entries: [configEntryId],
              },
            },
          },
        );

        const cfg = {
          integration: "silam",
          location: configEntryId,
          allergens: ["birch", "grass"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toContain("sensor.silam_pollen_london_birch_pollen");
        expect(result).toContain("sensor.silam_pollen_london_grass_pollen");
        expect(result).toHaveLength(2);
      });

      it("maps translation_key through silam allergen map to master key", () => {
        const deviceId = "device_1";
        const configEntryId = "01ABCDEFGHIJKLMNOPQRSTUVWX";
        // Dutch translation_key "berk" maps to master "birch"
        const hass = createHass(
          {
            "sensor.silam_pollen_amsterdam_berk": s(),
          },
          {
            entities: {
              "sensor.silam_pollen_amsterdam_berk": {
                platform: "silam_pollen",
                device_id: deviceId,
                entity_category: null,
                translation_key: "berk",
              },
            },
            devices: {
              [deviceId]: {
                name: "Amsterdam",
                config_entries: [configEntryId],
              },
            },
          },
        );
        const cfg = {
          integration: "silam",
          location: configEntryId,
          allergens: ["birch"], // master key
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.silam_pollen_amsterdam_berk"]);
      });
    });

    describe("regex fallback path (no hass.entities)", () => {
      it("returns sensors using regex pattern with location slug", () => {
        // Without hass.entities, falls back to regex:
        // sensor.silam_pollen_{location}_{allergenSlug}
        // For "birch", reverse map en: birch->birch
        const hass = createHass(
          {
            "sensor.silam_pollen_london_birch": s(),
          },
          { entities: {} },
        );
        const cfg = {
          integration: "silam",
          location: "London",
          allergens: ["birch"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.silam_pollen_london_birch"]);
      });

      it("finds Dutch slug for allergen via reverse map", () => {
        // For "alder", nl mapping: "els" -> "alder"
        // So reverse: "alder" -> "els"
        // The function iterates mapping values in JSON order (nl first)
        const hass = createHass(
          {
            "sensor.silam_pollen_amsterdam_els": s(),
          },
          { entities: {} },
        );
        const cfg = {
          integration: "silam",
          location: "Amsterdam",
          allergens: ["alder"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.silam_pollen_amsterdam_els"]);
      });

      it("returns empty when no matching entities exist", () => {
        const hass = createHass({}, { entities: {} });
        const cfg = {
          integration: "silam",
          location: "London",
          allergens: ["birch"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual([]);
      });
    });
  });

  // ===========================================================================
  // Kleenex - category-based
  // ===========================================================================

  describe("Kleenex", () => {
    it("returns category sensors for configured location", () => {
      const hass = createHass({
        "sensor.kleenex_pollen_radar_amsterdam_trees": s(),
        "sensor.kleenex_pollen_radar_amsterdam_grass": s(),
      });
      const cfg = {
        integration: "kleenex",
        location: "Amsterdam",
        allergens: ["trees", "grass"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toContain("sensor.kleenex_pollen_radar_amsterdam_trees");
      expect(result).toContain("sensor.kleenex_pollen_radar_amsterdam_grass");
      expect(result).toHaveLength(2);
    });

    it("maps individual allergen 'birch' to 'trees' category sensor", () => {
      const hass = createHass({
        "sensor.kleenex_pollen_radar_amsterdam_trees": s(),
      });
      const cfg = {
        integration: "kleenex",
        location: "Amsterdam",
        allergens: ["birch"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.kleenex_pollen_radar_amsterdam_trees"]);
    });

    it("maps individual allergen 'ragweed' to 'weeds' category sensor", () => {
      const hass = createHass({
        "sensor.kleenex_pollen_radar_amsterdam_weeds": s(),
      });
      const cfg = {
        integration: "kleenex",
        location: "Amsterdam",
        allergens: ["ragweed"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.kleenex_pollen_radar_amsterdam_weeds"]);
    });

    it("maps individual allergen 'poaceae' to 'grass' category sensor", () => {
      const hass = createHass({
        "sensor.kleenex_pollen_radar_amsterdam_grass": s(),
      });
      const cfg = {
        integration: "kleenex",
        location: "Amsterdam",
        allergens: ["poaceae"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.kleenex_pollen_radar_amsterdam_grass"]);
    });

    it("handles _cat suffix allergens (trees_cat -> trees)", () => {
      const hass = createHass({
        "sensor.kleenex_pollen_radar_amsterdam_trees": s(),
      });
      const cfg = {
        integration: "kleenex",
        location: "Amsterdam",
        allergens: ["trees_cat"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.kleenex_pollen_radar_amsterdam_trees"]);
    });

    it("deduplicates category sensors when multiple allergens map to same category", () => {
      const hass = createHass({
        "sensor.kleenex_pollen_radar_amsterdam_trees": s(),
      });
      const cfg = {
        integration: "kleenex",
        location: "Amsterdam",
        allergens: ["trees", "birch", "oak"],
      };

      const result = findAvailableSensors(cfg, hass);

      // "trees", "birch", "oak" all map to trees category.
      // needsCategories is a Set, so only one "trees" entry.
      expect(result).toEqual(["sensor.kleenex_pollen_radar_amsterdam_trees"]);
    });

    it("detects localized category names (Dutch)", () => {
      // Dutch: "bomen" -> "trees"
      const hass = createHass({
        "sensor.kleenex_pollen_radar_amsterdam_bomen": s(),
      });
      const cfg = {
        integration: "kleenex",
        location: "Amsterdam",
        allergens: ["trees"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.kleenex_pollen_radar_amsterdam_bomen"]);
    });

    it("returns empty for allergens that don't map to any category", () => {
      const hass = createHass({
        "sensor.kleenex_pollen_radar_amsterdam_trees": s(),
      });
      const cfg = {
        integration: "kleenex",
        location: "Amsterdam",
        allergens: ["unknown_allergen"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // PLU (Pollen.lu) - alias-based
  // ===========================================================================

  describe("PLU", () => {
    it("returns sensor for canonical allergen name", () => {
      const hass = createHass({
        "sensor.pollen_birch": s(),
      });
      const cfg = {
        integration: "plu",
        allergens: ["birch"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.pollen_birch"]);
    });

    it("finds sensor using alias from PLU_ALIAS_MAP", () => {
      // PLU_ALIAS_MAP for "birch" includes slugified aliases: rumex, sorrel, ampfer, oseille...
      // For "birch": aliases include betula, birch, birke, bouleau
      // The function tries each alias in order
      const hass = createHass({
        "sensor.pollen_betula": s(), // Latin name alias
      });
      const cfg = {
        integration: "plu",
        allergens: ["birch"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.pollen_betula"]);
    });

    it("returns multiple sensors for multiple allergens", () => {
      const hass = createHass({
        "sensor.pollen_birch": s(),
        "sensor.pollen_hazel": s(),
        "sensor.pollen_poaceae": s(),
      });
      const cfg = {
        integration: "plu",
        allergens: ["birch", "hazel", "poaceae"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([
        "sensor.pollen_birch",
        "sensor.pollen_hazel",
        "sensor.pollen_poaceae",
      ]);
    });

    it("returns empty when no matching alias exists", () => {
      const hass = createHass({});
      const cfg = {
        integration: "plu",
        allergens: ["birch"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([]);
    });

    it("falls back to unique candidate by suffix match", () => {
      // Fallback: filters sensor.pollen_ entries where rest has no underscore
      // and rest matches an alias
      const hass = createHass({
        "sensor.pollen_rumex": s(),
      });
      const cfg = {
        integration: "plu",
        allergens: ["sorrel"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.pollen_rumex"]);
    });
  });

  // ===========================================================================
  // ATMO (Atmo France)
  // ===========================================================================

  describe("ATMO", () => {
    it("returns pollen sensors with niveau_ prefix", () => {
      const hass = createHass({
        "sensor.niveau_bouleau_paris": s(),
        "sensor.niveau_armoise_paris": s(),
      });
      const cfg = {
        integration: "atmo",
        location: "Paris",
        allergens: ["birch", "mugwort"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([
        "sensor.niveau_bouleau_paris",
        "sensor.niveau_armoise_paris",
      ]);
    });

    it("returns allergy_risk sensor with qualite_globale_pollen_ prefix", () => {
      const hass = createHass({
        "sensor.qualite_globale_pollen_paris": s(),
      });
      const cfg = {
        integration: "atmo",
        location: "Paris",
        allergens: ["allergy_risk"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.qualite_globale_pollen_paris"]);
    });

    it("returns qualite_globale sensor with qualite_globale_ prefix", () => {
      const hass = createHass({
        "sensor.qualite_globale_paris": s(),
      });
      const cfg = {
        integration: "atmo",
        location: "Paris",
        allergens: ["qualite_globale"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.qualite_globale_paris"]);
    });

    it("returns pollution sensors without niveau_ prefix", () => {
      const hass = createHass({
        "sensor.pm25_paris": s(),
        "sensor.ozone_paris": s(),
        "sensor.dioxyde_d_azote_paris": s(),
      });
      const cfg = {
        integration: "atmo",
        location: "Paris",
        allergens: ["pm25", "ozone", "no2"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([
        "sensor.pm25_paris",
        "sensor.ozone_paris",
        "sensor.dioxyde_d_azote_paris",
      ]);
    });

    it("skips allergens not in ATMO_ALLERGEN_MAP", () => {
      const hass = createHass({});
      const cfg = {
        integration: "atmo",
        location: "Paris",
        allergens: ["unknown_pollen"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([]);
    });

    it("falls back to unique candidate when location empty", () => {
      const hass = createHass({
        "sensor.niveau_bouleau_lyon": s(),
      });
      const cfg = {
        integration: "atmo",
        location: "",
        allergens: ["birch"],
      };

      const result = findAvailableSensors(cfg, hass);

      // Unique candidate search: prefix = sensor.niveau_bouleau_
      expect(result).toEqual(["sensor.niveau_bouleau_lyon"]);
    });

    it("excludes _j_ forecast entities from fallback search", () => {
      // _j_ entities are forecast entities, not current-day
      const hass = createHass({
        "sensor.niveau_bouleau_paris_j_1": s(),
      });
      const cfg = {
        integration: "atmo",
        location: "",
        allergens: ["birch"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([]);
    });

    it("excludes qualite_globale_pollen when searching for qualite_globale", () => {
      const hass = createHass({
        "sensor.qualite_globale_pollen_paris": s(),
        // No sensor.qualite_globale_paris exists
      });
      const cfg = {
        integration: "atmo",
        location: "",
        allergens: ["qualite_globale"],
      };

      const result = findAvailableSensors(cfg, hass);

      // Should NOT match qualite_globale_pollen_paris
      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // GPL (Google Pollen Levels) - discovery-based
  // ===========================================================================

  describe("GPL", () => {
    it("returns sensors via entity registry discovery", () => {
      const deviceId = "gpl_device_1";
      const configEntryId = "abc123";
      const hass = createHass(
        {
          "sensor.pollen_grass": {
            state: "3",
            attributes: { icon: "mdi:grass" },
          },
          "sensor.pollen_tree": {
            state: "2",
            attributes: { icon: "mdi:tree" },
          },
        },
        {
          entities: {
            "sensor.pollen_grass": {
              platform: "pollenlevels",
              device_id: deviceId,
              entity_category: null,
            },
            "sensor.pollen_tree": {
              platform: "pollenlevels",
              device_id: deviceId,
              entity_category: null,
            },
          },
          devices: {
            [deviceId]: {
              name: "Home",
              config_entries: [configEntryId],
            },
          },
        },
      );
      const cfg = {
        integration: "gpl",
        location: configEntryId,
        allergens: ["grass_cat", "trees_cat"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toContain("sensor.pollen_grass");
      expect(result).toContain("sensor.pollen_tree");
      expect(result).toHaveLength(2);
    });

    it("classifies plant sensors by attributes.code", () => {
      const deviceId = "gpl_device_1";
      const configEntryId = "abc123";
      const hass = createHass(
        {
          "sensor.pollen_birch_level": {
            state: "2",
            attributes: { code: "birch" },
          },
        },
        {
          entities: {
            "sensor.pollen_birch_level": {
              platform: "pollenlevels",
              device_id: deviceId,
              entity_category: null,
            },
          },
          devices: {
            [deviceId]: {
              name: "Home",
              config_entries: [configEntryId],
            },
          },
        },
      );
      const cfg = {
        integration: "gpl",
        location: configEntryId,
        allergens: ["birch"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.pollen_birch_level"]);
    });

    it("falls back to attribution scan when hass.entities empty", () => {
      const hass = createHass(
        {
          "sensor.pollen_grass": {
            state: "3",
            attributes: {
              icon: "mdi:grass",
              attribution: "Data provided by Google Maps Pollen API",
            },
          },
        },
        { entities: {} },
      );
      const cfg = {
        integration: "gpl",
        location: "",
        allergens: ["grass_cat"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.pollen_grass"]);
    });

    it("returns empty when no GPL entities found", () => {
      const hass = createHass({}, { entities: {} });
      const cfg = {
        integration: "gpl",
        location: "",
        allergens: ["grass_cat"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // Manual mode
  // ===========================================================================

  describe("Manual mode", () => {
    describe("Generic manual mode (PP/DWD/PEU)", () => {
      it("constructs sensor IDs from prefix + slug + suffix (PP)", () => {
        const hass = createHass({
          "sensor.my_prefix_birch": s(),
        });
        const cfg = {
          integration: "pp",
          city: "manual",
          entity_prefix: "my_prefix",
          entity_suffix: "",
          allergens: ["birch"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.my_prefix_birch"]);
      });

      it("strips sensor. prefix from entity_prefix", () => {
        const hass = createHass({
          "sensor.my_prefix_birch": s(),
        });
        const cfg = {
          integration: "pp",
          city: "manual",
          entity_prefix: "sensor.my_prefix",
          entity_suffix: "",
          allergens: ["birch"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.my_prefix_birch"]);
      });

      it("adds trailing underscore to prefix if missing", () => {
        const hass = createHass({
          "sensor.custom_birch": s(),
        });
        const cfg = {
          integration: "pp",
          city: "manual",
          entity_prefix: "custom",
          entity_suffix: "",
          allergens: ["birch"],
        };

        const result = findAvailableSensors(cfg, hass);

        // "custom" -> "custom_", so sensor.custom_birch
        expect(result).toEqual(["sensor.custom_birch"]);
      });

      it("does not add underscore when prefix already ends with one", () => {
        const hass = createHass({
          "sensor.custom_birch": s(),
        });
        const cfg = {
          integration: "pp",
          city: "manual",
          entity_prefix: "custom_",
          entity_suffix: "",
          allergens: ["birch"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.custom_birch"]);
      });

      it("handles empty prefix (no prefix added)", () => {
        const hass = createHass({
          "sensor.birch": s(),
        });
        const cfg = {
          integration: "pp",
          city: "manual",
          entity_prefix: "",
          entity_suffix: "",
          allergens: ["birch"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.birch"]);
      });

      it("appends suffix to sensor ID", () => {
        const hass = createHass({
          "sensor.custom_birch_end": s(),
        });
        const cfg = {
          integration: "pp",
          city: "manual",
          entity_prefix: "custom_",
          entity_suffix: "_end",
          allergens: ["birch"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.custom_birch_end"]);
      });

      it("falls back to unique candidate when suffix is empty and exact match missing", () => {
        const hass = createHass({
          "sensor.custom_birch_extra": s(),
        });
        const cfg = {
          integration: "pp",
          city: "manual",
          entity_prefix: "custom_",
          entity_suffix: "",
          allergens: ["birch"],
        };

        const result = findAvailableSensors(cfg, hass);

        // sensor.custom_birch not found, but sensor.custom_birch_extra starts
        // with "sensor.custom_birch" and is the unique candidate
        expect(result).toEqual(["sensor.custom_birch_extra"]);
      });

      it("does not fallback when multiple candidates exist", () => {
        const hass = createHass({
          "sensor.custom_birch_a": s(),
          "sensor.custom_birch_b": s(),
        });
        const cfg = {
          integration: "pp",
          city: "manual",
          entity_prefix: "custom_",
          entity_suffix: "",
          allergens: ["birch"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual([]);
      });

      it("uses normalizeDWD for DWD manual mode", () => {
        // "gräser" -> normalizeDWD -> "graeser"
        const hass = createHass({
          "sensor.custom_graeser": s(),
        });
        const cfg = {
          integration: "dwd",
          region_id: "manual",
          entity_prefix: "custom_",
          entity_suffix: "",
          allergens: ["gräser"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.custom_graeser"]);
      });

      it("uses normalize for PEU manual mode", () => {
        const hass = createHass({
          "sensor.custom_birch": s(),
        });
        const cfg = {
          integration: "peu",
          location: "manual",
          entity_prefix: "custom_",
          entity_suffix: "",
          allergens: ["birch"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.custom_birch"]);
      });
    });

    describe("Kleenex manual mode", () => {
      it("constructs sensor IDs from prefix + category + suffix", () => {
        const hass = createHass({
          "sensor.my_prefix_trees": s(),
        });
        const cfg = {
          integration: "kleenex",
          location: "manual",
          entity_prefix: "my_prefix",
          entity_suffix: "",
          allergens: ["trees"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.my_prefix_trees"]);
      });

      it("strips sensor. from entity_prefix in kleenex manual mode", () => {
        const hass = createHass({
          "sensor.my_prefix_trees": s(),
        });
        const cfg = {
          integration: "kleenex",
          location: "manual",
          entity_prefix: "sensor.my_prefix",
          entity_suffix: "",
          allergens: ["trees"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.my_prefix_trees"]);
      });

      it("detects localized category names in manual mode", () => {
        // Dutch: "bomen" -> "trees"
        const hass = createHass({
          "sensor.my_prefix_bomen": s(),
        });
        const cfg = {
          integration: "kleenex",
          location: "manual",
          entity_prefix: "my_prefix",
          entity_suffix: "",
          allergens: ["trees"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.my_prefix_bomen"]);
      });

      it("maps individual allergens to categories in manual mode", () => {
        const hass = createHass({
          "sensor.my_prefix_trees": s(),
        });
        const cfg = {
          integration: "kleenex",
          location: "manual",
          entity_prefix: "my_prefix",
          entity_suffix: "",
          allergens: ["birch"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.my_prefix_trees"]);
      });
    });

    describe("GPL manual mode", () => {
      it("uses discovery + prefix/suffix filtering", () => {
        const deviceId1 = "gpl_device_1";
        const deviceId2 = "gpl_device_2";
        const configEntryId1 = "abc123";
        const configEntryId2 = "def456";
        const hass = createHass(
          {
            "sensor.my_grass_sensor": {
              state: "3",
              attributes: { icon: "mdi:grass" },
            },
            "sensor.other_grass": {
              state: "2",
              attributes: { icon: "mdi:grass" },
            },
          },
          {
            entities: {
              "sensor.my_grass_sensor": {
                platform: "pollenlevels",
                device_id: deviceId1,
                entity_category: null,
              },
              "sensor.other_grass": {
                platform: "pollenlevels",
                device_id: deviceId2,
                entity_category: null,
              },
            },
            devices: {
              [deviceId1]: {
                name: "Home",
                config_entries: [configEntryId1],
              },
              [deviceId2]: {
                name: "Other",
                config_entries: [configEntryId2],
              },
            },
          },
        );
        const cfg = {
          integration: "gpl",
          location: "manual",
          entity_prefix: "my_",
          entity_suffix: "",
          allergens: ["grass_cat"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.my_grass_sensor"]);
      });

      it("returns empty in GPL manual mode when prefix does not match", () => {
        const deviceId = "gpl_device_1";
        const configEntryId = "abc123";
        const hass = createHass(
          {
            "sensor.pollen_grass": {
              state: "3",
              attributes: { icon: "mdi:grass" },
            },
          },
          {
            entities: {
              "sensor.pollen_grass": {
                platform: "pollenlevels",
                device_id: deviceId,
                entity_category: null,
              },
            },
            devices: {
              [deviceId]: {
                name: "Home",
                config_entries: [configEntryId],
              },
            },
          },
        );
        const cfg = {
          integration: "gpl",
          location: "manual",
          entity_prefix: "nonexistent_",
          entity_suffix: "",
          allergens: ["grass_cat"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual([]);
      });
    });

    describe("SILAM manual mode", () => {
      it("uses reverse allergen map for slug resolution", () => {
        // For "birch", iterating Object.values(silamAllergenMap.mapping):
        // nl: "berk" -> "birch" -> reverse: "birch" -> "berk"
        // So first match slug is "berk" (from nl mapping, first in JSON order)
        const hass = createHass(
          {
            "sensor.custom_berk": s(),
          },
          { entities: {} },
        );
        const cfg = {
          integration: "silam",
          city: "manual",
          entity_prefix: "custom_",
          entity_suffix: "",
          allergens: ["birch"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.custom_berk"]);
      });

      it("falls back to normalize() when allergen not in silam map", () => {
        const hass = createHass(
          {
            "sensor.custom_unknown_plant": s(),
          },
          { entities: {} },
        );
        const cfg = {
          integration: "silam",
          city: "manual",
          entity_prefix: "custom_",
          entity_suffix: "",
          allergens: ["unknown_plant"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.custom_unknown_plant"]);
      });
    });

    describe("ATMO manual mode", () => {
      it("uses ATMO_ALLERGEN_MAP for slug resolution", () => {
        // ATMO_ALLERGEN_MAP["birch"] = "bouleau"
        const hass = createHass({
          "sensor.custom_bouleau": s(),
        });
        const cfg = {
          integration: "atmo",
          city: "manual",
          entity_prefix: "custom_",
          entity_suffix: "",
          allergens: ["birch"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.custom_bouleau"]);
      });

      it("uses normalize() fallback for unknown ATMO allergens", () => {
        const hass = createHass({
          "sensor.custom_something": s(),
        });
        const cfg = {
          integration: "atmo",
          city: "manual",
          entity_prefix: "custom_",
          entity_suffix: "",
          allergens: ["something"],
        };

        const result = findAvailableSensors(cfg, hass);

        expect(result).toEqual(["sensor.custom_something"]);
      });
    });
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe("Edge cases", () => {
    it("returns empty array when allergens is empty", () => {
      const hass = createHass({
        "sensor.pollen_stockholm_birch": s(),
      });
      const cfg = {
        integration: "pp",
        city: "stockholm",
        allergens: [],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([]);
    });

    it("returns empty array when allergens is undefined", () => {
      const hass = createHass({
        "sensor.pollen_stockholm_birch": s(),
      });
      const cfg = {
        integration: "pp",
        city: "stockholm",
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([]);
    });

    it("returns empty array when no entities match", () => {
      const hass = createHass({});
      const cfg = {
        integration: "pp",
        city: "stockholm",
        allergens: ["birch"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([]);
    });

    it("handles missing hass.states gracefully for PLU", () => {
      const hass = createHass({});
      const cfg = {
        integration: "plu",
        allergens: ["birch", "hazel"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual([]);
    });

    it("sensor. prefix stripping in manual mode works with and without it", () => {
      const hass = createHass({
        "sensor.myprefix_birch": s(),
      });

      // With sensor. prefix
      const cfg1 = {
        integration: "pp",
        city: "manual",
        entity_prefix: "sensor.myprefix",
        entity_suffix: "",
        allergens: ["birch"],
      };
      const result1 = findAvailableSensors(cfg1, hass);

      // Without sensor. prefix
      const cfg2 = {
        integration: "pp",
        city: "manual",
        entity_prefix: "myprefix",
        entity_suffix: "",
        allergens: ["birch"],
      };
      const result2 = findAvailableSensors(cfg2, hass);

      expect(result1).toEqual(result2);
      expect(result1).toEqual(["sensor.myprefix_birch"]);
    });

    it("manual mode with both prefix and suffix", () => {
      const hass = createHass({
        "sensor.pf_birch_sf": s(),
      });
      const cfg = {
        integration: "pp",
        city: "manual",
        entity_prefix: "pf_",
        entity_suffix: "_sf",
        allergens: ["birch"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.pf_birch_sf"]);
    });

    it("only returns sensors that actually exist in hass.states", () => {
      const hass = createHass({
        "sensor.pollen_stockholm_birch": s(),
        // grass sensor does NOT exist
      });
      const cfg = {
        integration: "pp",
        city: "stockholm",
        allergens: ["birch", "grass"],
      };

      const result = findAvailableSensors(cfg, hass);

      expect(result).toEqual(["sensor.pollen_stockholm_birch"]);
    });

    it("debug mode does not affect return value", () => {
      const hass = createHass({
        "sensor.pollen_stockholm_birch": s(),
      });
      const cfg = {
        integration: "pp",
        city: "stockholm",
        allergens: ["birch"],
      };

      const withDebug = findAvailableSensors(cfg, hass, true);
      const withoutDebug = findAvailableSensors(cfg, hass, false);

      expect(withDebug).toEqual(withoutDebug);
    });
  });
});
