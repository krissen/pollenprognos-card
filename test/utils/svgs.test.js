import { describe, it, expect } from "vitest";
import { getSvgContent, svgs } from "../../src/pollenprognos-svgs.js";

const ALLERGEN_KEYS = [
  "alder", "ash", "beech", "birch", "chenopod", "cypress", "elm",
  "grass", "hazel", "lime", "mold_spores", "mugwort", "oak", "olive",
  "pine", "plane", "poaceae", "poplar", "ragweed", "rye", "willow",
];

const ALIAS_KEYS = [
  "goosefoot", "nettle", "plantain", "sorrel",
];

const POLLUTION_KEYS = [
  "pm25", "pm10", "ozone", "no2", "so2", "qualite_globale",
];

const SPECIAL_KEYS = [
  "no_allergens",
  "allergy_risk", "allergy_risk_1", "allergy_risk_2", "allergy_risk_3",
  "allergy_risk_4", "allergy_risk_5", "allergy_risk_6",
];

describe("getSvgContent", () => {
  describe("returns non-empty SVG string", () => {
    it.each([...ALLERGEN_KEYS, ...ALIAS_KEYS, ...POLLUTION_KEYS, ...SPECIAL_KEYS])(
      "for '%s'",
      (key) => {
        const svg = getSvgContent(key);
        expect(svg).toBeTruthy();
        expect(typeof svg).toBe("string");
        expect(svg).toContain("<svg");
      },
    );
  });

  describe("returns null for invalid input", () => {
    it("returns null for unknown key", () => {
      expect(getSvgContent("nonexistent_allergen")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(getSvgContent("")).toBeNull();
    });

    it("returns null for null", () => {
      expect(getSvgContent(null)).toBeNull();
    });

    it("returns null for undefined", () => {
      expect(getSvgContent(undefined)).toBeNull();
    });

    it("returns null for number", () => {
      expect(getSvgContent(42)).toBeNull();
    });
  });

  describe("svgs map completeness", () => {
    it("has entries for all core allergens", () => {
      for (const key of ALLERGEN_KEYS) {
        expect(svgs[key], `missing SVG for ${key}`).toBeTruthy();
      }
    });

    it("nettle_and_pellitory has dedicated SVG", () => {
      expect(svgs.nettle_and_pellitory).toBeTruthy();
      expect(svgs.nettle_and_pellitory).toContain("<svg");
    });
  });
});
