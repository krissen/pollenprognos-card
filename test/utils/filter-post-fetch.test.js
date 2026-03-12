// test/utils/filter-post-fetch.test.js
// Step 0g: Tests for filterSensorsPostFetch (post-fetch sensor filtering).
import { describe, it, expect } from "vitest";
import { filterSensorsPostFetch } from "../../src/utils/adapter-helpers.js";

// Minimal silamAllergenMap.mapping for tests (en + sv)
const silamMapping = {
  en: {
    alder: "alder",
    birch: "birch",
    grass: "grass",
    index: "allergy_risk",
  },
  sv: {
    al: "alder",
    bjork: "birch",
    gras: "grass",
    index: "allergy_risk",
  },
};

function sensor(allergen, entityId = null) {
  return { allergenReplaced: allergen, entity_id: entityId };
}

describe("filterSensorsPostFetch", () => {
  // ──────────────────────────────────────────────────
  // Branch 1: SILAM daily mode (entity_id-based filtering)
  // ──────────────────────────────────────────────────
  describe("SILAM daily mode", () => {
    const baseCfg = { integration: "silam", allergens: ["birch", "grass"] };

    it("keeps sensors whose entity_id is in availableSensors", () => {
      const sensors = [
        sensor("birch", "sensor.silam_pollen_stockholm_birch"),
        sensor("grass", "sensor.silam_pollen_stockholm_grass"),
      ];
      const available = ["sensor.silam_pollen_stockholm_birch"];
      const result = filterSensorsPostFetch(sensors, baseCfg, available, [], silamMapping);
      expect(result).toHaveLength(1);
      expect(result[0].allergenReplaced).toBe("birch");
    });

    it("drops sensors whose entity_id is NOT in availableSensors", () => {
      const sensors = [
        sensor("birch", "sensor.silam_pollen_stockholm_birch"),
      ];
      const result = filterSensorsPostFetch(sensors, baseCfg, [], [], silamMapping);
      expect(result).toHaveLength(0);
    });

    it("mode=daily explicitly triggers entity_id filtering", () => {
      const cfg = { ...baseCfg, mode: "daily" };
      const sensors = [
        sensor("birch", "sensor.silam_pollen_stockholm_birch"),
      ];
      const available = ["sensor.silam_pollen_stockholm_birch"];
      const result = filterSensorsPostFetch(sensors, cfg, available, [], silamMapping);
      expect(result).toHaveLength(1);
    });

    it("mode=undefined (no mode set) triggers entity_id filtering", () => {
      const cfg = { integration: "silam", allergens: ["birch"] };
      const sensors = [
        sensor("birch", "sensor.silam_pollen_stockholm_birch"),
      ];
      const result = filterSensorsPostFetch(sensors, cfg, [], [], silamMapping);
      expect(result).toHaveLength(0);
    });

    // Reverse-map fallback: no entity_id, location is not a config_entry_id
    describe("reverse-map fallback (no entity_id)", () => {
      it("uses silamMapping to resolve allergen slug and builds entity_id", () => {
        const cfg = { ...baseCfg, location: "stockholm" };
        const sensors = [sensor("birch", null)];
        const hassKeys = [
          "sensor.silam_pollen_stockholm_birch",
          "sensor.silam_pollen_stockholm_grass",
        ];
        const available = ["sensor.silam_pollen_stockholm_birch"];
        const result = filterSensorsPostFetch(sensors, cfg, available, hassKeys, silamMapping);
        expect(result).toHaveLength(1);
        expect(result[0].allergenReplaced).toBe("birch");
      });

      it("resolves localized HA slugs via reverse map", () => {
        // Swedish HA slug "bjork" maps to master "birch" via silamMapping.sv
        const cfg = { ...baseCfg, location: "stockholm" };
        const sensors = [sensor("birch", null)];
        const hassKeys = [
          "sensor.silam_pollen_stockholm_bjork",
        ];
        const available = ["sensor.silam_pollen_stockholm_bjork"];
        const result = filterSensorsPostFetch(sensors, cfg, available, hassKeys, silamMapping);
        expect(result).toHaveLength(1);
      });

      it("falls back to allergenReplaced as slug when no mapping found", () => {
        const cfg = { ...baseCfg, location: "stockholm" };
        const sensors = [sensor("unknown_allergen", null)];
        const hassKeys = [];
        const available = ["sensor.silam_pollen_stockholm_unknown_allergen"];
        const result = filterSensorsPostFetch(sensors, cfg, available, hassKeys, silamMapping);
        expect(result).toHaveLength(1);
      });

      it("drops sensor when built entity_id is not in available", () => {
        const cfg = { ...baseCfg, location: "stockholm" };
        const sensors = [sensor("birch", null)];
        const hassKeys = ["sensor.silam_pollen_stockholm_birch"];
        const available = [];
        const result = filterSensorsPostFetch(sensors, cfg, available, hassKeys, silamMapping);
        expect(result).toHaveLength(0);
      });

      it("empty location falls back to empty string slug prefix", () => {
        const cfg = { ...baseCfg, location: "" };
        const sensors = [sensor("birch", null)];
        const hassKeys = ["sensor.silam_pollen__birch"];
        const available = ["sensor.silam_pollen__birch"];
        const result = filterSensorsPostFetch(sensors, cfg, available, hassKeys, silamMapping);
        expect(result).toHaveLength(1);
      });
    });

    // Config entry ID path: no entity_id + ULID location
    describe("config_entry_id path", () => {
      it("returns false when entity_id is null and location is a ULID", () => {
        const cfg = { ...baseCfg, location: "01JRGQH6VXQBCN2C6Z5E3DMPFY" };
        const sensors = [sensor("birch", null)];
        const available = ["sensor.silam_pollen_stockholm_birch"];
        const result = filterSensorsPostFetch(sensors, cfg, available, [], silamMapping);
        expect(result).toHaveLength(0);
      });
    });
  });

  // ──────────────────────────────────────────────────
  // Branch 2: SILAM non-daily modes (pass through)
  // ──────────────────────────────────────────────────
  describe("SILAM non-daily modes", () => {
    it("mode=hourly passes all sensors through", () => {
      const cfg = { integration: "silam", mode: "hourly", allergens: ["birch"] };
      const sensors = [
        sensor("birch", null),
        sensor("grass", null),
      ];
      const result = filterSensorsPostFetch(sensors, cfg, [], [], silamMapping);
      expect(result).toHaveLength(2);
    });

    it("mode=twice_daily passes all sensors through", () => {
      const cfg = { integration: "silam", mode: "twice_daily", allergens: ["birch"] };
      const sensors = [sensor("birch", null)];
      const result = filterSensorsPostFetch(sensors, cfg, [], [], silamMapping);
      expect(result).toHaveLength(1);
    });
  });

  // ──────────────────────────────────────────────────
  // Branch 3: Other integrations (name-based filtering)
  // ──────────────────────────────────────────────────
  describe("other integrations (name-based filtering)", () => {
    it("PP: keeps sensors matching normalized allergen names", () => {
      const cfg = { integration: "pp", allergens: ["birch", "grass"] };
      const sensors = [
        sensor("birch"),
        sensor("grass"),
        sensor("alder"),
      ];
      const result = filterSensorsPostFetch(sensors, cfg, [], [], silamMapping);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.allergenReplaced)).toEqual(["birch", "grass"]);
    });

    it("PP: empty allergens array passes all sensors through", () => {
      const cfg = { integration: "pp", allergens: [] };
      const sensors = [sensor("birch"), sensor("grass")];
      const result = filterSensorsPostFetch(sensors, cfg, [], [], silamMapping);
      expect(result).toHaveLength(2);
    });

    it("PP: no allergens field passes all sensors through", () => {
      const cfg = { integration: "pp" };
      const sensors = [sensor("birch"), sensor("grass")];
      const result = filterSensorsPostFetch(sensors, cfg, [], [], silamMapping);
      expect(result).toHaveLength(2);
    });

    it("DWD: uses normalizeDWD for matching", () => {
      // normalizeDWD lowercases and strips umlauts differently
      const cfg = { integration: "dwd", allergens: ["Erle", "Birke"] };
      const sensors = [
        sensor("erle"),
        sensor("birke"),
        sensor("hasel"),
      ];
      const result = filterSensorsPostFetch(sensors, cfg, [], [], silamMapping);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.allergenReplaced)).toEqual(["erle", "birke"]);
    });

    it("PEU: filters by normalized allergen name", () => {
      const cfg = { integration: "peu", allergens: ["birch"] };
      const sensors = [
        sensor("birch"),
        sensor("grass"),
      ];
      const result = filterSensorsPostFetch(sensors, cfg, [], [], silamMapping);
      expect(result).toHaveLength(1);
      expect(result[0].allergenReplaced).toBe("birch");
    });

    it("Kleenex: filters by normalized allergen name", () => {
      const cfg = { integration: "kleenex", allergens: ["trees"] };
      const sensors = [
        sensor("trees"),
        sensor("grass"),
      ];
      const result = filterSensorsPostFetch(sensors, cfg, [], [], silamMapping);
      expect(result).toHaveLength(1);
    });
  });

  // ──────────────────────────────────────────────────
  // Edge cases
  // ──────────────────────────────────────────────────
  describe("edge cases", () => {
    it("empty sensors array returns empty", () => {
      const cfg = { integration: "pp", allergens: ["birch"] };
      const result = filterSensorsPostFetch([], cfg, [], [], silamMapping);
      expect(result).toHaveLength(0);
    });

    it("SILAM daily with all sensors having entity_ids in available", () => {
      const cfg = { integration: "silam", allergens: ["birch", "grass"] };
      const sensors = [
        sensor("birch", "sensor.silam_pollen_stockholm_birch"),
        sensor("grass", "sensor.silam_pollen_stockholm_grass"),
      ];
      const available = [
        "sensor.silam_pollen_stockholm_birch",
        "sensor.silam_pollen_stockholm_grass",
      ];
      const result = filterSensorsPostFetch(sensors, cfg, available, [], silamMapping);
      expect(result).toHaveLength(2);
    });

    it("non-SILAM integration skips SILAM entity_id filtering entirely", () => {
      // Even if sensors have entity_ids, the SILAM branch is not entered
      const cfg = { integration: "pp", allergens: ["birch"] };
      const sensors = [
        sensor("birch", "sensor.silam_pollen_stockholm_birch"),
      ];
      const result = filterSensorsPostFetch(sensors, cfg, [], [], silamMapping);
      expect(result).toHaveLength(1);
    });
  });
});
