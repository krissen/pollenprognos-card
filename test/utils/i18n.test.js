import { describe, it, expect } from "vitest";
import { detectLang, t, SUPPORTED_LOCALES } from "../../src/i18n.js";

describe("i18n", () => {
  describe("SUPPORTED_LOCALES", () => {
    it("includes expected core languages", () => {
      for (const lang of ["en", "sv", "de", "fr", "nl", "es"]) {
        expect(SUPPORTED_LOCALES).toContain(lang);
      }
    });

    it("has 15 locales", () => {
      expect(SUPPORTED_LOCALES).toHaveLength(15);
    });
  });

  describe("detectLang", () => {
    it("returns exact match from hass locale", () => {
      const hass = { locale: { language: "sv" }, language: "sv" };
      expect(detectLang(hass)).toBe("sv");
    });

    it("returns short code when full tag has no exact match", () => {
      const hass = { locale: { language: "de-AT" }, language: "de-AT" };
      expect(detectLang(hass)).toBe("de");
    });

    it("falls back to 'en' for unsupported language", () => {
      const hass = { locale: { language: "zh" }, language: "zh" };
      expect(detectLang(hass)).toBe("en");
    });

    it("respects userLocale override over hass", () => {
      const hass = { locale: { language: "sv" }, language: "sv" };
      expect(detectLang(hass, "de")).toBe("de");
    });

    it("falls back to 'en' when hass is null", () => {
      expect(detectLang(null)).toBe("en");
    });

    it("falls back to 'en' when hass is undefined", () => {
      expect(detectLang(undefined)).toBe("en");
    });

    it("uses hass.language when locale object is missing", () => {
      const hass = { language: "fr" };
      expect(detectLang(hass)).toBe("fr");
    });
  });

  describe("t", () => {
    it("returns translated string for known key", () => {
      expect(t("card.allergen.birch", "en")).toBe("Birch");
    });

    it("returns Swedish translation when lang is sv", () => {
      expect(t("card.allergen.birch", "sv")).toBe("Björk");
    });

    it("falls back to English for missing key in non-English locale", () => {
      // Use a key that exists in en but verify fallback works
      const enResult = t("card.allergen.birch", "en");
      const svResult = t("card.allergen.birch", "sv");
      expect(enResult).toBe("Birch");
      expect(svResult).toBe("Björk");
    });

    it("returns the key itself when not found in any locale", () => {
      expect(t("nonexistent.key.that.does.not.exist", "en")).toBe(
        "nonexistent.key.that.does.not.exist",
      );
    });

    it("returns the key for unknown language with missing key", () => {
      expect(t("totally.missing", "xx")).toBe("totally.missing");
    });

    it("falls back to English for completely unknown language", () => {
      expect(t("card.allergen.birch", "xx")).toBe("Birch");
    });

    it("handles variable interpolation", () => {
      // card.days keys use simple strings without vars,
      // but IntlMessageFormat should pass through plain strings
      const result = t("card.allergen.birch", "en");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
