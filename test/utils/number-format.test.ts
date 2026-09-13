import { describe, it, expect } from "vitest";
import {
  getDecimalSeparator,
  formatNumberForInput,
  parseLocaleNumber,
} from "../../src/utils/number-format.js";

const hassWith = (locale: any): any => ({ locale });

describe("number-format", () => {
  describe("getDecimalSeparator", () => {
    it("maps point-decimal number_format enums to '.'", () => {
      expect(
        getDecimalSeparator(hassWith({ number_format: "comma_decimal" })),
      ).toBe(".");
      expect(
        getDecimalSeparator(hassWith({ number_format: "quote_decimal" })),
      ).toBe(".");
      expect(getDecimalSeparator(hassWith({ number_format: "none" }))).toBe(
        ".",
      );
    });

    it("maps comma-decimal number_format enums to ','", () => {
      expect(
        getDecimalSeparator(hassWith({ number_format: "decimal_comma" })),
      ).toBe(",");
      expect(
        getDecimalSeparator(hassWith({ number_format: "space_comma" })),
      ).toBe(",");
    });

    it("derives from language when number_format is 'language' or unset", () => {
      expect(
        getDecimalSeparator(
          hassWith({ number_format: "language", language: "de" }),
        ),
      ).toBe(",");
      expect(
        getDecimalSeparator(
          hassWith({ number_format: "language", language: "en" }),
        ),
      ).toBe(".");
      // unset number_format falls through to language derivation
      expect(getDecimalSeparator(hassWith({ language: "fr" }))).toBe(",");
      expect(getDecimalSeparator(hassWith({ language: "en-US" }))).toBe(".");
    });

    it("falls back to '.' for missing hass/locale", () => {
      expect(getDecimalSeparator(undefined)).toBe(".");
      expect(getDecimalSeparator({} as any)).toBe(".");
      expect(getDecimalSeparator(hassWith({}))).toBe(".");
    });
  });

  describe("formatNumberForInput", () => {
    it("renders with a point under a point profile", () => {
      const hass = hassWith({ number_format: "comma_decimal" });
      expect(formatNumberForInput(0.05, hass)).toBe("0.05");
      expect(formatNumberForInput(1, hass)).toBe("1");
      expect(formatNumberForInput(48, hass)).toBe("48");
    });

    it("renders with a comma under a comma profile", () => {
      const hass = hassWith({ number_format: "decimal_comma" });
      expect(formatNumberForInput(0.05, hass)).toBe("0,05");
      expect(formatNumberForInput(1, hass)).toBe("1");
      expect(formatNumberForInput(1.5, hass)).toBe("1,5");
    });

    it("accepts numeric strings", () => {
      expect(formatNumberForInput("0.8", hassWith({ language: "de" }))).toBe(
        "0,8",
      );
    });

    it("returns empty string for empty/non-finite values", () => {
      const hass = hassWith({ number_format: "comma_decimal" });
      expect(formatNumberForInput(null, hass)).toBe("");
      expect(formatNumberForInput(undefined, hass)).toBe("");
      expect(formatNumberForInput("", hass)).toBe("");
      expect(formatNumberForInput(NaN, hass)).toBe("");
      expect(formatNumberForInput("abc", hass)).toBe("");
    });
  });

  describe("parseLocaleNumber", () => {
    it("accepts both point and comma separators", () => {
      expect(parseLocaleNumber("0.8")).toBe(0.8);
      expect(parseLocaleNumber("0,8")).toBe(0.8);
    });

    it("tolerates grouping whitespace", () => {
      expect(parseLocaleNumber(" 1 234,5 ")).toBe(1234.5);
    });

    it("returns null for empty/invalid input", () => {
      expect(parseLocaleNumber("")).toBeNull();
      expect(parseLocaleNumber("   ")).toBeNull();
      expect(parseLocaleNumber("abc")).toBeNull();
      expect(parseLocaleNumber(null as any)).toBeNull();
      expect(parseLocaleNumber(undefined as any)).toBeNull();
    });

    it("parses integers", () => {
      expect(parseLocaleNumber("48")).toBe(48);
    });
  });
});
