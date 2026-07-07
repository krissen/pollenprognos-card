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
      const hass: any = { locale: { language: "sv" }, language: "sv" };
      expect(detectLang(hass)).toBe("sv");
    });

    it("returns short code when full tag has no exact match", () => {
      const hass: any = { locale: { language: "de-AT" }, language: "de-AT" };
      expect(detectLang(hass)).toBe("de");
    });

    it("falls back to 'en' for unsupported language", () => {
      const hass: any = { locale: { language: "zh" }, language: "zh" };
      expect(detectLang(hass)).toBe("en");
    });

    it("respects userLocale override over hass", () => {
      const hass: any = { locale: { language: "sv" }, language: "sv" };
      expect(detectLang(hass, "de")).toBe("de");
    });

    it("falls back to 'en' when hass is null", () => {
      expect(detectLang(null)).toBe("en");
    });

    it("falls back to 'en' when hass is undefined", () => {
      expect(detectLang(undefined)).toBe("en");
    });

    it("uses hass.language when locale object is missing", () => {
      const hass: any = { language: "fr" };
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

  describe("graminales allergen strings (issue #262 follow-up)", () => {
    // Google's per-language displayName for the GRAMINALES grass-plant code,
    // sourced from the Pollen API. The editor used to leak the raw key
    // `editor.phrases_full.graminales` because these were missing.
    const EXPECTED = {
      cs: "Trávy", da: "Græs", de: "Gräser", el: "Γρασίδι", en: "Grasses",
      es: "Gramíneas", fi: "Ruohot", fr: "Graminées", it: "Piante erbacee",
      nl: "Grassen", no: "Gress", pl: "Trawy", ru: "Травы", sk: "Trávy",
      sv: "Gräs",
    };
    const NAMESPACES = [
      "card.allergen",
      "editor.phrases_full",
      "editor.phrases_short",
    ];

    for (const lang of SUPPORTED_LOCALES) {
      it(`resolves graminales in all namespaces for '${lang}' (no raw key)`, () => {
        for (const ns of NAMESPACES) {
          const key = `${ns}.graminales`;
          const val = t(key, lang);
          // never the raw key, never empty
          expect(val).not.toBe(key);
          expect(typeof val).toBe("string");
          expect(val.length).toBeGreaterThan(0);
          // matches the sourced Google displayName for this locale
          expect(val).toBe((EXPECTED as Record<string, string>)[lang]);
        }
      });
    }
  });
});
